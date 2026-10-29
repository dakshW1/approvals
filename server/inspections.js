import crypto from 'node:crypto';
import { query, one, insert, nowIso, tx } from './db.js';
import { putFile, signedUrls } from './supabase.js';
import { INSPECTION_CATEGORIES, CAMPUS_RADIUS_M, distanceMetres } from './rules.js';
import { audit, insertNotifications, collegeUserIds, adminUserIds } from './alerts.js';
import { HttpError, canView } from './workflow.js';

export const inspectionRequired = (app) => INSPECTION_CATEGORIES.includes(app.category);

const isStaff = (user) => user.role === 'OFFICER' || user.role === 'ADMIN';
const fmtDay = (iso) => new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

async function appFor(appId, user) {
  const app = await one(
    `SELECT a.*, i.name AS institution_name, i.lat AS campus_lat, i.lng AS campus_lng
     FROM applications a JOIN institutions i ON i.id = a.institution_id WHERE a.id = ?`,
    [appId]
  );
  if (!app || !canView(app, user)) throw new HttpError(404, 'Application not found.');
  return app;
}

async function inspectionFor(inspectionId, user) {
  const insp = await one('SELECT * FROM inspections WHERE id = ?', [inspectionId]);
  if (!insp) throw new HttpError(404, 'Inspection not found.');
  const app = await appFor(insp.application_id, user);
  return { insp, app };
}

function locationVerdict(photo) {
  if (photo.lat === null || photo.lat === undefined) return 'no_location';
  if (photo.distance_m === null || photo.distance_m === undefined) return 'no_campus';
  return photo.distance_m <= CAMPUS_RADIUS_M ? 'on_campus' : 'off_campus';
}

// The inspection as shown on the application page, with short-lived links to the photos.
export async function loadInspection(app) {
  const insp = await one(
    `SELECT n.*, s.name AS scheduled_by_name, c.name AS completed_by_name FROM inspections n
     LEFT JOIN profiles s ON s.id = n.scheduled_by LEFT JOIN profiles c ON c.id = n.completed_by
     WHERE n.application_id = ?`,
    [app.id]
  );
  const required = inspectionRequired(app);
  const campus = app.campus_lat !== undefined ? { lat: app.campus_lat, lng: app.campus_lng } : null;
  if (!insp) return { required, campus, inspection: null };
  const photos = await query(
    `SELECT p.*, u.name AS uploaded_by_name FROM inspection_photos p LEFT JOIN profiles u ON u.id = p.uploaded_by
     WHERE p.inspection_id = ? ORDER BY p.uploaded_at, p.id`,
    [insp.id]
  );
  const urls = await signedUrls(photos.map((p) => p.stored_name)).catch(() => ({}));
  return {
    required,
    campus,
    radius_m: CAMPUS_RADIUS_M,
    inspection: {
      ...insp,
      photos: photos.map((p) => ({ ...p, url: urls[p.stored_name] || null, verdict: locationVerdict(p) })),
      off_campus: photos.filter((p) => locationVerdict(p) === 'off_campus').length,
      no_location: photos.filter((p) => locationVerdict(p) === 'no_location').length,
    },
  };
}

// What the inspection means for approval: not done yet blocks outright; a deficient report can only be
// waived with a recorded exception.
export function inspectionBlocker(app, insp) {
  if (!inspectionRequired(app)) return null;
  if (!insp || insp.status !== 'COMPLETED')
    return { key: 'inspection', label: 'Site inspection', detail: insp ? `Scheduled for ${fmtDay(insp.scheduled_for)}, not completed yet` : 'Not scheduled yet', hard: true };
  if (insp.recommendation === 'DEFICIENT')
    return { key: 'inspection', label: 'Site inspection', detail: 'Committee recommended: deficient', hard: false };
  return null;
}

export async function scheduleInspection(appId, user, body) {
  if (!isStaff(user)) throw new HttpError(403, 'Only AICTE staff can schedule inspections.');
  const app = await appFor(appId, user);
  if (app.status !== 'UNDER_REVIEW') throw new HttpError(400, 'Start the review before scheduling a site inspection.');
  const date = String(body.scheduled_for || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'Choose the visit date.');
  const committee = String(body.committee || '').trim();
  if (!committee) throw new HttpError(400, 'List the committee members visiting.');
  const when = new Date(`${date}T10:00:00`).toISOString();
  const existing = await one('SELECT * FROM inspections WHERE application_id = ?', [appId]);
  if (existing?.status === 'COMPLETED') throw new HttpError(400, 'This inspection has already been completed.');
  if (existing) await query('UPDATE inspections SET scheduled_for = ?, committee = ? WHERE id = ?', [when, committee, existing.id]);
  else
    await insert(
      'INSERT INTO inspections (application_id, status, scheduled_for, committee, scheduled_by, created_at) VALUES (?,?,?,?,?,?)',
      [appId, 'SCHEDULED', when, committee, user.id, nowIso()]
    );
  const verb = existing ? 'rescheduled' : 'scheduled';
  await audit(user.id, existing ? 'INSPECTION_RESCHEDULED' : 'INSPECTION_SCHEDULED', 'application', appId, `Site visit ${verb} for ${fmtDay(when)}. Committee: ${committee}`, appId);
  await insertNotifications(
    (await collegeUserIds(app.institution_id)).map((u) => [
      u, appId, 'INSPECTION_SCHEDULED', 'info',
      `Site inspection for ${app.app_no} ${verb} on ${fmtDay(when)}. Committee: ${committee}.`, null,
    ])
  );
}

export async function addPhoto(inspectionId, user, file, body) {
  if (!isStaff(user)) throw new HttpError(403, 'Only AICTE staff can add inspection photos.');
  const { insp, app } = await inspectionFor(inspectionId, user);
  if (insp.status !== 'SCHEDULED') throw new HttpError(400, 'This inspection is already completed.');
  if (!file) throw new HttpError(400, 'Choose a photo (JPG or PNG under 4 MB).');
  if (!/^image\/(jpeg|png|webp)$/.test(file.mimetype)) throw new HttpError(400, 'Photos must be JPG, PNG or WebP.');
  const lat = body.lat === '' || body.lat === undefined ? null : Number(body.lat);
  const lng = body.lng === '' || body.lng === undefined ? null : Number(body.lng);
  const hasLoc = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  const distance = hasLoc && app.campus_lat !== null ? distanceMetres(lat, lng, app.campus_lat, app.campus_lng) : null;
  const ext = file.mimetype === 'image/png' ? '.png' : file.mimetype === 'image/webp' ? '.webp' : '.jpg';
  const key = `inspections/${inspectionId}/${crypto.randomBytes(8).toString('hex')}${ext}`;
  await putFile(key, file.buffer, file.mimetype);
  const takenAt = body.taken_at && !Number.isNaN(new Date(body.taken_at).getTime()) ? new Date(body.taken_at).toISOString() : null;
  const source = hasLoc ? (body.location_source === 'exif' ? 'exif' : 'device') : 'none';
  await insert(
    `INSERT INTO inspection_photos (inspection_id, stored_name, caption, lat, lng, accuracy_m, location_source, taken_at, distance_m, uploaded_by, uploaded_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [inspectionId, key, String(body.caption || '').trim().slice(0, 200) || null, hasLoc ? lat : null, hasLoc ? lng : null,
      Number(body.accuracy) || null, source, takenAt, distance, user.id, nowIso()]
  );
  const where = !hasLoc ? 'no location' : distance === null ? 'campus location not on file' : `${(distance / 1000).toFixed(2)} km from campus${distance > CAMPUS_RADIUS_M ? ' (outside campus)' : ''}`;
  await audit(user.id, 'INSPECTION_PHOTO_ADDED', 'application', insp.application_id, `Photo added (${source === 'exif' ? 'GPS from photo' : source === 'device' ? 'GPS from device' : 'no GPS'}): ${where}`, insp.application_id);
}

export async function completeInspection(inspectionId, user, body) {
  if (!isStaff(user)) throw new HttpError(403, 'Only AICTE staff can complete inspections.');
  const { insp, app } = await inspectionFor(inspectionId, user);
  if (insp.status === 'COMPLETED') throw new HttpError(400, 'This inspection is already completed.');
  const findings = String(body.findings || '').trim();
  if (findings.length < 20) throw new HttpError(400, 'Write the committee findings (at least 20 characters).');
  if (!['SATISFACTORY', 'DEFICIENT'].includes(body.recommendation)) throw new HttpError(400, 'Choose the committee recommendation.');
  const { n } = await one('SELECT COUNT(*)::int AS n FROM inspection_photos WHERE inspection_id = ?', [inspectionId]);
  if (!n) throw new HttpError(400, 'Add at least one site photo before completing the inspection.');
  const now = nowIso();
  await tx(async () => {
    await query('UPDATE inspections SET status = ?, findings = ?, recommendation = ?, completed_by = ?, completed_at = ? WHERE id = ?',
      ['COMPLETED', findings, body.recommendation, user.id, now, inspectionId]);
    await audit(user.id, 'INSPECTION_COMPLETED', 'application', insp.application_id, `Recommendation: ${body.recommendation === 'SATISFACTORY' ? 'satisfactory' : 'deficient'}. ${findings}`, insp.application_id);
  });
  const verdict = body.recommendation === 'SATISFACTORY' ? 'satisfactory' : 'deficient';
  const rows = (await collegeUserIds(app.institution_id)).map((u) => [u, app.id, 'INSPECTION_COMPLETED', body.recommendation === 'DEFICIENT' ? 'warning' : 'info', `Site inspection for ${app.app_no} completed. Committee found it ${verdict}.`, null]);
  if (body.recommendation === 'DEFICIENT')
    for (const u of await adminUserIds()) rows.push([u, app.id, 'INSPECTION_COMPLETED', 'warning', `Site inspection for ${app.app_no} (${app.institution_name}) found deficiencies.`, null]);
  await insertNotifications(rows);
}

// Use a trusted photo's GPS as the campus location (for institutions registered without one).
export async function setCampusFromPhoto(photoId, user) {
  if (!isStaff(user)) throw new HttpError(403, 'Only AICTE staff can set the campus location.');
  const photo = await one('SELECT * FROM inspection_photos WHERE id = ?', [photoId]);
  if (!photo) throw new HttpError(404, 'Photo not found.');
  const { app } = await inspectionFor(photo.inspection_id, user);
  if (photo.lat === null) throw new HttpError(400, 'This photo has no location.');
  await query('UPDATE institutions SET lat = ?, lng = ? WHERE id = ?', [photo.lat, photo.lng, app.institution_id]);
  // Re-measure every inspection photo for this institution against the new campus point.
  const photos = await query(
    `SELECT p.id, p.lat, p.lng FROM inspection_photos p JOIN inspections n ON n.id = p.inspection_id
     JOIN applications a ON a.id = n.application_id WHERE a.institution_id = ? AND p.lat IS NOT NULL`,
    [app.institution_id]
  );
  for (const p of photos) await query('UPDATE inspection_photos SET distance_m = ? WHERE id = ?', [distanceMetres(p.lat, p.lng, photo.lat, photo.lng), p.id]);
  await audit(user.id, 'CAMPUS_LOCATION_SET', 'application', app.id, `Campus location set to ${photo.lat.toFixed(5)}, ${photo.lng.toFixed(5)} from an inspection photo`, app.id);
}
