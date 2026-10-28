import crypto from 'node:crypto';
import path from 'node:path';
import { query, one, insert, nowIso, tx } from './db.js';
import { putFile, removeFile } from './supabase.js';
import {
  STATUSES, OPEN_STATUSES, CATEGORIES, CATEGORY_CODES, DOC_TYPES, REQUIRED_DOCS, EXPIRING_DOC_TYPES,
  ASSIGNMENT_RULES, SLA, NORMS, addDays, daysUntil, evaluateCompliance,
} from './rules.js';
import { audit, notify, insertNotifications, alertsForApp, collegeUserIds, adminUserIds } from './alerts.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const BASE_SQL = `
  SELECT a.*, i.name AS institution_name, i.type AS institution_type, i.city, i.state, i.region, i.aicte_code,
         u.name AS officer_name, u.designation AS officer_designation
  FROM applications a
  JOIN institutions i ON i.id = a.institution_id
  LEFT JOIN profiles u ON u.id = a.assigned_officer_id`;

const OPEN_LIST = OPEN_STATUSES.map((s) => `'${s}'`).join(',');

function scope(user) {
  if (user.role === 'ADMIN') return ['', []];
  if (user.role === 'OFFICER') return [' WHERE a.assigned_officer_id = ?', [user.id]];
  return [' WHERE a.institution_id = ?', [user.institution_id]];
}

export function canView(app, user) {
  if (user.role === 'ADMIN') return true;
  if (user.role === 'OFFICER') return app.assigned_officer_id === user.id;
  return app.institution_id === user.institution_id;
}

export function decorate(row, docs, now = new Date()) {
  const compliance = evaluateCompliance(row, docs, row.institution_type, now);
  const isOpen = OPEN_STATUSES.includes(row.status);
  return {
    ...row,
    category_label: CATEGORIES[row.category],
    status_label: STATUSES[row.status],
    is_open: isOpen,
    days_left: isOpen ? daysUntil(row.due_date, now) : null,
    pending_with: row.status === 'ACTION_REQUIRED' ? 'Institution' : isOpen ? 'Officer' : null,
    compliance,
    docs,
  };
}

async function docsByApp(ids) {
  if (!ids.length) return {};
  const rows = await query('SELECT * FROM documents WHERE application_id = ANY(?::int[]) ORDER BY id', [ids]);
  const out = {};
  for (const d of rows) (out[d.application_id] ||= []).push(d);
  return out;
}

const docsFor = (appId) => query('SELECT * FROM documents WHERE application_id = ? ORDER BY id', [appId]);

export async function listApplications(user, filters = {}) {
  const [where, params] = scope(user);
  const rows = await query(`${BASE_SQL}${where} ORDER BY a.submitted_at DESC`, params);
  const docs = await docsByApp(rows.map((r) => r.id));
  let list = rows.map((r) => decorate(r, docs[r.id] || []));
  const { status, category, q, flag } = filters;
  if (status) list = list.filter((a) => a.status === status);
  if (category) list = list.filter((a) => a.category === category);
  if (q) {
    const s = String(q).toLowerCase();
    list = list.filter((a) =>
      [a.app_no, a.institution_name, a.program, a.city, a.state, a.officer_name].some((v) => v && v.toLowerCase().includes(s))
    );
  }
  if (flag === 'overdue') list = list.filter((a) => a.is_open && a.days_left < 0);
  if (flag === 'due-soon') list = list.filter((a) => a.is_open && a.days_left >= 0 && a.days_left <= SLA.warnDays);
  if (flag === 'pending') list = list.filter((a) => a.status === 'SUBMITTED' || a.status === 'UNDER_REVIEW');
  if (flag === 'non-compliant') list = list.filter((a) => a.compliance.failed > 0);
  return list;
}

export async function officerWorkload() {
  const rows = await query(
    `SELECT u.id, u.name, u.email, u.designation, u.region, u.categories, u.max_load, u.active,
       (SELECT COUNT(*)::int FROM applications a WHERE a.assigned_officer_id = u.id AND a.status IN (${OPEN_LIST})) AS open_load,
       (SELECT COUNT(*)::int FROM applications a WHERE a.assigned_officer_id = u.id AND a.status IN ('APPROVED','REJECTED')) AS decided,
       (SELECT COUNT(*)::int FROM applications a WHERE a.assigned_officer_id = u.id AND a.status IN ('SUBMITTED','UNDER_REVIEW') AND a.due_date < ?) AS overdue
     FROM profiles u WHERE u.role = 'OFFICER' ORDER BY u.name`,
    [nowIso()]
  );
  return rows.map((o) => ({ ...o, categories: o.categories ? o.categories.split(',') : [] }));
}

// Rule-based assignment: category -> eligible designations, prefer same region, then lowest workload.
export async function pickOfficer(category, region, excludeId = null) {
  const roles = ASSIGNMENT_RULES[category] || [];
  const eligible = (await officerWorkload()).filter(
    (o) => o.active && o.id !== excludeId && o.categories.includes(category) && roles.includes(o.designation) && o.open_load < o.max_load
  );
  if (!eligible.length) return { officer: null, reason: `No active ${roles.join('/')} with free capacity handles ${CATEGORIES[category]}` };
  const sameRegion = (o) => (o.region === region ? 0 : 1);
  eligible.sort((a, b) => sameRegion(a) - sameRegion(b) || a.open_load - b.open_load || a.id - b.id);
  const o = eligible[0];
  const regionPart = o.region === region ? `same region (${region})` : `no eligible officer in ${region}, nearest available`;
  return {
    officer: o,
    reason: `Rule: ${CATEGORIES[category]} -> ${roles.join(' / ')}; ${regionPart}; lowest workload (${o.open_load} open of ${o.max_load}); ${eligible.length} eligible`,
  };
}

export async function assignOfficer(appId, actorId = null, manualOfficerId = null) {
  const app = await one(`${BASE_SQL} WHERE a.id = ?`, [appId]);
  if (!app) throw new HttpError(404, 'Application not found.');
  let officer;
  let reason;
  if (manualOfficerId) {
    officer = await one("SELECT * FROM profiles WHERE id = ? AND role = 'OFFICER'", [Number(manualOfficerId)]);
    if (!officer) throw new HttpError(400, 'Choose a valid officer.');
    reason = 'Manually reassigned by administrator';
  } else {
    ({ officer, reason } = await pickOfficer(app.category, app.region, app.assigned_officer_id));
  }
  if (!officer) {
    await audit(actorId, 'ASSIGNMENT_FAILED', 'application', appId, reason, appId);
    await insertNotifications(
      (await adminUserIds()).map((u) => [u, appId, 'ASSIGNMENT_FAILED', 'critical', `Could not auto-assign ${app.app_no}: ${reason}.`, null])
    );
    return null;
  }
  const previous = app.officer_name;
  await query('UPDATE applications SET assigned_officer_id = ?, updated_at = ? WHERE id = ?', [officer.id, nowIso(), appId]);
  await audit(
    actorId,
    previous ? 'OFFICER_REASSIGNED' : 'OFFICER_ASSIGNED',
    'application',
    appId,
    `${previous ? `${previous} -> ` : ''}${officer.name} (${officer.designation}, ${officer.region}). ${reason}`,
    appId
  );
  await notify(officer.id, appId, 'ASSIGNED', 'info', `New application assigned to you: ${app.app_no}, ${app.institution_name}.`);
  return officer;
}

async function storeDocument(appId, docType, file, expiryDate, actorId) {
  if (!DOC_TYPES[docType]) throw new HttpError(400, `Unknown document type: ${docType}`);
  if (EXPIRING_DOC_TYPES.includes(docType) && !expiryDate)
    throw new HttpError(400, `${DOC_TYPES[docType]} needs a valid-until date.`);
  const key = `${appId}/${crypto.randomBytes(10).toString('hex')}${path.extname(file.originalname).toLowerCase()}`;
  await putFile(key, file.buffer, file.mimetype);
  const old = await one('SELECT * FROM documents WHERE application_id = ? AND doc_type = ?', [appId, docType]);
  if (old) {
    await query('DELETE FROM documents WHERE id = ?', [old.id]);
    await removeFile(old.stored_name).catch(() => {});
  }
  const expiry = expiryDate ? new Date(`${expiryDate}T23:59:59`).toISOString() : null;
  const id = await insert(
    'INSERT INTO documents (application_id, doc_type, original_name, stored_name, size, uploaded_at, expiry_date, status) VALUES (?,?,?,?,?,?,?,?)',
    [appId, docType, file.originalname, key, file.size, nowIso(), expiry, 'PENDING']
  );
  await audit(actorId, old ? 'DOCUMENT_REPLACED' : 'DOCUMENT_UPLOADED', 'document', id, `${DOC_TYPES[docType]}: ${file.originalname}`, appId);
  return id;
}

function parseFields(body) {
  const f = {
    category: String(body.category || ''),
    program: String(body.program || '').trim(),
    academic_year: String(body.academic_year || '').trim(),
    duration_years: Number(body.duration_years),
    proposed_intake: Number(body.proposed_intake),
    faculty_count: Number(body.faculty_count),
    land_area: Number(body.land_area),
    built_up_area: Number(body.built_up_area),
  };
  if (!CATEGORIES[f.category]) throw new HttpError(400, 'Choose an application category.');
  if (!f.program) throw new HttpError(400, 'Enter the program or course name.');
  if (!/^\d{4}-\d{2}$/.test(f.academic_year)) throw new HttpError(400, 'Academic year must look like 2026-27.');
  for (const k of ['duration_years', 'proposed_intake', 'faculty_count', 'land_area', 'built_up_area'])
    if (!Number.isFinite(f[k]) || f[k] < 0) throw new HttpError(400, `Enter a valid number for ${k.replace(/_/g, ' ')}.`);
  if (f.proposed_intake <= 0 || f.duration_years <= 0) throw new HttpError(400, 'Intake and duration must be greater than zero.');
  return f;
}

export async function previewCompliance(user, body) {
  const inst = await one('SELECT * FROM institutions WHERE id = ?', [user.institution_id]);
  const app = { ...body, status: 'DRAFT' };
  for (const k of ['duration_years', 'proposed_intake', 'faculty_count', 'land_area', 'built_up_area']) app[k] = Number(body[k]) || 0;
  const docs = (body.docs || []).map((t) => ({
    doc_type: t,
    status: 'PENDING',
    expiry_date: body.expiries?.[t] ? new Date(`${body.expiries[t]}T23:59:59`).toISOString() : null,
  }));
  return evaluateCompliance(app, docs, inst?.type);
}

export async function createApplication(user, body, files) {
  const f = parseFields(body);
  const inst = await one('SELECT * FROM institutions WHERE id = ?', [user.institution_id]);
  if (!inst) throw new HttpError(400, 'Your account is not linked to an institution.');
  for (const file of files) {
    const t = file.fieldname.replace(/^doc_/, '');
    if (EXPIRING_DOC_TYPES.includes(t) && !body[`expiry_${t}`]) throw new HttpError(400, `${DOC_TYPES[t]} needs a valid-until date.`);
  }
  const id = await tx(async () => {
    const now = nowIso();
    const { n } = await one('SELECT COALESCE(MAX(id), 0) + 1 AS n FROM applications');
    const appNo = `AICTE-${f.academic_year}-${CATEGORY_CODES[f.category]}-${String(n).padStart(5, '0')}`;
    const appId = await insert(
      `INSERT INTO applications (app_no, institution_id, category, program, academic_year, duration_years, proposed_intake,
        faculty_count, land_area, built_up_area, status, submitted_at, due_date, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [appNo, inst.id, f.category, f.program, f.academic_year, f.duration_years, f.proposed_intake, f.faculty_count,
        f.land_area, f.built_up_area, 'SUBMITTED', now, addDays(now, SLA.reviewDays), now]
    );
    await query('INSERT INTO status_history (application_id, from_status, to_status, user_id, remark, created_at) VALUES (?,?,?,?,?,?)',
      [appId, null, 'SUBMITTED', user.id, 'Application submitted online', now]);
    await audit(user.id, 'APPLICATION_SUBMITTED', 'application', appId, `${appNo}: ${CATEGORIES[f.category]}, ${f.program}`, appId);
    for (const file of files) await storeDocument(appId, file.fieldname.replace(/^doc_/, ''), file, body[`expiry_${file.fieldname.replace(/^doc_/, '')}`], user.id);
    await assignOfficer(appId, null);
    return appId;
  });
  await alertsForApp(id);
  return id;
}

export async function uploadDocument(appId, user, docType, file, expiryDate) {
  const app = await one('SELECT * FROM applications WHERE id = ?', [appId]);
  if (!app || !canView(app, user)) throw new HttpError(404, 'Application not found.');
  if (!file) throw new HttpError(400, 'Choose a PDF, JPG or PNG file under 4 MB.');
  if (!OPEN_STATUSES.includes(app.status) && !EXPIRING_DOC_TYPES.includes(docType))
    throw new HttpError(400, 'This application is closed. Only renewed certificates can be uploaded.');
  await tx(async () => {
    await storeDocument(appId, docType, file, expiryDate, user.id);
    await query('UPDATE applications SET updated_at = ? WHERE id = ?', [nowIso(), appId]);
  });
  await notify(app.assigned_officer_id, appId, 'DOCUMENT_UPLOADED', 'info', `${app.app_no}: institution uploaded ${DOC_TYPES[docType]}.`);
  await alertsForApp(appId);
}

export async function reviewDocument(docId, user, decision, remark) {
  const doc = await one('SELECT * FROM documents WHERE id = ?', [docId]);
  if (!doc) throw new HttpError(404, 'Document not found.');
  const app = await one('SELECT * FROM applications WHERE id = ?', [doc.application_id]);
  if (!canView(app, user)) throw new HttpError(404, 'Document not found.');
  if (app.status !== 'UNDER_REVIEW') throw new HttpError(400, 'Start the review before verifying documents.');
  if (!['VERIFIED', 'REJECTED'].includes(decision)) throw new HttpError(400, 'Decision must be VERIFIED or REJECTED.');
  if (decision === 'REJECTED' && !String(remark || '').trim()) throw new HttpError(400, 'Give a reason so the institution knows what to fix.');
  await query('UPDATE documents SET status = ?, remark = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?',
    [decision, remark || null, user.id, nowIso(), docId]);
  await audit(user.id, decision === 'VERIFIED' ? 'DOCUMENT_VERIFIED' : 'DOCUMENT_REJECTED', 'document', docId,
    `${DOC_TYPES[doc.doc_type]}${remark ? `: ${remark}` : ''}`, app.id);
  if (decision === 'REJECTED')
    await insertNotifications(
      (await collegeUserIds(app.institution_id)).map((u) => [u, app.id, 'DOCUMENT_REJECTED', 'warning', `${app.app_no}: ${DOC_TYPES[doc.doc_type]} was rejected. Reason: ${remark}`, null])
    );
  return doc.application_id;
}

const TRANSITIONS = {
  SUBMITTED: { UNDER_REVIEW: ['OFFICER', 'ADMIN'] },
  UNDER_REVIEW: { ACTION_REQUIRED: ['OFFICER', 'ADMIN'], APPROVED: ['OFFICER', 'ADMIN'], REJECTED: ['OFFICER', 'ADMIN'] },
  ACTION_REQUIRED: { UNDER_REVIEW: ['COLLEGE'] },
};
const ACTION_LABELS = {
  'SUBMITTED>UNDER_REVIEW': { label: 'Start review', variant: 'primary' },
  'UNDER_REVIEW>ACTION_REQUIRED': { label: 'Request action from institution', variant: 'warn', needsRemark: true },
  'UNDER_REVIEW>APPROVED': { label: 'Approve', variant: 'ok' },
  'UNDER_REVIEW>REJECTED': { label: 'Reject', variant: 'danger', needsRemark: true },
  'ACTION_REQUIRED>UNDER_REVIEW': { label: 'Resubmit for review', variant: 'primary', needsRemark: true },
};

export function allowedActions(app, user) {
  if (!canView(app, user)) return [];
  return Object.entries(TRANSITIONS[app.status] || {})
    .filter(([, roles]) => roles.includes(user.role))
    .map(([to]) => ({ to, ...ACTION_LABELS[`${app.status}>${to}`] }));
}

export async function changeStatus(appId, user, to, remark) {
  const row = await one(`${BASE_SQL} WHERE a.id = ?`, [appId]);
  if (!row || !canView(row, user)) throw new HttpError(404, 'Application not found.');
  const allowed = TRANSITIONS[row.status]?.[to];
  if (!allowed || !allowed.includes(user.role))
    throw new HttpError(400, `Cannot move from ${STATUSES[row.status]} to ${STATUSES[to] || to}.`);
  const meta = ACTION_LABELS[`${row.status}>${to}`];
  remark = String(remark || '').trim();
  if (meta.needsRemark && !remark) throw new HttpError(400, 'Add a remark explaining this step.');
  if (to === 'APPROVED') {
    const c = decorate(row, await docsFor(appId)).compliance;
    const blocking = c.checks.filter((ch) => ch.key !== 'timeline' && ch.status !== 'pass');
    if (blocking.length)
      throw new HttpError(400, `Cannot approve yet. Unmet: ${blocking.map((b) => b.label).join('; ')}.`);
  }
  const now = nowIso();
  let due = row.due_date;
  if (to === 'ACTION_REQUIRED') due = addDays(now, SLA.responseDays);
  if (row.status === 'ACTION_REQUIRED' && to === 'UNDER_REVIEW') due = addDays(now, SLA.reReviewDays);
  const decided = to === 'APPROVED' || to === 'REJECTED' ? now : null;
  await tx(async () => {
    await query('UPDATE applications SET status = ?, due_date = ?, decided_at = COALESCE(?, decided_at), updated_at = ? WHERE id = ?',
      [to, due, decided, now, appId]);
    await query('INSERT INTO status_history (application_id, from_status, to_status, user_id, remark, created_at) VALUES (?,?,?,?,?,?)',
      [appId, row.status, to, user.id, remark || null, now]);
    await audit(user.id, 'STATUS_CHANGED', 'application', appId, `${STATUSES[row.status]} -> ${STATUSES[to]}${remark ? `: ${remark}` : ''}`, appId);
  });
  const message = {
    UNDER_REVIEW: row.status === 'ACTION_REQUIRED' ? null : `${row.app_no} is now under review by ${row.officer_name}.`,
    ACTION_REQUIRED: `Action required on ${row.app_no}: ${remark} Respond within ${SLA.responseDays} days.`,
    APPROVED: `${row.app_no} has been approved.`,
    REJECTED: `${row.app_no} has been rejected. Reason: ${remark}`,
  }[to];
  const rows = [];
  if (message)
    for (const u of await collegeUserIds(row.institution_id))
      rows.push([u, appId, `STATUS_${to}`, to === 'REJECTED' || to === 'ACTION_REQUIRED' ? 'warning' : 'info', message, null]);
  if (row.status === 'ACTION_REQUIRED')
    rows.push([row.assigned_officer_id, appId, 'RESUBMITTED', 'info', `${row.app_no} was resubmitted by the institution: ${remark}`, null]);
  await insertNotifications(rows);
  await alertsForApp(appId);
}

export async function getApplication(appId, user) {
  const row = await one(`${BASE_SQL} WHERE a.id = ?`, [appId]);
  if (!row || !canView(row, user)) throw new HttpError(404, 'Application not found.');
  const app = decorate(row, await docsFor(appId));
  const byType = Object.fromEntries(app.docs.map((d) => [d.doc_type, d]));
  const documents = REQUIRED_DOCS[app.category].map((t) => ({
    type: t,
    label: DOC_TYPES[t],
    expiring: EXPIRING_DOC_TYPES.includes(t),
    doc: byType[t] || null,
  }));
  const [history, activity, institution, officers] = await Promise.all([
    query(
      `SELECT h.*, u.name AS user_name, u.role AS user_role FROM status_history h
       LEFT JOIN profiles u ON u.id = h.user_id WHERE h.application_id = ? ORDER BY h.created_at, h.id`,
      [appId]
    ),
    query(
      `SELECT l.*, u.name AS user_name, u.role AS user_role FROM audit_log l
       LEFT JOIN profiles u ON u.id = l.user_id WHERE l.application_id = ? ORDER BY l.created_at DESC, l.id DESC`,
      [appId]
    ),
    one('SELECT * FROM institutions WHERE id = ?', [app.institution_id]),
    user.role === 'ADMIN' ? officerWorkload() : Promise.resolve(undefined),
  ]);
  const assignment = activity.find((a) => a.action === 'OFFICER_ASSIGNED' || a.action === 'OFFICER_REASSIGNED');
  const isOfficer = user.role === 'OFFICER' || user.role === 'ADMIN';
  return {
    app,
    institution,
    norms: NORMS[app.institution_type],
    documents,
    history,
    activity,
    assignment_reason: assignment?.details || null,
    actions: allowedActions(app, user),
    permissions: {
      canUpload: user.role === 'COLLEGE' && app.is_open,
      canRenew: user.role === 'COLLEGE' && !app.is_open,
      canVerify: isOfficer && app.status === 'UNDER_REVIEW',
      canReassign: user.role === 'ADMIN' && app.is_open,
    },
    officers,
  };
}

export async function dashboard(user) {
  const apps = await listApplications(user);
  const count = (fn) => apps.filter(fn).length;
  const open = apps.filter((a) => a.is_open);
  const totals = {
    total: apps.length,
    submitted: count((a) => a.status === 'SUBMITTED'),
    under_review: count((a) => a.status === 'UNDER_REVIEW'),
    action_required: count((a) => a.status === 'ACTION_REQUIRED'),
    approved: count((a) => a.status === 'APPROVED'),
    rejected: count((a) => a.status === 'REJECTED'),
    overdue: count((a) => a.is_open && a.days_left < 0),
    due_soon: count((a) => a.is_open && a.days_left >= 0 && a.days_left <= SLA.warnDays),
    non_compliant: count((a) => a.compliance.failed > 0),
    avg_score: apps.length ? Math.round(apps.reduce((s, a) => s + a.compliance.score, 0) / apps.length) : 0,
  };
  totals.pending = totals.submitted + totals.under_review;
  const byCategory = Object.entries(CATEGORIES).map(([key, label]) => ({
    key, label, count: count((a) => a.category === key), open: open.filter((a) => a.category === key).length,
  }));
  const strip = ({ docs, compliance, ...a }) => ({ ...a, compliance: { score: compliance.score, failed: compliance.failed } });
  const attention = open
    .filter((a) => a.days_left <= SLA.warnDays || a.compliance.failed > 0)
    .sort((a, b) => a.days_left - b.days_left)
    .slice(0, 8)
    .map(strip);
  const ids = apps.map((a) => a.id);
  const recent = ids.length
    ? await query(
        `SELECT h.*, a.app_no, u.name AS user_name FROM status_history h
         JOIN applications a ON a.id = h.application_id LEFT JOIN profiles u ON u.id = h.user_id
         WHERE h.application_id = ANY(?::int[]) ORDER BY h.created_at DESC LIMIT 8`,
        [ids]
      )
    : [];
  const decided = apps.filter((a) => a.decided_at);
  const avgDays = decided.length
    ? Math.round(decided.reduce((s, a) => s + (new Date(a.decided_at) - new Date(a.submitted_at)) / 86400000, 0) / decided.length)
    : null;
  return {
    totals,
    byCategory,
    attention,
    recent,
    avg_decision_days: avgDays,
    workload: user.role === 'ADMIN' ? await officerWorkload() : undefined,
  };
}
