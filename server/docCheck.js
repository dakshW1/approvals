// Automated document check: reads the text of an uploaded PDF and compares it with what the
// application says. Rule-based text analysis (no external AI service), so it is free and instant.
import { extractText, getDocumentProxy } from 'unpdf';
import { DOC_TYPES, EXPIRING_DOC_TYPES } from './rules.js';

// Words that should appear in each kind of document.
const KEYWORDS = {
  LAND_DOC: ['land', 'deed', 'lease', 'survey', 'khasra', 'sale deed', 'ownership'],
  BUILDING_PLAN: ['building plan', 'sanction', 'layout', 'floor plan', 'approved plan'],
  BUILDING_SAFETY: ['stability', 'structural', 'structure', 'safety'],
  FIRE_NOC: ['fire', 'no objection', 'noc'],
  STATE_NOC: ['government', 'no objection', 'noc', 'state'],
  UNIV_AFFILIATION: ['university', 'affiliation', 'board', 'consent'],
  AFFIDAVIT: ['affidavit', 'notary', 'solemnly', 'deponent', 'notarised', 'notarized'],
  FINANCIAL_STMT: ['financial', 'corpus', 'fixed deposit', 'balance', 'bank'],
  FACULTY_LIST: ['faculty', 'qualification', 'designation', 'professor'],
  LAB_DETAILS: ['laboratory', 'lab', 'equipment', 'apparatus'],
  CURRICULUM: ['curriculum', 'syllabus', 'semester', 'course'],
  AUDIT_REPORT: ['audit', 'chartered accountant', 'balance sheet', 'audited'],
};
const NAME_STOPWORDS = new Set([
  'of', 'the', 'and', 'for', 'institute', 'institution', 'college', 'school', 'technology', 'technical', 'engineering',
  'management', 'sciences', 'science', 'pharmaceutical', 'pharmacy', 'research', 'polytechnic', 'business', 'studies',
  'proposed', 'university', 'education', 'academy',
]);
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
const MON = '(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\\.?';

const ymd = (y, m, d) => {
  const dt = new Date(Date.UTC(y, m, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m && dt.getUTCDate() === d && y > 1950 && y < 2100 ? dt : null;
};

// Every date in the text, with its position. Numeric dates are read day-first, as written in India.
function findDates(text) {
  const out = [];
  const add = (re, toDate) => {
    for (const m of text.matchAll(re)) {
      const d = toDate(m);
      if (d) out.push({ date: d, index: m.index, raw: m[0] });
    }
  };
  add(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (m) => ymd(+m[1], +m[2] - 1, +m[3]));
  add(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/g, (m) => ymd(+m[3], +m[2] - 1, +m[1]));
  add(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MON},?\\s+(\\d{4})\\b`, 'gi'), (m) => ymd(+m[3], MONTHS[m[2].toLowerCase()], +m[1]));
  add(new RegExp(`\\b${MON}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'gi'), (m) => ymd(+m[3], MONTHS[m[1].toLowerCase()], +m[2]));
  return out.sort((a, b) => a.index - b.index);
}

// The date closest after a "valid until" / "expiry" phrase.
function findExpiry(text, dates) {
  const phrase = /(valid\s*(?:up\s*to|upto|till|until|through|thru)|validity|expir(?:y|es|ation|ing)(?:\s*date)?|date\s*of\s*expiry|renewal\s*due)/gi;
  let best = null;
  for (const m of text.matchAll(phrase)) {
    const after = dates.find((d) => d.index >= m.index && d.index - m.index <= 80);
    if (after && (!best || after.index - m.index < best.gap)) best = { ...after, gap: after.index - m.index, phrase: m[0] };
  }
  return best;
}

const fmt = (d) => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
const sameDay = (a, b) => Math.abs(a.getTime() - b.getTime()) < 36 * 3600 * 1000;

function nameMatch(text, institution) {
  const lower = text.toLowerCase();
  const words = institution.toLowerCase().replace(/[()&.,]/g, ' ').split(/\s+/).filter(Boolean);
  const key = words.filter((w) => !NAME_STOPWORDS.has(w) && w.length > 2);
  const tokens = key.length ? key : words;
  const found = tokens.filter((t) => lower.includes(t));
  return { ratio: tokens.length ? found.length / tokens.length : 0, tokens, found };
}

export async function checkDocument({ buffer, mimetype, filename = '', docType, institution, declaredExpiry, now = new Date() }) {
  const findings = [];
  const result = (status, extra = {}) => ({ status, findings, checked_at: new Date().toISOString(), ...extra });
  const label = DOC_TYPES[docType] || docType;

  if (!/pdf/i.test(mimetype || '') && !/\.pdf$/i.test(filename)) {
    findings.push({ level: 'info', text: 'Image files are not read automatically yet. Check this document by eye.' });
    return result('skipped');
  }

  let text = '';
  try {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    ({ text } = await extractText(pdf, { mergePages: true }));
    text = String(text || '').replace(/\s+/g, ' ').trim();
  } catch {
    findings.push({ level: 'warn', text: 'The PDF could not be opened for reading. It may be damaged or password-protected.' });
    return result('unreadable');
  }
  if (text.length < 40) {
    findings.push({ level: 'warn', text: 'No readable text found, so this is probably a scanned image. Check it by eye.' });
    return result('unreadable', { characters: text.length });
  }
  const lower = text.toLowerCase();

  // 1. Is it the right kind of document?
  const kws = KEYWORDS[docType] || [];
  const hits = kws.filter((k) => lower.includes(k));
  if (!kws.length || hits.length) findings.push({ level: 'ok', text: `Reads like the expected document: ${label}${hits.length ? ` (mentions "${hits.slice(0, 2).join('", "')}")` : ''}.` });
  else findings.push({ level: 'warn', text: `Doesn't mention words expected in a ${label} (such as "${kws.slice(0, 3).join('", "')}"). It may be the wrong document.` });

  // 2. Does it name the institution?
  const name = nameMatch(text, institution);
  if (name.ratio >= 0.6) findings.push({ level: 'ok', text: `Names the institution (${institution}).` });
  else if (name.ratio > 0) findings.push({ level: 'warn', text: `Only partly matches the institution name: found "${name.found.join(' ')}" of "${name.tokens.join(' ')}".` });
  else findings.push({ level: 'warn', text: `The institution name "${institution}" does not appear in the document.` });

  // 3. For certificates: does the validity date in the document match what was entered, and is it still valid?
  const dates = findDates(text);
  const expiry = findExpiry(text, dates);
  let extracted = null;
  if (EXPIRING_DOC_TYPES.includes(docType)) {
    if (!expiry) findings.push({ level: 'warn', text: 'No "valid until" date found in the document. Confirm the validity by eye.' });
    else {
      extracted = expiry.date.toISOString().slice(0, 10);
      if (expiry.date < now) findings.push({ level: 'fail', text: `The document says it expired on ${fmt(expiry.date)}.` });
      if (declaredExpiry && !sameDay(expiry.date, new Date(declaredExpiry)))
        findings.push({ level: 'warn', text: `The document says valid until ${fmt(expiry.date)}, but ${fmt(new Date(declaredExpiry))} was entered on the portal.` });
      else if (expiry.date >= now) findings.push({ level: 'ok', text: `Valid until ${fmt(expiry.date)}, matching the date entered.` });
    }
  }

  const status = findings.some((f) => f.level === 'fail') ? 'fail' : findings.some((f) => f.level === 'warn') ? 'warn' : 'pass';
  return result(status, { extracted_expiry: extracted, dates_found: dates.length, characters: text.length });
}
