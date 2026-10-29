// Same lookup as the server: the rules for an academic year are that year's own version,
// or the closest earlier year that has one, or the built-in defaults.
export function rulesFor(meta, academicYear) {
  const { defaults, versions } = meta.YEAR_RULES;
  let found = null;
  if (/^\d{4}-\d{2}$/.test(academicYear || '')) for (const v of versions) if (v.academic_year <= academicYear) found = v;
  return found ? { ...found, source: found.academic_year } : { ...defaults, source: 'default' };
}
