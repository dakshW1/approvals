import { query, nowIso } from './db.js';
import { OPEN_STATUSES, SLA, DOC_TYPES, evaluateCompliance, daysUntil } from './rules.js';
import { mailEnabled, deliverable, sendMail, layout, appUrl } from './mailer.js';

// Alert types that are also emailed. Routine updates (an upload, review not started) stay in-app only.
const EMAIL_TYPES = new Set([
  'OVERDUE', 'ESCALATION', 'DEADLINE', 'MISSING_DOCS', 'CERT_EXPIRED', 'CERT_EXPIRING', 'ASSIGNED', 'ASSIGNMENT_FAILED',
  'DOCUMENT_REJECTED', 'RESUBMITTED', 'STATUS_UNDER_REVIEW', 'STATUS_ACTION_REQUIRED', 'STATUS_APPROVED', 'STATUS_REJECTED', 'APPROVED_WITH_EXCEPTION',
]);

// One email per person per batch, listing every new alert for them.
async function emailNotifications(rows) {
  const wanted = rows.filter((r) => EMAIL_TYPES.has(r.type));
  if (!mailEnabled || !wanted.length) return;
  const users = await query('SELECT id, name, email FROM profiles WHERE id = ANY(?::int[]) AND suspended = 0', [[...new Set(wanted.map((r) => r.user_id))]]);
  const base = appUrl();
  await Promise.allSettled(
    users
      .filter((u) => deliverable(u.email))
      .map((u) => {
        const mine = wanted.filter((r) => r.user_id === u.id);
        const critical = mine.some((r) => r.severity === 'critical');
        const subject = mine.length === 1 ? mine[0].message.slice(0, 110) : `${mine.length} new alerts${critical ? ' (action needed)' : ''}`;
        const items = mine.map((r) => ({ ...r, link: r.application_id ? `${base}/applications/${r.application_id}` : null }));
        return sendMail({
          to: u.email,
          subject: `AICTE Approvals: ${subject}`,
          html: layout({ heading: mine.length === 1 ? 'New alert' : `${mine.length} new alerts`, intro: `Hello ${u.name},`, items, cta: { href: base, label: 'Open the portal' } }),
          text: `${mine.map((r) => `- ${r.message}`).join('\n')}\n\n${base}`,
        });
      })
  );
}

export async function audit(userId, action, entity, entityId, details = '', applicationId = null, at = nowIso()) {
  await query(
    'INSERT INTO audit_log (user_id, action, entity, entity_id, application_id, details, created_at) VALUES (?,?,?,?,?,?,?)',
    [userId ?? null, action, entity, entityId ?? null, applicationId ?? null, details, at]
  );
}

// rows: [userId, applicationId, type, severity, message, dedupeKey]. dedupe_key keeps recurring checks idempotent.
export async function insertNotifications(rows) {
  const seen = new Set();
  const valid = rows.filter((r) => {
    if (!r[0]) return false;
    if (!r[5]) return true;
    if (seen.has(r[5])) return false;
    seen.add(r[5]);
    return true;
  });
  const now = nowIso();
  const created = [];
  for (let i = 0; i < valid.length; i += 400) {
    const chunk = valid.slice(i, i + 400);
    const params = [];
    const values = chunk.map((r) => {
      params.push(r[0], r[1] ?? null, r[2], r[3], r[4], r[5] ?? null, now);
      return '(?,?,?,?,?,?,?)';
    });
    created.push(
      ...(await query(
        `INSERT INTO notifications (user_id, application_id, type, severity, message, dedupe_key, created_at)
         VALUES ${values.join(', ')} ON CONFLICT (dedupe_key) DO NOTHING
         RETURNING user_id, application_id, type, severity, message`,
        params
      ))
    );
  }
  // Only alerts that are actually new (not deduplicated) are emailed.
  await emailNotifications(created).catch((err) => console.warn('Alert emails failed:', err.message));
}

export const notify = (userId, applicationId, type, severity, message, dedupeKey = null) =>
  insertNotifications([[userId, applicationId, type, severity, message, dedupeKey]]);

export const collegeUserIds = async (institutionId) =>
  (await query("SELECT id FROM profiles WHERE role = 'COLLEGE' AND institution_id = ?", [institutionId])).map((r) => r.id);
export const adminUserIds = async () => (await query("SELECT id FROM profiles WHERE role = 'ADMIN'")).map((r) => r.id);

const when = (days) => (days === 0 ? 'today' : `in ${days} day(s)`);

function computeAlerts(app, docs, colleges, admins, now) {
  const out = [];
  const push = (u, type, severity, message, key) => out.push([u, app.id, type, severity, message, key]);

  // Certificate validity is monitored for every application, including approved ones.
  for (const d of docs) {
    if (!d.expiry_date) continue;
    const left = daysUntil(d.expiry_date, now);
    const name = DOC_TYPES[d.doc_type];
    if (left < 0) {
      for (const u of [...colleges, app.assigned_officer_id])
        push(u, 'CERT_EXPIRED', 'critical', `${name} for ${app.app_no} expired ${-left} day(s) ago. A renewed certificate is required.`, `EXPIRED:${d.id}:${u}`);
    } else if (left <= SLA.expiryWarnDays) {
      for (const u of colleges)
        push(u, 'CERT_EXPIRING', 'warning', `${name} for ${app.app_no} expires ${when(left)}. Renew it to stay compliant.`, `EXPIRING:${d.id}:${u}`);
    }
  }

  if (!OPEN_STATUSES.includes(app.status)) return out;

  const compliance = evaluateCompliance(app, docs, app.institution_type, now);
  const left = daysUntil(app.due_date, now);
  const withCollege = app.status === 'ACTION_REQUIRED';
  const responsible = withCollege ? colleges : [app.assigned_officer_id].filter(Boolean);
  const phase = `${app.status}:${app.due_date}`;

  if (left < 0) {
    for (const u of responsible)
      push(
        u, 'OVERDUE', 'critical',
        withCollege
          ? `Your response on ${app.app_no} is overdue by ${-left} day(s).`
          : `Review of ${app.app_no} (${app.institution_name}) is overdue by ${-left} day(s).`,
        `OVERDUE:${app.id}:${phase}:${u}`
      );
    for (const u of admins)
      push(u, 'ESCALATION', 'critical', `Escalated: ${app.app_no} is overdue by ${-left} day(s), pending with the ${withCollege ? 'institution' : 'officer'}.`, `ESC:${app.id}:${phase}:${u}`);
  } else if (left <= SLA.warnDays) {
    for (const u of responsible)
      push(u, 'DEADLINE', 'warning', `${app.app_no} is due ${when(left)}${withCollege ? ' (your response)' : ''}.`, `DUE:${app.id}:${phase}:${u}`);
  }

  if (compliance.missing.length) {
    const names = compliance.missing.map((t) => DOC_TYPES[t]).join(', ');
    for (const u of colleges)
      push(u, 'MISSING_DOCS', 'warning', `${app.app_no}: ${compliance.missing.length} required document(s) missing: ${names}.`, `MISSING:${app.id}:${compliance.missing.join(',')}:${u}`);
  }

  if (app.status === 'SUBMITTED' && app.assigned_officer_id) {
    const waiting = -daysUntil(app.submitted_at, now);
    if (waiting >= SLA.pickupDays)
      push(app.assigned_officer_id, 'PENDING_ACTION', 'info', `${app.app_no} has been waiting ${waiting} day(s) for review to start.`, `PICKUP:${app.id}`);
  }
  return out;
}

const APP_SQL = `SELECT a.*, i.type AS institution_type, i.name AS institution_name
  FROM applications a JOIN institutions i ON i.id = a.institution_id`;

export async function alertsForApp(appId, now = new Date()) {
  const [app] = await query(`${APP_SQL} WHERE a.id = ?`, [appId]);
  if (!app) return;
  const docs = await query('SELECT * FROM documents WHERE application_id = ?', [appId]);
  const rows = computeAlerts(app, docs, await collegeUserIds(app.institution_id), await adminUserIds(), now);
  await insertNotifications(rows);
}

export async function runAlerts(now = new Date()) {
  const apps = await query(APP_SQL);
  const docs = await query('SELECT * FROM documents');
  const colleges = await query("SELECT id, institution_id FROM profiles WHERE role = 'COLLEGE'");
  const admins = await adminUserIds();
  const docsBy = {};
  for (const d of docs) (docsBy[d.application_id] ||= []).push(d);
  const collegesBy = {};
  for (const c of colleges) (collegesBy[c.institution_id] ||= []).push(c.id);
  const rows = apps.flatMap((a) => computeAlerts(a, docsBy[a.id] || [], collegesBy[a.institution_id] || [], admins, now));
  await insertNotifications(rows);
}
