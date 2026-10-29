import { query, nowIso } from './db.js';
import { CATEGORIES, OPEN_STATUSES, SLA } from './rules.js';
import { REGIONS } from './auth.js';

const DAY = 86400000;
const days = (a, b) => (new Date(b) - new Date(a)) / DAY;
const round1 = (n) => (n === null || n === undefined || Number.isNaN(n) ? null : Math.round(n * 10) / 10);
const avg = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (num, den) => (den ? Math.round((num / den) * 100) : null);

// Time spent in each stage, from consecutive status changes.
const STAGES = {
  SUBMITTED: 'Waiting for review to start',
  UNDER_REVIEW: 'Officer review',
  ACTION_REQUIRED: 'Institution responding',
};

export async function analytics(user) {
  const scoped = user.role === 'OFFICER';
  const [apps, history] = await Promise.all([
    query(
      `SELECT a.id, a.status, a.category, a.submitted_at, a.decided_at, a.due_date, a.override_note, a.assigned_officer_id,
              i.region, u.name AS officer_name
       FROM applications a JOIN institutions i ON i.id = a.institution_id LEFT JOIN profiles u ON u.id = a.assigned_officer_id
       WHERE a.status <> 'DRAFT' ${scoped ? 'AND a.assigned_officer_id = ?' : ''}`,
      scoped ? [user.id] : []
    ),
    query(
      `SELECT h.application_id, h.to_status, h.created_at FROM status_history h
       JOIN applications a ON a.id = h.application_id
       WHERE a.status <> 'DRAFT' ${scoped ? 'AND a.assigned_officer_id = ?' : ''}
       ORDER BY h.application_id, h.created_at, h.id`,
      scoped ? [user.id] : []
    ),
  ]);
  const now = nowIso();

  // Per application: completed time in each stage, plus officer time (total minus time with the institution).
  const byApp = {};
  for (const h of history) (byApp[h.application_id] ||= []).push(h);
  const stageTimes = Object.fromEntries(Object.keys(STAGES).map((k) => [k, []]));
  const per = {};
  for (const a of apps) {
    const hs = byApp[a.id] || [];
    const spent = { SUBMITTED: 0, UNDER_REVIEW: 0, ACTION_REQUIRED: 0 };
    for (let i = 0; i < hs.length - 1; i++) {
      const k = hs[i].to_status;
      if (spent[k] === undefined) continue;
      const d = days(hs[i].created_at, hs[i + 1].created_at);
      spent[k] += d;
      stageTimes[k].push(d);
    }
    const decided = a.decided_at && a.submitted_at ? days(a.submitted_at, a.decided_at) : null;
    const officerDays = decided === null ? null : decided - spent.ACTION_REQUIRED;
    per[a.id] = {
      decided,
      officerDays,
      onTime: officerDays === null ? null : officerDays <= SLA.reviewDays,
      overdue: OPEN_STATUSES.includes(a.status) && a.due_date && a.due_date < now,
      responseDays: spent.ACTION_REQUIRED || null,
    };
  }

  const decidedApps = apps.filter((a) => per[a.id].decided !== null);
  const approved = apps.filter((a) => a.status === 'APPROVED');
  const rejected = apps.filter((a) => a.status === 'REJECTED');
  const responses = stageTimes.ACTION_REQUIRED;

  const summarise = (list) => {
    const dec = list.filter((a) => per[a.id].decided !== null);
    const ap = list.filter((a) => a.status === 'APPROVED').length;
    const rj = list.filter((a) => a.status === 'REJECTED').length;
    return {
      total: list.length,
      open: list.filter((a) => OPEN_STATUSES.includes(a.status)).length,
      overdue: list.filter((a) => per[a.id].overdue).length,
      approved: ap,
      rejected: rj,
      approval_rate: pct(ap, ap + rj),
      avg_decision_days: round1(avg(dec.map((a) => per[a.id].decided))),
      on_time_rate: pct(dec.filter((a) => per[a.id].onTime).length, dec.length),
      exceptions: list.filter((a) => a.status === 'APPROVED' && a.override_note).length,
    };
  };

  // Last 12 months, oldest first.
  const months = [];
  const d = new Date();
  for (let i = 11; i >= 0; i--) {
    const m = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1));
    months.push(m.toISOString().slice(0, 7));
  }
  const monthly = months.map((key) => ({
    month: key,
    submitted: apps.filter((a) => a.submitted_at?.startsWith(key)).length,
    decided: apps.filter((a) => a.decided_at?.startsWith(key)).length,
    approved: apps.filter((a) => a.decided_at?.startsWith(key) && a.status === 'APPROVED').length,
    rejected: apps.filter((a) => a.decided_at?.startsWith(key) && a.status === 'REJECTED').length,
  }));

  const officers = {};
  for (const a of apps) if (a.assigned_officer_id) (officers[a.assigned_officer_id] ||= { name: a.officer_name, list: [] }).list.push(a);

  return {
    scope: scoped ? 'officer' : 'all',
    sla_review_days: SLA.reviewDays,
    kpis: {
      submitted: apps.length,
      decided: decidedApps.length,
      avg_decision_days: round1(avg(decidedApps.map((a) => per[a.id].decided))),
      median_decision_days: round1(median(decidedApps.map((a) => per[a.id].decided))),
      on_time_rate: pct(decidedApps.filter((a) => per[a.id].onTime).length, decidedApps.length),
      approval_rate: pct(approved.length, approved.length + rejected.length),
      avg_response_days: round1(avg(responses)),
      overdue_now: apps.filter((a) => per[a.id].overdue).length,
      exceptions: approved.filter((a) => a.override_note).length,
    },
    stages: Object.entries(STAGES).map(([key, label]) => ({
      key,
      label,
      avg_days: round1(avg(stageTimes[key])),
      median_days: round1(median(stageTimes[key])),
      samples: stageTimes[key].length,
    })),
    monthly,
    regions: REGIONS.map((r) => ({ region: r, ...summarise(apps.filter((a) => a.region === r)) })).filter((r) => r.total),
    categories: Object.entries(CATEGORIES).map(([key, label]) => ({ key, label, ...summarise(apps.filter((a) => a.category === key)) })).filter((c) => c.total),
    officers: scoped
      ? []
      : Object.entries(officers)
          .map(([id, o]) => {
            const s = summarise(o.list);
            const dec = o.list.filter((a) => per[a.id].officerDays !== null);
            return { id: Number(id), name: o.name, ...s, avg_officer_days: round1(avg(dec.map((a) => per[a.id].officerDays))) };
          })
          .sort((a, b) => a.name.localeCompare(b.name)),
  };
}
