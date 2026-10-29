// Generates the demo document pack for the live walkthrough: a fictional college applying for
// "B.E. Data Science". Correct and deliberately faulty versions of each required document.
// Run: node scripts/make-demo-documents.mjs   ->   demo-documents/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { jsPDF } from 'jspdf';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'demo-documents');
const COLLEGE = 'Sahyadri Institute of Engineering & Technology';
const ADDRESS = 'Survey No. 48, Baner Road, Pune, Maharashtra 411045';
const PRINCIPAL = 'Dr. Kavita Deshmukh';
const UNIVERSITY = 'Western Maharashtra Technological University';
const PROGRAM = 'B.E. Data Science';

function newDoc({ issuer = COLLEGE, issuerLine = ADDRESS, title, ref, date }) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 56;
  const ctx = { doc, W, H, M, y: M };
  doc.setFillColor(20, 20, 20).rect(0, 0, W, 5, 'F');
  doc.setFont('helvetica', 'bold').setFontSize(14).setTextColor(20, 20, 20).text(issuer, M, M + 4);
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(100, 100, 100).text(issuerLine, M, M + 18);
  if (ref) doc.text(`Ref: ${ref}`, W - M, M + 4, { align: 'right' });
  if (date) doc.text(`Date: ${date}`, W - M, M + 18, { align: 'right' });
  doc.setDrawColor(220, 220, 220).line(M, M + 30, W - M, M + 30);
  ctx.y = M + 58;
  doc.setTextColor(20, 20, 20).setFont('helvetica', 'bold').setFontSize(13).text(title, W / 2, ctx.y, { align: 'center' });
  ctx.y += 26;
  return ctx;
}

function para(ctx, text, { bold = false, size = 10.5, gap = 8, indent = 0 } = {}) {
  const { doc, W, M } = ctx;
  doc.setFont('helvetica', bold ? 'bold' : 'normal').setFontSize(size).setTextColor(20, 20, 20);
  const lines = doc.splitTextToSize(text, W - 2 * M - indent);
  doc.text(lines, M + indent, ctx.y);
  ctx.y += lines.length * size * 1.4 + gap;
}

function table(ctx, headers, rows, widths) {
  const { doc, M } = ctx;
  const rowH = 18;
  doc.setFillColor(240, 240, 236).rect(M, ctx.y - 12, widths.reduce((a, b) => a + b, 0), rowH, 'F');
  doc.setFont('helvetica', 'bold').setFontSize(9);
  let x = M + 4;
  headers.forEach((h, i) => { doc.text(h, x, ctx.y); x += widths[i]; });
  ctx.y += rowH;
  doc.setFont('helvetica', 'normal');
  for (const r of rows) {
    x = M + 4;
    r.forEach((c, i) => { doc.text(String(c), x, ctx.y, { maxWidth: widths[i] - 6 }); x += widths[i]; });
    doc.setDrawColor(230, 230, 230).line(M, ctx.y + 6, M + widths.reduce((a, b) => a + b, 0), ctx.y + 6);
    ctx.y += rowH;
  }
  ctx.y += 10;
}

function sign(ctx, name, role, { signed = true } = {}) {
  const { doc, M } = ctx;
  ctx.y += 16;
  doc.setFont('helvetica', 'italic').setFontSize(11).text(signed ? name.replace(/^Dr\. /, '') : '______________________', M, ctx.y);
  ctx.y += 16;
  doc.setFont('helvetica', 'bold').setFontSize(10.5).text(signed ? name : 'Name: ______________________', M, ctx.y);
  ctx.y += 14;
  doc.setFont('helvetica', 'normal').text(signed ? role : 'Signature and seal: not provided', M, ctx.y);
  ctx.y += 14;
}

function save(ctx, folder, file) {
  const { doc, W, H, M } = ctx;
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(150, 150, 150);
    doc.text('SAMPLE DOCUMENT FOR DEMONSTRATION. All names and records are fictional.', M, H - 32);
    doc.text(`Page ${p} of ${pages}`, W - M, H - 32, { align: 'right' });
  }
  const dir = path.join(ROOT, folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file), Buffer.from(doc.output('arraybuffer')));
  return path.join(folder, file);
}

const FACULTY = [
  ['Dr. Anand Joshi', 'Professor & Head', 'Ph.D. (Computer Science)', 'Machine learning', 19],
  ['Dr. Meera Kulkarni', 'Professor', 'Ph.D. (Statistics)', 'Statistical learning', 16],
  ['Dr. Rohan Patwardhan', 'Associate Professor', 'Ph.D. (Data Science)', 'Big data systems', 12],
  ['Dr. Sneha Iyer', 'Associate Professor', 'Ph.D. (Computer Engg.)', 'Deep learning', 11],
  ['Dr. Farhan Shaikh', 'Associate Professor', 'Ph.D. (IT)', 'Data engineering', 10],
  ['Dr. Pooja Nair', 'Associate Professor', 'Ph.D. (Mathematics)', 'Optimisation', 9],
  ['Mr. Aditya Kale', 'Assistant Professor', 'M.Tech (Data Science)', 'Data visualisation', 6],
  ['Ms. Ritu Sharma', 'Assistant Professor', 'M.Tech (CSE)', 'NLP', 5],
  ['Mr. Kunal Bhosale', 'Assistant Professor', 'M.Tech (AI)', 'Computer vision', 5],
  ['Ms. Aisha Khan', 'Assistant Professor', 'M.E. (Computer Engg.)', 'Cloud computing', 4],
  ['Mr. Vivek Rao', 'Assistant Professor', 'M.Tech (IT)', 'Databases', 4],
  ['Ms. Neha Gokhale', 'Assistant Professor', 'M.Sc. Statistics, NET', 'Probability', 3],
  ['Mr. Sahil Mehta', 'Assistant Professor', 'M.Tech (Data Science)', 'MLOps', 3],
];

const made = [];

// 01 Faculty list: correct (13 faculty, qualifications, signed) and faulty (10 faculty, no qualifications, unsigned).
{
  const c = newDoc({ title: 'Faculty List with Qualifications: B.E. Data Science', ref: 'SIET/AICTE/2027/014', date: '05/09/2026' });
  para(c, `List of regular faculty appointed for the proposed ${PROGRAM} program (intake 60, AY 2027-28) at ${COLLEGE}.`);
  table(c, ['Name', 'Designation', 'Qualification', 'Specialisation', 'Exp. (yrs)'], FACULTY, [118, 108, 128, 98, 50]);
  para(c, 'Total regular faculty: 13. Required at the faculty-student ratio of 1:20 for 240 students (60 per year over 4 years): 12.', { bold: true });
  para(c, 'Certified that the above faculty are on the regular rolls of the institution and their qualifications have been verified from original certificates.');
  sign(c, PRINCIPAL, `Principal, ${COLLEGE}`);
  made.push(['CORRECT', save(c, 'correct', '01_Faculty_List_CORRECT.pdf')]);

  const f = newDoc({ title: 'Faculty List: B.E. Data Science', ref: 'SIET/AICTE/2027/014', date: '05/09/2026' });
  para(f, `Faculty for the proposed ${PROGRAM} program at ${COLLEGE}.`);
  table(f, ['Name', 'Designation', 'Exp. (yrs)'], FACULTY.slice(0, 10).map((r) => [r[0], r[1], r[4]]), [190, 190, 80]);
  para(f, 'Total faculty: 10.', { bold: true });
  sign(f, PRINCIPAL, 'Principal', { signed: false });
  made.push(['FAULTY', save(f, 'faulty', '01_Faculty_List_FAULTY.pdf')]);
}

// 02 Laboratory details: correct only.
{
  const c = newDoc({ title: 'Laboratory & Equipment Details: B.E. Data Science', ref: 'SIET/AICTE/2027/015', date: '05/09/2026' });
  para(c, `Laboratories set up for the ${PROGRAM} program at ${COLLEGE}. All equipment is installed and in working condition.`);
  table(c, ['Laboratory', 'Area (sq.m)', 'Key equipment', 'Qty'], [
    ['Data Science Lab', 132, 'Workstations (i7, 32 GB RAM)', 60],
    ['Machine Learning Lab', 110, 'GPU server (4x NVIDIA A100)', 1],
    ['Big Data & Cloud Lab', 105, 'Hadoop/Spark cluster nodes', 8],
    ['Statistics & Visualisation Lab', 90, 'Licensed statistics software seats', 60],
    ['Project Lab', 75, 'Collaboration displays, edge devices', 12],
  ], [150, 70, 210, 40]);
  para(c, 'Total laboratory area: 512 sq.m. Internet bandwidth: 1 Gbps leased line. UPS backup: 2 hours for all laboratories.');
  sign(c, PRINCIPAL, `Principal, ${COLLEGE}`);
  made.push(['CORRECT', save(c, 'correct', '02_Lab_Details_CORRECT.pdf')]);
}

// 03 Curriculum: correct (semester-wise syllabus) and faulty (a fee structure uploaded by mistake).
{
  const c = newDoc({ issuer: UNIVERSITY, issuerLine: 'Board of Studies in Computer & Data Sciences', title: `Curriculum & Syllabus: ${PROGRAM}`, ref: 'WMTU/BOS/DS/2026/07', date: '12/08/2026' });
  para(c, `Semester-wise curriculum for ${PROGRAM}, as adopted for affiliated college ${COLLEGE}, Pune, from AY 2027-28. Approved by the Board of Studies in its meeting dated 12/08/2026.`);
  table(c, ['Semester', 'Core courses'], [
    ['Semester 1', 'Engineering Mathematics I, Programming in Python, Physics, Engineering Graphics'],
    ['Semester 2', 'Engineering Mathematics II, Data Structures, Digital Logic, Communication Skills'],
    ['Semester 3', 'Probability & Statistics, Database Systems, Object-Oriented Programming'],
    ['Semester 4', 'Linear Algebra for Data Science, Algorithms, Operating Systems'],
    ['Semester 5', 'Machine Learning, Data Visualisation, Computer Networks'],
    ['Semester 6', 'Deep Learning, Big Data Analytics, Elective I'],
    ['Semester 7', 'Natural Language Processing, Cloud for Data Engineering, Elective II'],
    ['Semester 8', 'Major Project, Internship, Research Methodology'],
  ], [90, 390]);
  para(c, 'Credits: 160 in total. Each course syllabus, with course outcomes and reference books, is attached as Annexure A.');
  sign(c, 'Dr. S. R. Pawar', `Chairperson, Board of Studies, ${UNIVERSITY}`);
  made.push(['CORRECT', save(c, 'correct', '03_Curriculum_CORRECT.pdf')]);

  const f = newDoc({ title: 'Fee Structure 2027-28', ref: 'SIET/ACC/2027/03', date: '01/09/2026' });
  para(f, `Annual fees for students admitted to ${PROGRAM} at ${COLLEGE} for the year 2027-28.`);
  table(f, ['Head', 'Amount per year (Rs.)'], [
    ['Tuition fee', '1,15,000'], ['Development fee', '15,000'], ['Library & e-resources', '6,000'],
    ['Laboratory & computing', '12,000'], ['Examination', '4,500'], ['Total', '1,52,500'],
  ], [280, 200]);
  para(f, 'Fees are payable in two instalments. Scholarships as per State Government norms.');
  sign(f, 'Mr. Prakash Jadhav', `Accounts Officer, ${COLLEGE}`);
  made.push(['FAULTY', save(f, 'faulty', '03_Curriculum_FAULTY.pdf')]);
}

// 04 Affidavit: correct only.
{
  const c = newDoc({ issuer: 'Affidavit on Non-Judicial Stamp Paper (Rs. 500)', issuerLine: 'Before the Notary Public, Pune', title: 'Notarised Affidavit', date: '06/09/2026' });
  para(c, `I, ${PRINCIPAL}, Principal of ${COLLEGE}, ${ADDRESS}, do hereby solemnly affirm and state as under:`);
  [
    `1. That the institution has applied to AICTE for approval of a new program, ${PROGRAM}, with an intake of 60 from AY 2027-28.`,
    '2. That all information and documents submitted with the application are true and correct to the best of my knowledge.',
    '3. That the faculty, laboratories and infrastructure declared in the application are available and in use.',
    '4. That the institution will abide by the norms of AICTE and the affiliating university.',
  ].forEach((t) => para(c, t, { indent: 10, gap: 5 }));
  para(c, 'Verified at Pune on 06/09/2026 that the contents of this affidavit are true and that nothing material has been concealed.', { gap: 12 });
  sign(c, PRINCIPAL, 'Deponent');
  para(c, 'Sworn before me. Notary: Adv. R. M. Kulkarni, Reg. No. NOT/PUN/4471, seal affixed.', { size: 9.5 });
  made.push(['CORRECT', save(c, 'correct', '04_Affidavit_CORRECT.pdf')]);
}

// 05 University affiliation consent: correct (for this college and program) and faulty (issued to a different college).
{
  const letter = (to, program) => [
    'To,',
    `The Principal, ${to}`,
    '',
    `Subject: Consent of affiliation for ${program} from AY 2027-28`,
    '',
    `With reference to your application, the University is pleased to grant consent of affiliation to ${to} for the program ${program} with an intake of 60 seats from AY 2027-28, subject to approval of the All India Council for Technical Education and the conditions of affiliation of the University.`,
    'This consent is valid for the purpose of the AICTE approval process for AY 2027-28.',
  ];
  const c = newDoc({ issuer: UNIVERSITY, issuerLine: 'Office of the Registrar, Affiliation Section', title: 'Consent of Affiliation', ref: 'WMTU/AFF/2026/1189', date: '20/08/2026' });
  letter(COLLEGE, PROGRAM).forEach((t) => (t ? para(c, t, { gap: 4 }) : (c.y += 6)));
  sign(c, 'Dr. N. B. Thorat', `Registrar, ${UNIVERSITY}`);
  made.push(['CORRECT', save(c, 'correct', '05_University_Affiliation_CORRECT.pdf')]);

  const f = newDoc({ issuer: UNIVERSITY, issuerLine: 'Office of the Registrar, Affiliation Section', title: 'Consent of Affiliation', ref: 'WMTU/AFF/2026/0942', date: '02/08/2026' });
  letter('Deccan Valley Institute of Technology, Satara', 'B.E. Computer Engineering').forEach((t) => (t ? para(f, t, { gap: 4 }) : (f.y += 6)));
  sign(f, 'Dr. N. B. Thorat', `Registrar, ${UNIVERSITY}`);
  made.push(['FAULTY', save(f, 'faulty', '05_University_Affiliation_FAULTY.pdf')]);
}

console.log(`Created ${made.length} documents in ${ROOT}`);
for (const [kind, file] of made) console.log(`  ${kind.padEnd(8)} ${file}`);
