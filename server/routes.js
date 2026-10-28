import { Router } from 'express';
import multer from 'multer';
import { query, one } from './db.js';
import { authenticate, requireRole, REGIONS } from './auth.js';
import { signedUrl } from './supabase.js';
import {
  STATUSES, CATEGORIES, DOC_TYPES, REQUIRED_DOCS, EXPIRING_DOC_TYPES, NORMS, SLA, ASSIGNMENT_RULES,
} from './rules.js';
import { audit } from './alerts.js';
import {
  HttpError, canView, listApplications, getApplication, createApplication, previewCompliance, uploadDocument,
  reviewDocument, changeStatus, assignOfficer, officerWorkload, dashboard,
} from './workflow.js';

// Express 4 does not catch rejected promises; route them to the error handler.
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /\.(pdf|png|jpe?g)$/i.test(file.originalname)),
});

export const router = Router();

// ---- Public (no sign-in) ----
router.get('/public/options', (req, res) => res.json({ types: Object.keys(NORMS), regions: REGIONS }));
router.get('/public/institution-code', ah(async (req, res) => {
  const code = String(req.query.code || '').trim();
  const taken = code ? await one('SELECT id FROM institutions WHERE aicte_code = ?', [code]) : null;
  res.json({ available: !taken });
}));

router.use(authenticate);

router.get('/auth/me', (req, res) => res.json({ user: req.user }));
router.post('/auth/signed-in', ah(async (req, res) => {
  await audit(req.user.id, 'SIGNED_IN', 'user', req.user.id, `${req.user.name} signed in`);
  res.json({ ok: true });
}));

router.get('/meta', (req, res) =>
  res.json({ STATUSES, CATEGORIES, DOC_TYPES, REQUIRED_DOCS, EXPIRING_DOC_TYPES, NORMS, SLA, ASSIGNMENT_RULES })
);

router.get('/dashboard', ah(async (req, res) => res.json(await dashboard(req.user))));

router.get('/applications', ah(async (req, res) => {
  const rows = (await listApplications(req.user, req.query)).map(({ docs, compliance, ...a }) => ({
    ...a,
    compliance: { score: compliance.score, failed: compliance.failed, warned: compliance.warned, missing: compliance.missing.length },
  }));
  res.json(rows);
}));

router.post('/applications', requireRole('COLLEGE'), upload.any(), ah(async (req, res) => {
  const id = await createApplication(req.user, req.body, req.files || []);
  res.status(201).json({ id });
}));

router.post('/compliance/preview', requireRole('COLLEGE'), ah(async (req, res) => res.json(await previewCompliance(req.user, req.body || {}))));

router.get('/applications/:id', ah(async (req, res) => res.json(await getApplication(Number(req.params.id), req.user))));

router.post('/applications/:id/status', ah(async (req, res) => {
  await changeStatus(Number(req.params.id), req.user, req.body?.to, req.body?.remark);
  res.json(await getApplication(Number(req.params.id), req.user));
}));

router.post('/applications/:id/assign', requireRole('ADMIN'), ah(async (req, res) => {
  const officer = await assignOfficer(Number(req.params.id), req.user.id, req.body?.officer_id || null);
  if (!officer) throw new HttpError(409, 'No eligible officer has free capacity for this category.');
  res.json(await getApplication(Number(req.params.id), req.user));
}));

router.post('/applications/:id/documents', requireRole('COLLEGE'), upload.single('file'), ah(async (req, res) => {
  await uploadDocument(Number(req.params.id), req.user, req.body?.doc_type, req.file, req.body?.expiry_date);
  res.json(await getApplication(Number(req.params.id), req.user));
}));

// Documents live in a private Supabase Storage bucket; hand out a short-lived signed link.
router.get('/documents/:id/file', ah(async (req, res) => {
  const doc = await one('SELECT * FROM documents WHERE id = ?', [Number(req.params.id)]);
  const app = doc && (await one('SELECT * FROM applications WHERE id = ?', [doc.application_id]));
  if (!doc || !canView(app, req.user)) throw new HttpError(404, 'Document not found.');
  res.redirect(await signedUrl(doc.stored_name));
}));

router.post('/documents/:id/review', requireRole('OFFICER', 'ADMIN'), ah(async (req, res) => {
  const appId = await reviewDocument(Number(req.params.id), req.user, req.body?.decision, req.body?.remark);
  res.json(await getApplication(appId, req.user));
}));

router.get('/officers', requireRole('ADMIN'), ah(async (req, res) => res.json(await officerWorkload())));

router.post('/officers/:id/toggle', requireRole('ADMIN'), ah(async (req, res) => {
  const o = await one("SELECT * FROM profiles WHERE id = ? AND role = 'OFFICER'", [Number(req.params.id)]);
  if (!o) throw new HttpError(404, 'Officer not found.');
  await query('UPDATE profiles SET active = ? WHERE id = ?', [o.active ? 0 : 1, o.id]);
  await audit(req.user.id, o.active ? 'OFFICER_DEACTIVATED' : 'OFFICER_ACTIVATED', 'user', o.id, `${o.name} ${o.active ? 'removed from' : 'added to'} auto-assignment pool`);
  res.json(await officerWorkload());
}));

router.get('/notifications', ah(async (req, res) => {
  const [items, count] = await Promise.all([
    query(
      `SELECT n.*, a.app_no FROM notifications n LEFT JOIN applications a ON a.id = n.application_id
       WHERE n.user_id = ? ORDER BY n.is_read, n.created_at DESC, n.id DESC LIMIT 60`,
      [req.user.id]
    ),
    one('SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = ? AND is_read = 0', [req.user.id]),
  ]);
  res.json({ items, unread: count.n });
}));
router.post('/notifications/read-all', ah(async (req, res) => {
  await query('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [req.user.id]);
  res.json({ ok: true });
}));
router.post('/notifications/:id/read', ah(async (req, res) => {
  await query('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', [Number(req.params.id), req.user.id]);
  res.json({ ok: true });
}));

const AUDIT_SQL = `SELECT l.*, u.name AS user_name, u.role AS user_role, a.app_no FROM audit_log l
  LEFT JOIN profiles u ON u.id = l.user_id LEFT JOIN applications a ON a.id = l.application_id`;

router.get('/audit', requireRole('ADMIN'), ah(async (req, res) => {
  let rows = await query(`${AUDIT_SQL} ORDER BY l.created_at DESC, l.id DESC LIMIT 500`);
  if (req.query.action) rows = rows.filter((r) => r.action === req.query.action);
  if (req.query.q) {
    const s = String(req.query.q).toLowerCase();
    rows = rows.filter((r) => [r.details, r.user_name, r.app_no, r.action].some((v) => v && v.toLowerCase().includes(s)));
  }
  const actions = (await query('SELECT DISTINCT action FROM audit_log ORDER BY action')).map((r) => r.action);
  res.json({ rows, actions });
}));

const csvCell = (v) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const sendCsv = (res, name, header, rows) => {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.send('﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n'));
};
const day = (iso) => (iso ? iso.slice(0, 10) : '');

router.get('/reports/applications', requireRole('ADMIN', 'OFFICER'), ah(async (req, res) => {
  const rows = (await listApplications(req.user)).map((a) => [
    a.app_no, a.institution_name, a.aicte_code, a.city, a.state, a.region, a.category_label, a.program, a.academic_year,
    a.status_label, a.officer_name, day(a.submitted_at), a.is_open ? day(a.due_date) : '', a.is_open ? a.days_left : '',
    day(a.decided_at), a.compliance.score, a.compliance.missing.length, a.compliance.failed,
  ]);
  sendCsv(res, `aicte-applications-${day(new Date().toISOString())}.csv`,
    ['Application No', 'Institution', 'AICTE ID', 'City', 'State', 'Region', 'Category', 'Program', 'Academic Year', 'Status',
      'Officer', 'Submitted', 'Due', 'Days Left', 'Decided', 'Compliance %', 'Missing Docs', 'Failed Checks'], rows);
}));

router.get('/reports/audit', requireRole('ADMIN'), ah(async (req, res) => {
  const rows = (await query(`${AUDIT_SQL} ORDER BY l.created_at DESC, l.id DESC`))
    .map((r) => [r.created_at, r.user_name || 'System', r.user_role || 'SYSTEM', r.action, r.app_no, r.details]);
  sendCsv(res, `aicte-audit-trail-${day(new Date().toISOString())}.csv`, ['Timestamp (UTC)', 'User', 'Role', 'Action', 'Application', 'Details'], rows);
}));
