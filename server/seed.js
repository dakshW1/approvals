// Sample data for the prototype. All institutions, people and records are fictional.
// Only three accounts can sign in (one per role); other officers and principals exist as records only.
import { pathToFileURL } from 'node:url';
import { pool, query, one, insert, insertMany, tx, migrate, dropAll, nowIso } from './db.js';
import { supabaseAdmin, ensureBucket, emptyBucket, putFile } from './supabase.js';
import { DOC_TYPES, REQUIRED_DOCS, EXPIRING_DOC_TYPES, CATEGORIES, CATEGORY_CODES, ASSIGNMENT_RULES, SLA, STATUSES, addDays } from './rules.js';
import { runAlerts } from './alerts.js';
import { seedInspections } from './seedInspections.js';
import { backfillDocChecks, seedDemoThreads } from './seedDemoExtras.js';
import { backfillCampusLocations } from './db.js';

const DAY = 86400000;
const DEMO_PASSWORD = 'demo123';
const DEMO_LOGINS = [
  ['admin@aicte.demo', 'Director, Approval Bureau'],
  ['officer@aicte.demo', 'Rajiv Menon'],
  ['college@aicte.demo', 'Principal, Shri Venkatesh Institute of Technology'],
];

const INSTITUTIONS = [
  ['SVIT', 'Shri Venkatesh Institute of Technology', 'Engineering', 'Pune', 'Maharashtra', 'West', 2004],
  ['NVCE', 'Narmada Valley College of Engineering', 'Engineering', 'Jabalpur', 'Madhya Pradesh', 'Central', 1998],
  ['KSMS', 'Kaveri School of Management Studies', 'Management', 'Mysuru', 'Karnataka', 'South', 2009],
  ['BIPS', 'Brahmaputra Institute of Pharmaceutical Sciences', 'Pharmacy', 'Guwahati', 'Assam', 'East', 2011],
  ['APC', 'Aravalli Polytechnic College', 'Polytechnic', 'Jaipur', 'Rajasthan', 'North', 1995],
  ['CIE', 'Coromandel Institute of Engineering', 'Engineering', 'Chennai', 'Tamil Nadu', 'South', 2001],
  ['GDIT', 'Ganga Doab Institute of Technology', 'Engineering', 'Meerut', 'Uttar Pradesh', 'North', 2007],
  ['HRIM', 'Hooghly River Institute of Management', 'Management', 'Kolkata', 'West Bengal', 'East', 2012],
  ['SCP', 'Saurashtra College of Pharmacy', 'Pharmacy', 'Rajkot', 'Gujarat', 'West', 2006],
  ['DPEC', 'Deccan Plateau Engineering College', 'Engineering', 'Hyderabad', 'Telangana', 'South', 2003],
  ['MIER', 'Malwa Institute of Engineering & Research', 'Engineering', 'Indore', 'Madhya Pradesh', 'Central', 2008],
  ['KCP', 'Konkan Coast Polytechnic', 'Polytechnic', 'Ratnagiri', 'Maharashtra', 'West', 1999],
  ['MHIT', 'Mahanadi Institute of Technology', 'Engineering', 'Cuttack', 'Odisha', 'East', 2010],
  ['SSB', 'Shivalik School of Business', 'Management', 'Mohali', 'Punjab', 'North', 2013],
  ['VITP', 'Vindhya Institute of Technology (Proposed)', 'Engineering', 'Satna', 'Madhya Pradesh', 'Central', 2026],
];

const OFFICERS = [
  ['officer@aicte.demo', 'Rajiv Menon', 'Assistant Director', 'West', ['INCREASE_INTAKE', 'NEW_COURSE', 'EOA']],
  ['anita.rao@aicte.demo', 'Dr. Anita Rao', 'Deputy Director', 'South', ['NEW_INSTITUTION', 'INCREASE_INTAKE', 'NEW_COURSE', 'EOA']],
  ['priya.sharma@aicte.demo', 'Priya Sharma', 'Assistant Director', 'North', ['INCREASE_INTAKE', 'NEW_COURSE', 'EOA']],
  ['sameer.kulkarni@aicte.demo', 'Dr. Sameer Kulkarni', 'Deputy Director', 'West', ['NEW_INSTITUTION', 'NEW_COURSE', 'INCREASE_INTAKE']],
  ['neha.verma@aicte.demo', 'Neha Verma', 'Assistant Director', 'East', ['INCREASE_INTAKE', 'NEW_COURSE', 'EOA']],
  ['arjun.das@aicte.demo', 'Arjun Das', 'Deputy Director', 'North', ['NEW_INSTITUTION', 'EOA', 'INCREASE_INTAKE']],
];

// mode: how uploaded documents were reviewed. expiry: certificate valid-until, in days from today.
const APPS = [
  { inst: 'SVIT', category: 'INCREASE_INTAKE', program: 'B.Tech Computer Science & Engineering', duration: 4, intake: 180, faculty: 40, land: 12, built: 18500, status: 'UNDER_REVIEW', daysAgo: 19, officer: 'officer@aicte.demo', mode: 'partial' },
  { inst: 'SVIT', category: 'NEW_COURSE', program: 'B.Tech Artificial Intelligence & Data Science', duration: 4, intake: 60, faculty: 10, land: 12, built: 18500, status: 'ACTION_REQUIRED', daysAgo: 12, actionDaysAgo: 3, officer: 'officer@aicte.demo', mode: 'verified', missing: ['CURRICULUM'], rejected: { LAB_DETAILS: 'Equipment list is not signed by the Principal.' }, remark: 'Upload the curriculum, a signed lab equipment list, and add 2 faculty to meet the 1:20 ratio.' },
  { inst: 'SVIT', category: 'EOA', program: 'Extension of Approval (all programs)', ay: '2025-26', duration: 4, intake: 300, faculty: 72, land: 12, built: 18500, status: 'APPROVED', daysAgo: 210, decideAfter: 18, officer: 'officer@aicte.demo', mode: 'verified', expiry: { FIRE_NOC: 20 }, remark: 'All norms satisfied. Approval extended for AY 2025-26.' },
  { inst: 'SCP', category: 'EOA', program: 'Extension of Approval - B.Pharm', duration: 4, intake: 100, faculty: 30, land: 2, built: 3200, status: 'UNDER_REVIEW', daysAgo: 26, officer: 'officer@aicte.demo', mode: 'partial' },
  { inst: 'KCP', category: 'INCREASE_INTAKE', program: 'Diploma in Mechanical Engineering', duration: 3, intake: 120, faculty: 21, land: 4, built: 2600, status: 'SUBMITTED', daysAgo: 3, officer: 'officer@aicte.demo', mode: 'pending', missing: ['FIRE_NOC'] },
  { inst: 'VITP', category: 'NEW_INSTITUTION', program: 'B.Tech (CSE, ECE, ME) - New Institution', duration: 4, intake: 180, faculty: 38, land: 1.8, built: 4500, status: 'UNDER_REVIEW', daysAgo: 10, officer: 'sameer.kulkarni@aicte.demo', mode: 'partial' },
  { inst: 'KSMS', category: 'NEW_COURSE', program: 'MBA (Business Analytics)', duration: 2, intake: 60, faculty: 9, land: 3, built: 2200, status: 'APPROVED', daysAgo: 140, decideAfter: 15, officer: 'anita.rao@aicte.demo', mode: 'verified', remark: 'Approved for AY 2026-27.' },
  { inst: 'CIE', category: 'INCREASE_INTAKE', program: 'B.E. Electronics & Communication Engineering', duration: 4, intake: 120, faculty: 27, land: 10, built: 12000, status: 'UNDER_REVIEW', daysAgo: 23, officer: 'anita.rao@aicte.demo', mode: 'pending' },
  { inst: 'DPEC', category: 'EOA', program: 'Extension of Approval (all programs)', duration: 4, intake: 240, faculty: 51, land: 8, built: 9800, status: 'ACTION_REQUIRED', daysAgo: 20, actionDaysAgo: 9, officer: 'anita.rao@aicte.demo', mode: 'verified', rejected: { AUDIT_REPORT: 'Audited accounts for FY 2025-26 are not signed by a chartered accountant.' }, remark: 'Submit CA-signed audited accounts for FY 2025-26.' },
  { inst: 'BIPS', category: 'NEW_COURSE', program: 'M.Pharm (Pharmacology)', duration: 2, intake: 30, faculty: 6, land: 2.5, built: 2800, status: 'UNDER_REVIEW', daysAgo: 6, officer: 'neha.verma@aicte.demo', mode: 'partial' },
  { inst: 'HRIM', category: 'EOA', program: 'Extension of Approval - MBA', duration: 2, intake: 120, faculty: 8, land: 1.2, built: 1500, status: 'REJECTED', daysAgo: 60, decideAfter: 20, officer: 'neha.verma@aicte.demo', mode: 'verified', remark: 'Faculty strength (8) is below the required 12 for the sanctioned intake. Deficiency was not resolved in the response window.' },
  { inst: 'MHIT', category: 'INCREASE_INTAKE', program: 'B.Tech Civil Engineering', duration: 4, intake: 90, faculty: 22, land: 6, built: 7000, status: 'SUBMITTED', daysAgo: 1, officer: 'neha.verma@aicte.demo', mode: 'pending' },
  { inst: 'APC', category: 'EOA', program: 'Extension of Approval - Diploma programs', duration: 3, intake: 180, faculty: 30, land: 5, built: 4200, status: 'UNDER_REVIEW', daysAgo: 15, officer: 'priya.sharma@aicte.demo', mode: 'partial' },
  { inst: 'GDIT', category: 'NEW_COURSE', program: 'B.Tech Robotics & Automation', duration: 4, intake: 60, faculty: 14, land: 9, built: 9000, status: 'APPROVED', daysAgo: 120, decideAfter: 17, officer: 'priya.sharma@aicte.demo', mode: 'verified', remark: 'Approved for AY 2026-27.' },
  { inst: 'SSB', category: 'INCREASE_INTAKE', program: 'MBA', duration: 2, intake: 180, faculty: 19, land: 2, built: 2000, status: 'ACTION_REQUIRED', daysAgo: 10, actionDaysAgo: 5, officer: 'priya.sharma@aicte.demo', mode: 'verified', missing: ['FIRE_NOC'], remark: 'Fire safety NOC is missing. Upload a valid NOC from the State Fire Services.' },
  { inst: 'NVCE', category: 'EOA', program: 'Extension of Approval (all programs)', duration: 4, intake: 240, faculty: 50, land: 15, built: 11000, status: 'UNDER_REVIEW', daysAgo: 20, officer: 'arjun.das@aicte.demo', mode: 'partial' },
  { inst: 'MIER', category: 'EOA', program: 'Extension of Approval (all programs)', ay: '2025-26', duration: 4, intake: 180, faculty: 40, land: 7, built: 8000, status: 'APPROVED', daysAgo: 230, decideAfter: 19, officer: 'arjun.das@aicte.demo', mode: 'verified', remark: 'All norms satisfied. Approval extended for AY 2025-26.' },
  { inst: 'KSMS', category: 'EOA', program: 'Extension of Approval - MBA / PGDM', duration: 2, intake: 120, faculty: 15, land: 3, built: 2200, status: 'SUBMITTED', daysAgo: 0, officer: 'anita.rao@aicte.demo', mode: 'pending' },
  { inst: 'CIE', category: 'EOA', program: 'Extension of Approval (all programs)', ay: '2025-26', duration: 4, intake: 300, faculty: 64, land: 10, built: 12000, status: 'APPROVED', daysAgo: 250, decideAfter: 16, officer: 'anita.rao@aicte.demo', mode: 'verified', expiry: { FIRE_NOC: -10 }, remark: 'All norms satisfied. Approval extended for AY 2025-26.' },
  { inst: 'DPEC', category: 'NEW_COURSE', program: 'M.Tech VLSI Design', duration: 2, intake: 18, faculty: 3, land: 8, built: 9800, status: 'REJECTED', daysAgo: 90, decideAfter: 21, officer: 'anita.rao@aicte.demo', mode: 'verified', rejected: { LAB_DETAILS: 'VLSI lab lacks the licensed EDA tools required by the norms.' }, remark: 'Laboratory requirements for M.Tech VLSI Design are not met.' },
];

// A tiny valid one-page PDF so every seeded document opens in the browser.
function makePdf(lines) {
  const esc = (s) => s.replace(/[\\()]/g, (m) => `\\${m}`);
  let y = 780;
  const ops = lines.map((line, i) => {
    const op = `BT /F1 ${i === 0 ? 16 : 11} Tf 60 ${y} Td (${esc(line)}) Tj ET`;
    y -= i === 0 ? 34 : 20;
    return op;
  });
  const stream = ops.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = objects.map((o, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

// Create the demo login in Supabase Auth, or reset its password if it already exists.
async function ensureAuthUser(email, name) {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email, password: DEMO_PASSWORD, email_confirm: true, user_metadata: { name, demo: true },
  });
  if (!error) return data.user.id;
  for (let page = 1; page <= 20; page++) {
    const { data: list, error: listError } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
    if (listError) throw listError;
    const found = list.users.find((u) => u.email?.toLowerCase() === email);
    if (found) {
      await supabaseAdmin.auth.admin.updateUserById(found.id, { password: DEMO_PASSWORD, email_confirm: true });
      return found.id;
    }
    if (list.users.length < 200) break;
  }
  throw error;
}

export async function seed() {
  await ensureBucket();
  const authIds = {};
  for (const [email, name] of DEMO_LOGINS) authIds[email] = await ensureAuthUser(email, name);

  // Offset by two hours so whole-day countdowns read cleanly in the demo.
  const base = Date.now() + 2 * 3600 * 1000;
  const ago = (d) => new Date(base - d * DAY).toISOString();
  const fromNow = (d) => new Date(base + d * DAY).toISOString();
  const files = [];

  await tx(async () => {
    const instIds = {};
    for (const [i, [code, name, type, city, state, region, est]] of INSTITUTIONS.entries()) {
      instIds[code] = await insert(
        'INSERT INTO institutions (aicte_code, name, type, city, state, region, established) VALUES (?,?,?,?,?,?,?)',
        [`1-${4102000 + i * 7919}`, name, type, city, state, region, est]
      );
    }
    const addProfile = (authId, name, email, role, instId, designation, region, categories, maxLoad) =>
      insert(
        'INSERT INTO profiles (auth_id, name, email, role, institution_id, designation, region, categories, max_load, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [authId ?? null, name, email, role, instId, designation, region, categories, maxLoad, nowIso()]
      );
    await addProfile(authIds['admin@aicte.demo'], 'Director, Approval Bureau', 'admin@aicte.demo', 'ADMIN', null, 'Director', null, null, 0);
    const officers = {};
    for (const [email, name, designation, region, cats] of OFFICERS) {
      const id = await addProfile(authIds[email], name, email, 'OFFICER', null, designation, region, cats.join(','), 8);
      officers[email] = { id, name, designation, region };
    }
    const colleges = {};
    for (const [code, name, , , , region] of INSTITUTIONS) {
      const email = code === 'SVIT' ? 'college@aicte.demo' : `${code.toLowerCase()}@college.demo`;
      colleges[code] = await addProfile(authIds[email], `Principal, ${name}`, email, 'COLLEGE', instIds[code], 'Principal', region, null, 0);
    }

    const audits = [];
    const histories = [];
    const docRows = [];
    const docAudits = [];
    const auditRow = (userId, action, entity, entityId, details, appId, at) => [userId ?? null, action, entity, entityId ?? null, appId, details, at];

    // Insert oldest first so ids follow submission order.
    const ordered = [...APPS].sort((a, b) => b.daysAgo - a.daysAgo);
    for (const [idx, s] of ordered.entries()) {
      const inst = INSTITUTIONS.find((x) => x[0] === s.inst);
      const instRegion = inst[5];
      const officer = officers[s.officer];
      const collegeId = colleges[s.inst];
      const ay = s.ay || '2026-27';
      const appNo = `AICTE-${ay}-${CATEGORY_CODES[s.category]}-${String(idx + 1).padStart(5, '0')}`;
      const t0 = ago(s.daysAgo);
      let due = addDays(t0, SLA.reviewDays);
      let decided = null;
      const history = [[null, 'SUBMITTED', t0, collegeId, 'Application submitted online']];
      if (s.status !== 'SUBMITTED') history.push(['SUBMITTED', 'UNDER_REVIEW', addDays(t0, 1), officer.id, 'Scrutiny started']);
      if (s.status === 'ACTION_REQUIRED') {
        const ta = ago(s.actionDaysAgo);
        history.push(['UNDER_REVIEW', 'ACTION_REQUIRED', ta, officer.id, s.remark]);
        due = addDays(ta, SLA.responseDays);
      }
      if (s.status === 'APPROVED' || s.status === 'REJECTED') {
        decided = addDays(t0, s.decideAfter);
        history.push(['UNDER_REVIEW', s.status, decided, officer.id, s.remark]);
      }
      const appId = await insert(
        `INSERT INTO applications (app_no, institution_id, category, program, academic_year, duration_years, proposed_intake,
          faculty_count, land_area, built_up_area, status, assigned_officer_id, submitted_at, due_date, decided_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [appNo, instIds[s.inst], s.category, s.program, ay, s.duration, s.intake, s.faculty, s.land, s.built,
          s.status, officer.id, t0, due, decided, history[history.length - 1][2]]
      );

      audits.push(auditRow(collegeId, 'APPLICATION_SUBMITTED', 'application', appId, `${appNo}: ${CATEGORIES[s.category]}, ${s.program}`, appId, t0));
      const roles = ASSIGNMENT_RULES[s.category].join(' / ');
      const regionPart = officer.region === instRegion ? `same region (${instRegion})` : `no eligible officer in ${instRegion}, nearest available`;
      audits.push(auditRow(null, 'OFFICER_ASSIGNED', 'application', appId,
        `${officer.name} (${officer.designation}, ${officer.region}). Rule: ${CATEGORIES[s.category]} -> ${roles}; ${regionPart}; lowest workload`, appId, t0));

      const required = REQUIRED_DOCS[s.category].filter((t) => !(s.missing || []).includes(t));
      const reviewedAt = addDays(t0, 2);
      required.forEach((type, i) => {
        let status = 'PENDING';
        if (s.status !== 'SUBMITTED') {
          if (s.mode === 'verified') status = 'VERIFIED';
          if (s.mode === 'partial') status = i < Math.floor(required.length / 2) ? 'VERIFIED' : 'PENDING';
        }
        const remark = s.rejected?.[type] || null;
        if (remark) status = 'REJECTED';
        const expiry = EXPIRING_DOC_TYPES.includes(type)
          ? s.expiry?.[type] !== undefined ? fromNow(s.expiry[type]) : addDays(t0, 400)
          : null;
        const key = `seed/${appId}-${type.toLowerCase()}.pdf`;
        const pdf = makePdf([
          DOC_TYPES[type], inst[1], `${inst[3]}, ${inst[4]}`, `Application: ${appNo}`,
          expiry ? `Valid until: ${expiry.slice(0, 10)}` : 'Issued for AICTE approval process',
          '', 'Sample document generated for the SIH prototype demonstration.',
        ]);
        files.push([key, pdf]);
        const reviewed = status !== 'PENDING';
        const original = `${type.toLowerCase()}_${s.inst.toLowerCase()}.pdf`;
        docRows.push([appId, type, original, key, pdf.length, t0, expiry, status, remark, reviewed ? officer.id : null, reviewed ? reviewedAt : null]);
        docAudits.push({ appId, type, collegeId, officerId: officer.id, status, remark, original, t0, reviewedAt, reviewed });
      });

      for (const [from, to, at, userId, remark] of history) {
        histories.push([appId, from, to, userId, remark, at]);
        if (from) audits.push(auditRow(userId, 'STATUS_CHANGED', 'application', appId, `${STATUSES[from]} -> ${STATUSES[to]}${remark ? `: ${remark}` : ''}`, appId, at));
      }
    }

    await insertMany('documents',
      ['application_id', 'doc_type', 'original_name', 'stored_name', 'size', 'uploaded_at', 'expiry_date', 'status', 'remark', 'reviewed_by', 'reviewed_at'],
      docRows);
    const docIds = {};
    for (const d of await query('SELECT id, application_id, doc_type FROM documents')) docIds[`${d.application_id}:${d.doc_type}`] = d.id;
    for (const d of docAudits) {
      const id = docIds[`${d.appId}:${d.type}`];
      audits.push(auditRow(d.collegeId, 'DOCUMENT_UPLOADED', 'document', id, `${DOC_TYPES[d.type]}: ${d.original}`, d.appId, d.t0));
      if (d.reviewed)
        audits.push(auditRow(d.officerId, d.status === 'VERIFIED' ? 'DOCUMENT_VERIFIED' : 'DOCUMENT_REJECTED', 'document', id,
          `${DOC_TYPES[d.type]}${d.remark ? `: ${d.remark}` : ''}`, d.appId, d.reviewedAt));
    }
    await insertMany('status_history', ['application_id', 'from_status', 'to_status', 'user_id', 'remark', 'created_at'], histories);
    await insertMany('audit_log', ['user_id', 'action', 'entity', 'entity_id', 'application_id', 'details', 'created_at'], audits);
  });

  for (let i = 0; i < files.length; i += 10)
    await Promise.all(files.slice(i, i + 10).map(([key, pdf]) => putFile(key, pdf, 'application/pdf')));
  await backfillCampusLocations();
  await seedInspections();
  await backfillDocChecks();
  await seedDemoThreads();
  await runAlerts();
}

export async function seedIfEmpty() {
  const { n } = await one('SELECT COUNT(*)::int AS n FROM profiles');
  if (n === 0) {
    console.log('Empty database: loading sample data into Supabase…');
    await seed();
    console.log(`Sample data loaded. Demo accounts (password "${DEMO_PASSWORD}"): ${DEMO_LOGINS.map((d) => d[0]).join(', ')}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log('Resetting the Supabase database with fresh sample data…');
  await dropAll();
  await emptyBucket();
  await migrate();
  await seed();
  console.log(`Done. Demo accounts (password "${DEMO_PASSWORD}"): ${DEMO_LOGINS.map((d) => d[0]).join(', ')}`);
  await pool.end();
}
