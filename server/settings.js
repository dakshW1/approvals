import { one, query, nowIso } from './db.js';
import {
  applyGlobal, currentGlobal, validateGlobal, validateYear, setYearVersions, yearVersionList, rulesForYear,
  DEFAULT_GLOBAL, DEFAULT_YEAR, CATEGORIES, DOC_TYPES,
} from './rules.js';
import { audit } from './alerts.js';

const AY = /^\d{4}-\d{2}$/;
let loadedAt = 0;
let version = null;

// Each server instance re-reads the rules at most every 30 s, so an edit made on one Vercel
// instance reaches the others quickly without a query on every request.
export async function ensureFreshRules(force = false) {
  if (!force && Date.now() - loadedAt < 30_000) return;
  loadedAt = Date.now();
  const [globalRow, years] = await Promise.all([
    one("SELECT value, updated_at FROM settings WHERE key = 'rules'"),
    query('SELECT academic_year, norms, required_docs, updated_at FROM rule_versions'),
  ]);
  const stamp = [globalRow?.updated_at || '-', ...years.map((y) => `${y.academic_year}@${y.updated_at}`).sort()].join('|');
  if (stamp === version) return;
  applyGlobal(globalRow ? validateGlobal(globalRow.value).rules : DEFAULT_GLOBAL);
  setYearVersions(years.map((y) => ({ academic_year: y.academic_year, ...validateYear({ norms: y.norms, requiredDocs: y.required_docs }).rules })));
  version = stamp;
}

const fail = (errors) => {
  const err = new Error(errors.join(' '));
  err.status = 400;
  throw err;
};

function describeGlobal(before, after) {
  const changes = [];
  for (const [k, v] of Object.entries(after.sla)) if (before.sla[k] !== v) changes.push(`${k} ${before.sla[k]} -> ${v}`);
  for (const cat of Object.keys(after.assignmentRules))
    if (after.assignmentRules[cat].join() !== (before.assignmentRules[cat] || []).join())
      changes.push(`${CATEGORIES[cat]} roles: ${after.assignmentRules[cat].join(' / ')}`);
  return changes;
}

function describeYear(before, after) {
  const changes = [];
  for (const [type, n] of Object.entries(after.norms))
    for (const k of Object.keys(n)) if (before.norms[type]?.[k] !== n[k]) changes.push(`${type} ${k} ${before.norms[type]?.[k]} -> ${n[k]}`);
  for (const cat of Object.keys(after.requiredDocs)) {
    const added = after.requiredDocs[cat].filter((d) => !before.requiredDocs[cat]?.includes(d));
    const removed = (before.requiredDocs[cat] || []).filter((d) => !after.requiredDocs[cat].includes(d));
    if (added.length) changes.push(`${CATEGORIES[cat]} +${added.map((d) => DOC_TYPES[d]).join(', +')}`);
    if (removed.length) changes.push(`${CATEGORIES[cat]} -${removed.map((d) => DOC_TYPES[d]).join(', -')}`);
  }
  return changes;
}

export async function saveGlobal(input, actorId) {
  const { rules, errors } = validateGlobal(input);
  if (errors.length) fail(errors);
  const changes = describeGlobal(currentGlobal(), rules);
  await query(
    `INSERT INTO settings (key, value, updated_at, updated_by) VALUES ('rules', ?::jsonb, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
    [JSON.stringify(rules), nowIso(), actorId]
  );
  await ensureFreshRules(true);
  await audit(actorId, 'RULES_UPDATED', 'settings', null, `Deadlines and roles: ${changes.length ? changes.join('; ') : 'no changes'}`);
}

export async function resetGlobal(actorId) {
  await query("DELETE FROM settings WHERE key = 'rules'");
  await ensureFreshRules(true);
  await audit(actorId, 'RULES_RESET', 'settings', null, 'Deadlines and assignment roles reset to the built-in defaults');
}

export async function saveYear(academicYear, input, actorId) {
  if (!AY.test(academicYear)) fail(['Academic year must look like 2026-27.']);
  const { rules, errors } = validateYear(input);
  if (errors.length) fail(errors);
  const before = rulesForYear(academicYear);
  const changes = describeYear(before, rules);
  await query(
    `INSERT INTO rule_versions (academic_year, norms, required_docs, updated_at, updated_by) VALUES (?, ?::jsonb, ?::jsonb, ?, ?)
     ON CONFLICT (academic_year) DO UPDATE SET norms = EXCLUDED.norms, required_docs = EXCLUDED.required_docs,
       updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
    [academicYear, JSON.stringify(rules.norms), JSON.stringify(rules.requiredDocs), nowIso(), actorId]
  );
  await ensureFreshRules(true);
  const from = before.source === academicYear ? '' : ` (previously inherited from ${before.source === 'default' ? 'defaults' : `AY ${before.source}`})`;
  await audit(actorId, 'RULES_UPDATED', 'settings', null, `AY ${academicYear} norms${from}: ${changes.length ? changes.join('; ') : 'no changes'}`);
}

export async function deleteYear(academicYear, actorId) {
  await query('DELETE FROM rule_versions WHERE academic_year = ?', [academicYear]);
  await ensureFreshRules(true);
  const now = rulesForYear(academicYear).source;
  await audit(actorId, 'RULES_RESET', 'settings', null, `AY ${academicYear} rules removed; now inherits from ${now === 'default' ? 'defaults' : `AY ${now}`}`);
}

function nextYears() {
  const d = new Date();
  const start = d.getMonth() >= 6 ? d.getFullYear() : d.getFullYear() - 1;
  return [0, 1, 2].map((i) => `${start + i}-${String((start + i + 1) % 100).padStart(2, '0')}`);
}

export async function rulesInfo() {
  const [globalRow, years, used] = await Promise.all([
    one("SELECT s.updated_at, p.name AS updated_by FROM settings s LEFT JOIN profiles p ON p.id = s.updated_by WHERE key = 'rules'"),
    query('SELECT v.academic_year, v.updated_at, p.name AS updated_by FROM rule_versions v LEFT JOIN profiles p ON p.id = v.updated_by'),
    query('SELECT academic_year, COUNT(*)::int AS n FROM applications GROUP BY academic_year'),
  ]);
  const meta = Object.fromEntries(years.map((y) => [y.academic_year, y]));
  const counts = Object.fromEntries(used.map((u) => [u.academic_year, u.n]));
  const all = [...new Set([...used.map((u) => u.academic_year), ...years.map((y) => y.academic_year), ...nextYears()])].sort();
  return {
    global: currentGlobal(),
    globalDefaults: DEFAULT_GLOBAL,
    globalUpdated: globalRow ? { at: globalRow.updated_at, by: globalRow.updated_by } : null,
    yearDefaults: DEFAULT_YEAR,
    years: all.map((ay) => {
      const r = rulesForYear(ay);
      return {
        academic_year: ay,
        norms: r.norms,
        requiredDocs: r.requiredDocs,
        source: r.source,
        own: r.source === ay,
        applications: counts[ay] || 0,
        updated_at: meta[ay]?.updated_at || null,
        updated_by: meta[ay]?.updated_by || null,
      };
    }),
  };
}

// Sent to every signed-in user so forms can show the norms that apply to the year they pick.
export const yearRulesForClient = () => ({ defaults: DEFAULT_YEAR, versions: yearVersionList() });
