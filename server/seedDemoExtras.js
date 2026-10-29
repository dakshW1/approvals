// Extra demo content: automated checks for already-uploaded documents, and sample conversations
// between principals and AICTE officers. All people and messages are fictional sample data.
import { pathToFileURL } from 'node:url';
import { pool, query, one } from './db.js';
import { supabaseAdmin, BUCKET } from './supabase.js';
import { checkDocument } from './docCheck.js';

const HOUR = 3600000;
const ago = (hours) => new Date(Date.now() - hours * HOUR).toISOString();

export async function backfillDocChecks() {
  const docs = await query(
    `SELECT d.id, d.doc_type, d.stored_name, d.original_name, d.expiry_date, i.name AS institution
     FROM documents d JOIN applications a ON a.id = d.application_id JOIN institutions i ON i.id = a.institution_id
     WHERE d.auto_check IS NULL`
  );
  let done = 0;
  for (let i = 0; i < docs.length; i += 8) {
    await Promise.all(
      docs.slice(i, i + 8).map(async (d) => {
        const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(d.stored_name);
        if (error) return;
        const check = await checkDocument({
          buffer: Buffer.from(await data.arrayBuffer()),
          mimetype: /\.pdf$/i.test(d.stored_name) ? 'application/pdf' : 'application/octet-stream',
          filename: d.original_name,
          docType: d.doc_type,
          institution: d.institution,
          declaredExpiry: d.expiry_date,
        }).catch(() => null);
        if (check) {
          await query('UPDATE documents SET auto_check = ?::jsonb WHERE id = ?', [JSON.stringify(check), d.id]);
          done++;
        }
      })
    );
  }
  return done;
}

// [who, hoursAgo, text]; who is 'principal', 'officer' or 'admin'.
const THREADS = [
  {
    match: "i.name LIKE 'Shri Venkatesh%' AND a.category = 'NEW_COURSE'",
    messages: [
      ['principal', 60, 'We are appointing two more faculty for the AI & Data Science program. Can we upload their appointment letters now, or should we wait until they join?'],
      ['officer', 52, 'Upload the signed appointment letters with an updated faculty list now. Joining reports can follow before the session starts.'],
      ['principal', 30, 'Thank you. The lab equipment list is being re-signed by the Principal and will be uploaded by Friday, along with the curriculum approved by our university.'],
    ],
  },
  {
    match: "i.name LIKE 'Shri Venkatesh%' AND a.category = 'INCREASE_INTAKE'",
    messages: [
      ['officer', 40, 'The expert committee visit is confirmed for this Saturday at 10:00. Please keep the lab stock registers and faculty attendance records ready for inspection.'],
      ['principal', 34, 'Confirmed. Our Dean of Academics will receive the committee at the main gate and accompany them through the labs and library.'],
    ],
  },
  {
    match: "i.name LIKE 'Deccan Plateau%' AND a.category = 'EOA'",
    messages: [
      ['principal', 150, 'Our statutory auditor is on leave until next week. Could we have a few more days to submit the CA-signed accounts for FY 2025-26?'],
      ['officer', 140, "I can't move the deadline myself, but your request is on record. Please upload the signed accounts as soon as they are ready; the review will continue from there."],
      ['admin', 26, 'This application is now past its response window. Please upload the CA-signed accounts within two working days, or it may be rejected.'],
      ['principal', 20, 'Understood. The auditor has agreed to sign on Monday and we will upload the same day.'],
    ],
  },
  {
    match: "i.name LIKE 'Vindhya%'",
    messages: [
      ['principal', 44, 'Registration of the adjacent 0.9 acre plot is complete. The registered deed has been uploaded under land documents.'],
      ['officer', 38, 'Received, thank you. I will place the registered deed before the committee along with the land shortfall noted during the site visit.'],
    ],
  },
  {
    match: "i.name LIKE 'Saurashtra%'",
    messages: [
      ['principal', 70, 'Is anything pending from our side? The status has shown Under Review for over three weeks.'],
      ['officer', 64, 'Nothing is pending from you. I am completing the document verification and will update the status shortly. Apologies for the delay.'],
    ],
  },
  {
    match: "i.name LIKE 'Shivalik%'",
    messages: [
      ['principal', 90, 'Our fire NOC renewal is with the State Fire Services. Can we upload the receipt of the renewal application in the meantime?'],
      ['officer', 84, 'Please upload the receipt for now, but approval needs the issued NOC itself. Upload it as soon as you receive it.'],
    ],
  },
];

export async function seedDemoThreads() {
  const { n } = await one('SELECT COUNT(*)::int AS n FROM comments');
  if (n > 0) return 0;
  const admin = await one("SELECT id FROM profiles WHERE role = 'ADMIN' ORDER BY id LIMIT 1");
  let added = 0;
  for (const t of THREADS) {
    const app = await one(
      `SELECT a.id, a.assigned_officer_id, (SELECT p.id FROM profiles p WHERE p.role = 'COLLEGE' AND p.institution_id = a.institution_id ORDER BY p.id LIMIT 1) AS principal_id
       FROM applications a JOIN institutions i ON i.id = a.institution_id WHERE ${t.match} AND a.status <> 'DRAFT' ORDER BY a.id LIMIT 1`
    );
    if (!app) continue;
    for (const [who, hours, text] of t.messages) {
      const userId = who === 'principal' ? app.principal_id : who === 'admin' ? admin?.id : app.assigned_officer_id;
      if (!userId) continue;
      await query('INSERT INTO comments (application_id, user_id, body, created_at) VALUES (?,?,?,?)', [app.id, userId, text, ago(hours)]);
      added++;
    }
  }
  return added;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { migrate } = await import('./db.js');
  await migrate();
  console.log('Documents checked:', await backfillDocChecks());
  console.log('Demo messages added:', await seedDemoThreads());
  await pool.end();
}
