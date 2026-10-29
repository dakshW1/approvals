// Predefined workflow, assignment and compliance rules.
// Values are sample norms for the prototype; a real deployment would load them
// from the current AICTE Approval Process Handbook.

export const STATUSES = {
  SUBMITTED: 'Submitted',
  UNDER_REVIEW: 'Under Review',
  ACTION_REQUIRED: 'Action Required',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};
export const OPEN_STATUSES = ['SUBMITTED', 'UNDER_REVIEW', 'ACTION_REQUIRED'];

export const CATEGORIES = {
  NEW_INSTITUTION: 'New Institution',
  INCREASE_INTAKE: 'Increase in Intake',
  NEW_COURSE: 'New Course / Program',
  EOA: 'Extension of Approval',
};
export const CATEGORY_CODES = { NEW_INSTITUTION: 'NI', INCREASE_INTAKE: 'II', NEW_COURSE: 'NC', EOA: 'EOA' };

export const DOC_TYPES = {
  LAND_DOC: 'Land ownership / lease documents',
  BUILDING_PLAN: 'Approved building plan',
  BUILDING_SAFETY: 'Building stability certificate',
  FIRE_NOC: 'Fire safety NOC',
  STATE_NOC: 'State Government NOC',
  UNIV_AFFILIATION: 'University / Board affiliation consent',
  AFFIDAVIT: 'Notarised affidavit',
  FINANCIAL_STMT: 'Financial statement (corpus proof)',
  FACULTY_LIST: 'Faculty list with qualifications',
  LAB_DETAILS: 'Laboratory & equipment details',
  CURRICULUM: 'Curriculum & syllabus',
  AUDIT_REPORT: 'Audited accounts (last FY)',
};
// Certificates that carry an expiry date and are monitored after approval.
export const EXPIRING_DOC_TYPES = ['FIRE_NOC', 'BUILDING_SAFETY', 'STATE_NOC'];

export const REQUIRED_DOCS = {
  NEW_INSTITUTION: ['LAND_DOC', 'BUILDING_PLAN', 'FIRE_NOC', 'STATE_NOC', 'UNIV_AFFILIATION', 'AFFIDAVIT', 'FINANCIAL_STMT'],
  INCREASE_INTAKE: ['FACULTY_LIST', 'AFFIDAVIT', 'FIRE_NOC', 'UNIV_AFFILIATION', 'LAB_DETAILS'],
  NEW_COURSE: ['FACULTY_LIST', 'LAB_DETAILS', 'CURRICULUM', 'AFFIDAVIT', 'UNIV_AFFILIATION'],
  EOA: ['AFFIDAVIT', 'FIRE_NOC', 'FACULTY_LIST', 'AUDIT_REPORT', 'BUILDING_SAFETY'],
};

// Which officer designations may handle each category.
export const ASSIGNMENT_RULES = {
  NEW_INSTITUTION: ['Deputy Director'],
  INCREASE_INTAKE: ['Assistant Director', 'Deputy Director'],
  NEW_COURSE: ['Assistant Director', 'Deputy Director'],
  EOA: ['Assistant Director', 'Deputy Director'],
};

// fsr = max students per faculty, minLand in acres, built-up in sq.m per student.
export const NORMS = {
  Engineering: { fsr: 20, minLand: 2.5, sqmPerStudent: 6 },
  Management: { fsr: 20, minLand: 1.0, sqmPerStudent: 4 },
  Pharmacy: { fsr: 15, minLand: 1.5, sqmPerStudent: 6 },
  Polytechnic: { fsr: 20, minLand: 2.0, sqmPerStudent: 5 },
};

export const SLA = {
  reviewDays: 21, // officer must decide within this many days of submission
  responseDays: 7, // institution must respond to "Action Required" within this
  reReviewDays: 10, // officer review window after a resubmission
  warnDays: 3, // "deadline approaching" threshold
  pickupDays: 2, // submitted but review not started
  expiryWarnDays: 30, // certificate expiring soon
};

export const DESIGNATIONS = ['Assistant Director', 'Deputy Director'];

// The objects above are the defaults. Admins can override them (stored in the settings table);
// applyRules() updates them in place so every importer sees the new values immediately.
const clone = (o) => JSON.parse(JSON.stringify(o));
export const currentRules = () => clone({ norms: NORMS, sla: SLA, requiredDocs: REQUIRED_DOCS, assignmentRules: ASSIGNMENT_RULES });
export const DEFAULT_RULES = currentRules();

const replace = (target, source) => {
  for (const k of Object.keys(target)) delete target[k];
  Object.assign(target, clone(source));
};
export function applyRules(r) {
  replace(NORMS, r.norms);
  replace(SLA, r.sla);
  replace(REQUIRED_DOCS, r.requiredDocs);
  replace(ASSIGNMENT_RULES, r.assignmentRules);
}

const SLA_LIMITS = { reviewDays: [1, 180], responseDays: [1, 90], reReviewDays: [1, 90], warnDays: [0, 30], pickupDays: [0, 30], expiryWarnDays: [1, 365] };
export function validateRules(input) {
  const errors = [];
  const num = (v, min, max, label) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max) errors.push(`${label} must be between ${min} and ${max}.`);
    return n;
  };
  const out = { norms: {}, sla: {}, requiredDocs: {}, assignmentRules: {} };
  for (const type of Object.keys(DEFAULT_RULES.norms)) {
    const n = input?.norms?.[type] || {};
    out.norms[type] = {
      fsr: Math.round(num(n.fsr, 1, 100, `${type} faculty ratio`)),
      minLand: num(n.minLand, 0, 500, `${type} minimum land`),
      sqmPerStudent: num(n.sqmPerStudent, 0, 100, `${type} built-up area per student`),
    };
  }
  for (const [k, [min, max]] of Object.entries(SLA_LIMITS)) out.sla[k] = Math.round(num(input?.sla?.[k], min, max, k));
  for (const cat of Object.keys(CATEGORIES)) {
    const docs = [...new Set(input?.requiredDocs?.[cat] || [])].filter((d) => DOC_TYPES[d]);
    if (!docs.length) errors.push(`${CATEGORIES[cat]} needs at least one required document.`);
    out.requiredDocs[cat] = docs;
    const roles = [...new Set(input?.assignmentRules?.[cat] || [])].filter((d) => DESIGNATIONS.includes(d));
    if (!roles.length) errors.push(`${CATEGORIES[cat]} needs at least one officer role.`);
    out.assignmentRules[cat] = roles;
  }
  return { rules: out, errors };
}

const DAY = 86400000;
export const addDays = (date, n) => new Date(new Date(date).getTime() + n * DAY).toISOString();
export const daysUntil = (date, now = new Date()) => Math.floor((new Date(date).getTime() - now.getTime()) / DAY);

const num = (n) => Number(n || 0).toLocaleString('en-IN');

export function evaluateCompliance(app, docs, institutionType, now = new Date()) {
  const required = REQUIRED_DOCS[app.category] || [];
  const byType = {};
  for (const d of docs) byType[d.doc_type] = d;
  const missing = required.filter((t) => !byType[t]);
  const uploaded = required.filter((t) => byType[t]);
  const rejected = uploaded.filter((t) => byType[t].status === 'REJECTED');
  const verified = uploaded.filter((t) => byType[t].status === 'VERIFIED');
  const norm = NORMS[institutionType] || NORMS.Engineering;
  const label = (t) => DOC_TYPES[t] || t;
  const checks = [];

  checks.push({
    key: 'docs_uploaded',
    label: 'Required documents uploaded',
    status: missing.length ? 'fail' : 'pass',
    detail: missing.length
      ? `${missing.length} missing: ${missing.map(label).join(', ')}`
      : `All ${required.length} documents uploaded`,
  });

  checks.push({
    key: 'docs_verified',
    label: 'Documents verified by officer',
    status: rejected.length ? 'fail' : verified.length === required.length ? 'pass' : 'warn',
    detail: rejected.length
      ? `${rejected.length} rejected: ${rejected.map(label).join(', ')}`
      : `${verified.length} of ${required.length} verified`,
  });

  const students = (app.proposed_intake || 0) * (app.duration_years || 4);
  const facultyNeeded = Math.ceil(students / norm.fsr);
  checks.push({
    key: 'faculty',
    label: `Faculty-student ratio (1:${norm.fsr})`,
    status: (app.faculty_count || 0) >= facultyNeeded ? 'pass' : 'fail',
    detail: `${app.faculty_count || 0} faculty for ${num(students)} students (needs ${facultyNeeded})`,
  });

  checks.push({
    key: 'land',
    label: `Land area (min ${norm.minLand} acres)`,
    status: (app.land_area || 0) >= norm.minLand ? 'pass' : 'fail',
    detail: `${app.land_area || 0} acres declared`,
  });

  const builtNeeded = students * norm.sqmPerStudent;
  checks.push({
    key: 'built_up',
    label: `Built-up area (${norm.sqmPerStudent} sq.m per student)`,
    status: (app.built_up_area || 0) >= builtNeeded ? 'pass' : 'fail',
    detail: `${num(app.built_up_area)} sq.m declared, ${num(builtNeeded)} sq.m needed`,
  });

  const dated = docs.filter((d) => d.expiry_date);
  const expired = dated.filter((d) => daysUntil(d.expiry_date, now) < 0);
  const expiring = dated.filter((d) => {
    const left = daysUntil(d.expiry_date, now);
    return left >= 0 && left <= SLA.expiryWarnDays;
  });
  checks.push({
    key: 'validity',
    label: 'Certificates within validity',
    status: expired.length ? 'fail' : expiring.length ? 'warn' : 'pass',
    detail: expired.length
      ? `Expired: ${expired.map((d) => label(d.doc_type)).join(', ')}`
      : expiring.length
        ? `Expiring within ${SLA.expiryWarnDays} days: ${expiring.map((d) => label(d.doc_type)).join(', ')}`
        : dated.length
          ? 'All dated certificates are valid'
          : 'No dated certificates on file yet',
  });

  if (OPEN_STATUSES.includes(app.status) && app.due_date) {
    const left = daysUntil(app.due_date, now);
    checks.push({
      key: 'timeline',
      label: 'Within processing deadline',
      status: left < 0 ? 'fail' : left <= SLA.warnDays ? 'warn' : 'pass',
      detail: left < 0 ? `Overdue by ${-left} day(s)` : left === 0 ? 'Due today' : `${left} day(s) left`,
    });
  }

  const passed = checks.filter((c) => c.status === 'pass').length;
  const warned = checks.filter((c) => c.status === 'warn').length;
  const failed = checks.filter((c) => c.status === 'fail').length;
  const score = Math.round(((passed + warned * 0.5) / checks.length) * 100);
  return { score, passed, warned, failed, checks, missing, rejected, facultyNeeded, builtNeeded, students };
}
