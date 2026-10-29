import crypto from 'node:crypto';
import { query, one, insert, nowIso } from './db.js';
import { supabaseAdmin } from './supabase.js';
import { audit } from './alerts.js';
import { CATEGORIES, DESIGNATIONS } from './rules.js';
import { REGIONS } from './auth.js';
import { HttpError, officerWorkload } from './workflow.js';
import { appUrl, deliverable, layout, mailEnabled, sendMail } from './mailer.js';

const OPEN = "'SUBMITTED','UNDER_REVIEW','ACTION_REQUIRED'";

export async function listUsers() {
  const [workload, profiles, colleges] = await Promise.all([
    officerWorkload(),
    query(`SELECT id, name, email, role, designation, region, auth_id IS NOT NULL AS has_login, suspended, created_at
           FROM profiles WHERE role IN ('OFFICER','ADMIN') ORDER BY name`),
    query(`SELECT p.id, p.name, p.email, p.auth_id IS NOT NULL AS has_login, p.suspended, p.created_at,
             i.id AS institution_id, i.name AS institution_name, i.aicte_code, i.type, i.city, i.state, i.region,
             (SELECT COUNT(*)::int FROM applications a WHERE a.institution_id = i.id) AS applications,
             (SELECT COUNT(*)::int FROM applications a WHERE a.institution_id = i.id AND a.status IN (${OPEN})) AS open_applications
           FROM profiles p JOIN institutions i ON i.id = p.institution_id
           WHERE p.role = 'COLLEGE' ORDER BY p.auth_id IS NULL, i.name`),
  ]);
  const byId = Object.fromEntries(profiles.map((p) => [p.id, p]));
  return {
    officers: workload.map((o) => ({ ...o, ...byId[o.id], categories: o.categories })),
    admins: profiles.filter((p) => p.role === 'ADMIN'),
    institutions: colleges,
    options: { designations: DESIGNATIONS, regions: REGIONS, categories: CATEGORIES },
  };
}

function cleanOfficerFields(body, { partial = false } = {}) {
  const f = {};
  if (!partial || body.name !== undefined) {
    f.name = String(body.name || '').trim();
    if (!f.name) throw new HttpError(400, 'Enter the officer\'s name.');
  }
  if (!partial || body.designation !== undefined) {
    if (!DESIGNATIONS.includes(body.designation)) throw new HttpError(400, 'Choose a designation.');
    f.designation = body.designation;
  }
  if (!partial || body.region !== undefined) {
    if (!REGIONS.includes(body.region)) throw new HttpError(400, 'Choose a region.');
    f.region = body.region;
  }
  if (!partial || body.categories !== undefined) {
    const cats = [...new Set(body.categories || [])].filter((c) => CATEGORIES[c]);
    if (!cats.length) throw new HttpError(400, 'Pick at least one application category this officer handles.');
    f.categories = cats.join(',');
  }
  if (!partial || body.max_load !== undefined) {
    const n = Number(body.max_load);
    if (!Number.isInteger(n) || n < 1 || n > 50) throw new HttpError(400, 'Maximum workload must be a whole number from 1 to 50.');
    f.max_load = n;
  }
  return f;
}

// Creates the Supabase login and emails a code the person uses (via "Forgot password") to set their own password.
async function grantLogin(email, name) {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: crypto.randomBytes(18).toString('base64url'),
    email_confirm: true,
    user_metadata: { name },
  });
  if (error) {
    if (/already/i.test(error.message)) throw new HttpError(409, `${email} already has a login. Use a different email.`);
    throw new HttpError(400, error.message);
  }
  const base = appUrl();
  await supabaseAdmin.auth.resetPasswordForEmail(email, { redirectTo: `${base}/reset-password` }).catch(() => {});
  if (mailEnabled)
    await sendMail({
      to: email,
      subject: 'Your AICTE Approvals account',
      html: layout({
        heading: 'Your account is ready',
        intro: `Hello ${name}, an administrator has given you access to the AICTE Approvals portal. To set your password, open the portal, choose "Forgot password?", enter this email address and type the code we sent you in a separate email.`,
        cta: { href: base, label: 'Open the portal' },
      }),
      text: `Hello ${name}, you now have access to the AICTE Approvals portal: ${base}. Use "Forgot password?" with this email to set your password.`,
    });
  return data.user.id;
}

export async function createUser(body, actor) {
  const role = body.role === 'ADMIN' ? 'ADMIN' : 'OFFICER';
  const email = String(body.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address.');
  if (await one('SELECT id FROM profiles WHERE lower(email) = ?', [email])) throw new HttpError(409, 'Someone in the portal already uses this email.');
  const fields =
    role === 'OFFICER'
      ? cleanOfficerFields(body)
      : { name: String(body.name || '').trim(), designation: 'Administrator', region: null, categories: null, max_load: 0 };
  if (!fields.name) throw new HttpError(400, 'Enter a name.');
  const authId = await grantLogin(email, fields.name);
  const id = await insert(
    'INSERT INTO profiles (auth_id, name, email, role, designation, region, categories, max_load, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
    [authId, fields.name, email, role, fields.designation, fields.region, fields.categories, fields.max_load, nowIso()]
  );
  await audit(actor.id, 'USER_CREATED', 'user', id, `${fields.name} (${role === 'ADMIN' ? 'Administrator' : `${fields.designation}, ${fields.region}`}) <${email}>`);
  return { id, emailed: deliverable(email) };
}

export async function updateUser(id, body, actor) {
  const p = await one('SELECT * FROM profiles WHERE id = ?', [id]);
  if (!p) throw new HttpError(404, 'User not found.');
  const f = p.role === 'OFFICER' ? cleanOfficerFields(body, { partial: true }) : {};
  if (p.role === 'ADMIN' && body.name !== undefined) f.name = String(body.name).trim() || p.name;
  // The email can only change while the person has no login yet (it is the login identity).
  if (body.email !== undefined && body.email.trim().toLowerCase() !== p.email) {
    if (p.auth_id) throw new HttpError(400, 'This person already has a login, so their email cannot be changed here.');
    const email = body.email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address.');
    if (await one('SELECT id FROM profiles WHERE lower(email) = ? AND id <> ?', [email, id])) throw new HttpError(409, 'Someone in the portal already uses this email.');
    f.email = email;
  }
  const keys = Object.keys(f);
  if (!keys.length) return;
  await query(`UPDATE profiles SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...keys.map((k) => f[k]), id]);
  await audit(actor.id, 'USER_UPDATED', 'user', id, `${f.name || p.name}: ${keys.map((k) => `${k} ${p[k] ?? '-'} -> ${f[k]}`).join('; ')}`);
}

export async function enableLogin(id, actor) {
  const p = await one('SELECT * FROM profiles WHERE id = ?', [id]);
  if (!p) throw new HttpError(404, 'User not found.');
  if (p.auth_id) throw new HttpError(400, `${p.name} can already sign in.`);
  if (!deliverable(p.email)) throw new HttpError(400, `${p.email} is a sample address. Edit the email to a real one first.`);
  const authId = await grantLogin(p.email, p.name);
  await query('UPDATE profiles SET auth_id = ? WHERE id = ?', [authId, id]);
  await audit(actor.id, 'LOGIN_ENABLED', 'user', id, `${p.name} <${p.email}> can now sign in`);
}

export async function setSuspended(id, suspended, actor) {
  if (id === actor.id) throw new HttpError(400, 'You cannot suspend your own account.');
  const p = await one('SELECT * FROM profiles WHERE id = ?', [id]);
  if (!p) throw new HttpError(404, 'User not found.');
  // Every API request re-reads the profile, so a suspension takes effect on the person's next action.
  await query('UPDATE profiles SET suspended = ? WHERE id = ?', [suspended ? 1 : 0, id]);
  await audit(actor.id, suspended ? 'USER_SUSPENDED' : 'USER_RESTORED', 'user', id, `${p.name} <${p.email}> ${suspended ? 'suspended' : 'restored'}`);
}
