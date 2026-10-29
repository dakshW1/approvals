import { one, query, nowIso } from './db.js';
import { applyRules, currentRules, validateRules, DEFAULT_RULES, CATEGORIES, DOC_TYPES } from './rules.js';
import { audit } from './alerts.js';

let loadedAt = 0;
let version = null;

// Each server instance re-reads the rules at most every 30 s, so an edit made on one Vercel
// instance reaches the others quickly without a query on every request.
export async function ensureFreshRules(force = false) {
  if (!force && Date.now() - loadedAt < 30_000) return;
  loadedAt = Date.now();
  const row = await one("SELECT value, updated_at FROM settings WHERE key = 'rules'");
  if (!row) {
    if (version !== null) applyRules(DEFAULT_RULES);
    version = null;
    return;
  }
  if (row.updated_at === version) return;
  const { rules } = validateRules(row.value);
  applyRules(rules);
  version = row.updated_at;
}

function describeChanges(before, after) {
  const changes = [];
  for (const [type, n] of Object.entries(after.norms))
    for (const k of Object.keys(n)) if (before.norms[type]?.[k] !== n[k]) changes.push(`${type} ${k} ${before.norms[type]?.[k]} -> ${n[k]}`);
  for (const [k, v] of Object.entries(after.sla)) if (before.sla[k] !== v) changes.push(`${k} ${before.sla[k]} -> ${v}`);
  for (const cat of Object.keys(after.requiredDocs)) {
    const added = after.requiredDocs[cat].filter((d) => !before.requiredDocs[cat]?.includes(d));
    const removed = (before.requiredDocs[cat] || []).filter((d) => !after.requiredDocs[cat].includes(d));
    if (added.length) changes.push(`${CATEGORIES[cat]} +${added.map((d) => DOC_TYPES[d]).join(', +')}`);
    if (removed.length) changes.push(`${CATEGORIES[cat]} -${removed.map((d) => DOC_TYPES[d]).join(', -')}`);
    if (after.assignmentRules[cat].join() !== (before.assignmentRules[cat] || []).join())
      changes.push(`${CATEGORIES[cat]} roles: ${after.assignmentRules[cat].join(' / ')}`);
  }
  return changes;
}

export async function saveRules(input, actorId) {
  const { rules, errors } = validateRules(input);
  if (errors.length) {
    const err = new Error(errors.join(' '));
    err.status = 400;
    throw err;
  }
  const before = currentRules();
  const changes = describeChanges(before, rules);
  const at = nowIso();
  await query(
    `INSERT INTO settings (key, value, updated_at, updated_by) VALUES ('rules', ?::jsonb, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
    [JSON.stringify(rules), at, actorId]
  );
  applyRules(rules);
  version = at;
  loadedAt = Date.now();
  await audit(actorId, 'RULES_UPDATED', 'settings', null, changes.length ? changes.join('; ') : 'Saved with no changes');
  return rules;
}

export async function resetRules(actorId) {
  await query("DELETE FROM settings WHERE key = 'rules'");
  applyRules(DEFAULT_RULES);
  version = null;
  loadedAt = Date.now();
  await audit(actorId, 'RULES_RESET', 'settings', null, 'Rules reset to the built-in defaults');
  return currentRules();
}

export async function rulesInfo() {
  const row = await one(
    "SELECT s.updated_at, p.name AS updated_by FROM settings s LEFT JOIN profiles p ON p.id = s.updated_by WHERE key = 'rules'"
  );
  return { rules: currentRules(), defaults: DEFAULT_RULES, updated_at: row?.updated_at || null, updated_by: row?.updated_by || null };
}
