import { one, insert, tx, nowIso } from './db.js';
import { supabaseAdmin } from './supabase.js';
import { audit } from './alerts.js';
import { NORMS } from './rules.js';

export const REGIONS = ['North', 'South', 'East', 'West', 'Central'];

// Supabase access tokens are verified with Supabase Auth; results are cached briefly per token.
const tokenCache = new Map();
async function authUserFor(token) {
  const hit = tokenCache.get(token);
  if (hit && hit.exp > Date.now()) return hit.user;
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) return null;
  if (tokenCache.size > 500) tokenCache.clear();
  tokenCache.set(token, { user: data.user, exp: Date.now() + 60_000 });
  return data.user;
}

export async function publicUser(p) {
  if (!p) return null;
  const institution = p.institution_id
    ? await one('SELECT id, aicte_code, name, type, city, state, region FROM institutions WHERE id = ?', [p.institution_id])
    : null;
  return { ...p, institution };
}

// Institutions register themselves; their details travel in the sign-up metadata and the
// portal profile is created on their first authenticated request. Officers and admins are never self-registered.
async function createInstitutionProfile(authUser) {
  const m = authUser.user_metadata || {};
  if (m.signup !== 'institution' || !m.institution_name) return null;
  const type = NORMS[m.type] ? m.type : 'Engineering';
  const region = REGIONS.includes(m.region) ? m.region : 'Central';
  let code = String(m.aicte_code || '').trim();
  if (!code || (await one('SELECT id FROM institutions WHERE aicte_code = ?', [code])))
    code = `1-${Math.floor(10000000 + Math.random() * 89999999)}`;
  return tx(async () => {
    const instId = await insert(
      'INSERT INTO institutions (aicte_code, name, type, city, state, region, established) VALUES (?,?,?,?,?,?,?)',
      [code, String(m.institution_name).trim(), type, m.city || null, m.state || null, region, new Date().getFullYear()]
    );
    const id = await insert(
      'INSERT INTO profiles (auth_id, name, email, role, institution_id, designation, region, created_at) VALUES (?,?,?,?,?,?,?,?)',
      [authUser.id, String(m.name || 'Principal').trim(), authUser.email.toLowerCase(), 'COLLEGE', instId, 'Principal', region, nowIso()]
    );
    await audit(id, 'INSTITUTION_REGISTERED', 'institution', instId, `${m.institution_name} registered (${type}, ${region})`);
    return one('SELECT * FROM profiles WHERE id = ?', [id]);
  });
}

const pendingProfiles = new Map();
async function profileFor(authUser) {
  const existing = await one('SELECT * FROM profiles WHERE auth_id = ?', [authUser.id]);
  if (existing) return existing;
  // Several requests arrive together on first sign-in; create the profile only once.
  if (!pendingProfiles.has(authUser.id)) {
    pendingProfiles.set(authUser.id, createInstitutionProfile(authUser).finally(() => pendingProfiles.delete(authUser.id)));
  }
  return pendingProfiles.get(authUser.id);
}

export async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.token;
    if (!token) return res.status(401).json({ error: 'Please sign in.' });
    const authUser = await authUserFor(String(token));
    if (!authUser) return res.status(401).json({ error: 'Your session has expired. Please sign in again.' });
    const profile = await profileFor(authUser);
    if (!profile)
      return res.status(403).json({ code: 'NO_PROFILE', error: 'This account is not linked to the portal yet. Ask the AICTE administrator to grant you access.' });
    if (profile.suspended)
      return res.status(403).json({ code: 'SUSPENDED', error: 'Your access to the portal has been suspended. Contact the AICTE administrator.' });
    req.user = await publicUser(profile);
    req.token = String(token);
    next();
  } catch (err) {
    next(err);
  }
}

export const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'Your role cannot perform this action.' });
