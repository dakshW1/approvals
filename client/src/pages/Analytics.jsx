import { useState } from 'react';
import { useAuth } from '../App.jsx';
import { api } from '../api.js';
import { ErrorBox, Icon, Loading, useLoad } from '../components/ui.jsx';

const fmtDays = (d) => (d === null || d === undefined ? '-' : `${d} d`);
const fmtPct = (p) => (p === null || p === undefined ? '-' : `${p}%`);
const monthLabel = (key, i) => {
  const d = new Date(`${key}-01T00:00:00Z`);
  const m = d.toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' });
  return i === 0 || m === 'Jan' ? `${m} ${String(d.getUTCFullYear()).slice(2)}` : m;
};

function Kpi({ label, value, foot, icon, tone }) {
  return (
    <div className={`tile tile-static ${tone ? `tile-${tone}` : ''}`}>
      <span className="tile-top">
        <span className="tile-label">{label}</span>
        <span className="tile-icon"><Icon name={icon} size={17} /></span>
      </span>
      <span className="tile-value">{value}</span>
      {foot && <span className="tile-foot">{foot}</span>}
    </div>
  );
}

// Two series (submitted, decided) per month as grouped bars on one count axis.
function MonthlyChart({ data }) {
  const [hover, setHover] = useState(null);
  const [asTable, setAsTable] = useState(false);
  const W = 720;
  const H = 240;
  const m = { top: 12, right: 8, bottom: 30, left: 30 };
  const iw = W - m.left - m.right;
  const ih = H - m.top - m.bottom;
  const max = Math.max(1, ...data.flatMap((d) => [d.submitted, d.decided]));
  const step = max <= 5 ? 1 : max <= 10 ? 2 : Math.ceil(max / 5);
  const top = Math.ceil(max / step) * step;
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step);
  const y = (v) => m.top + ih - (v / top) * ih;
  const group = iw / data.length;
  const bw = Math.min(16, group * 0.32);
  const bar = (x, v) => {
    const h = (v / top) * ih;
    if (h <= 0) return null;
    const r = Math.min(4, h, bw / 2);
    const y0 = m.top + ih;
    return `M${x},${y0} V${y0 - h + r} Q${x},${y0 - h} ${x + r},${y0 - h} H${x + bw - r} Q${x + bw},${y0 - h} ${x + bw},${y0 - h + r} V${y0} Z`;
  };

  return (
    <section className="card">
      <div className="card-head">
        <h2>Monthly volume</h2>
        <button className="link-btn" onClick={() => setAsTable((t) => !t)}>{asTable ? 'Show chart' : 'Show as table'}</button>
      </div>
      <ul className="viz-legend" aria-label="Legend">
        <li><span className="viz-swatch s1" />Submitted</li>
        <li><span className="viz-swatch s2" />Decided (approved or rejected)</li>
      </ul>
      {asTable ? (
        <div className="table-wrap">
          <table className="table table-compact">
            <thead><tr><th>Month</th><th>Submitted</th><th>Decided</th><th>Approved</th><th>Rejected</th></tr></thead>
            <tbody>
              {data.map((d, i) => (
                <tr key={d.month}><td>{monthLabel(d.month, i)}</td><td>{d.submitted}</td><td>{d.decided}</td><td>{d.approved}</td><td>{d.rejected}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="viz" onMouseLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Applications submitted and decided per month, last 12 months">
            {ticks.map((t) => (
              <g key={t}>
                <line className="viz-grid" x1={m.left} x2={W - m.right} y1={y(t)} y2={y(t)} />
                <text className="viz-tick" x={m.left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle">{t}</text>
              </g>
            ))}
            {data.map((d, i) => {
              const gx = m.left + i * group;
              const x1 = gx + group / 2 - bw - 1;
              const x2 = gx + group / 2 + 1;
              return (
                <g key={d.month} className={hover !== null && hover !== i ? 'viz-dim' : ''}>
                  {bar(x1, d.submitted) && <path className="viz-s1" d={bar(x1, d.submitted)} />}
                  {bar(x2, d.decided) && <path className="viz-s2" d={bar(x2, d.decided)} />}
                  <text className="viz-tick" x={gx + group / 2} y={H - 10} textAnchor="middle">{monthLabel(d.month, i)}</text>
                  <rect className="viz-hit" x={gx} y={m.top} width={group} height={ih} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} aria-label={`${monthLabel(d.month, i)}: ${d.submitted} submitted, ${d.decided} decided`} />
                </g>
              );
            })}
          </svg>
          {hover !== null && (
            <div className="viz-tip" style={{ left: `${((m.left + (hover + 0.5) * group) / W) * 100}%` }}>
              <strong>{monthLabel(data[hover].month, 0)}</strong>
              <span><i className="viz-swatch s1" />{data[hover].submitted} submitted</span>
              <span><i className="viz-swatch s2" />{data[hover].decided} decided</span>
              {data[hover].decided > 0 && <span className="muted">{data[hover].approved} approved · {data[hover].rejected} rejected</span>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function StageBars({ stages, sla }) {
  const top = Math.max(1, ...stages.map((s) => s.avg_days || 0));
  return (
    <section className="card">
      <div className="card-head">
        <h2>Where the time goes</h2>
        <span className="muted small">Average days spent in each stage</span>
      </div>
      <ul className="bars stage-bars">
        {stages.map((s) => (
          <li key={s.key} title={`${s.label}: average ${fmtDays(s.avg_days)}, median ${fmtDays(s.median_days)}, from ${s.samples} completed stage(s)`}>
            <span className="bars-label">{s.label}</span>
            <span className="bars-track"><span className="bars-fill" style={{ width: `${((s.avg_days || 0) / top) * 100}%` }} /></span>
            <span className="bars-num">{fmtDays(s.avg_days)} <span className="muted">· {s.samples}×</span></span>
          </li>
        ))}
      </ul>
      <p className="muted small">The review window is {sla} days. Time with the institution ("Institution responding") does not count against the officer.</p>
    </section>
  );
}

function RateBar({ value }) {
  if (value === null || value === undefined) return <span className="muted">-</span>;
  return (
    <span className="ratebar" title={`${value}%`}>
      <span className="ratebar-track"><span className="ratebar-fill" style={{ width: `${value}%` }} /></span>
      <span className="ratebar-num">{value}%</span>
    </span>
  );
}

export default function Analytics() {
  const { user } = useAuth();
  const { data, error, loading } = useLoad(() => api('/analytics'), []);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const k = data.kpis;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Analytics</h1>
          <p className="sub">
            {user.role === 'OFFICER' ? 'How your assigned applications are moving.' : 'How applications move through approval, where they slow down, and how regions and officers compare.'}
          </p>
        </div>
      </div>

      <div className="kpi-row">
        <Kpi label="Days to decision" icon="clock" value={fmtDays(k.avg_decision_days)} foot={`Median ${fmtDays(k.median_decision_days)} · ${k.decided} decided`} />
        <Kpi label="Decided on time" icon="check" value={fmtPct(k.on_time_rate)} foot={`Officer time within ${data.sla_review_days} days`} tone={k.on_time_rate !== null && k.on_time_rate < 70 ? 'warn' : 'ok'} />
        <Kpi label="Approval rate" icon="shield" value={fmtPct(k.approval_rate)} foot={`${k.exceptions} approved with exception`} />
        <Kpi label="Institution response" icon="mail" value={fmtDays(k.avg_response_days)} foot={k.avg_response_days === null ? 'No "Action required" round completed yet' : 'Average reply to "Action required"'} />
      </div>

      <div className="analytics-grid">
        <MonthlyChart data={data.monthly} />
        <StageBars stages={data.stages} sla={data.sla_review_days} />
      </div>

      <div className="grid-2">
        <section className="card card-flush">
          <div className="card-head card-pad"><h2>By region</h2></div>
          <div className="table-wrap">
            <table className="table table-cards">
              <thead><tr><th>Region</th><th>Applications</th><th>Overdue</th><th>Avg days</th><th>Approval rate</th></tr></thead>
              <tbody>
                {data.regions.map((r) => (
                  <tr key={r.region}>
                    <td data-label="Region"><strong>{r.region}</strong></td>
                    <td data-label="Applications">{r.total} <span className="muted">({r.open} open)</span></td>
                    <td data-label="Overdue">{r.overdue ? <span className="chip chip-bad">{r.overdue}</span> : <span className="muted">0</span>}</td>
                    <td data-label="Avg days">{fmtDays(r.avg_decision_days)}</td>
                    <td data-label="Approval rate"><RateBar value={r.approval_rate} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="card card-flush">
          <div className="card-head card-pad"><h2>By category</h2></div>
          <div className="table-wrap">
            <table className="table table-cards">
              <thead><tr><th>Category</th><th>Applications</th><th>Avg days</th><th>Approval rate</th></tr></thead>
              <tbody>
                {data.categories.map((c) => (
                  <tr key={c.key}>
                    <td data-label="Category"><strong>{c.label}</strong></td>
                    <td data-label="Applications">{c.total} <span className="muted">({c.open} open)</span></td>
                    <td data-label="Avg days">{fmtDays(c.avg_decision_days)}</td>
                    <td data-label="Approval rate"><RateBar value={c.approval_rate} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {data.officers.length > 0 && (
        <section className="card card-flush">
          <div className="card-head card-pad">
            <h2>Officer performance</h2>
            <span className="muted small">Officer days exclude time waiting on the institution</span>
          </div>
          <div className="table-wrap">
            <table className="table table-cards">
              <thead><tr><th>Officer</th><th>Open</th><th>Overdue</th><th>Decided</th><th>Avg officer days</th><th>On time</th><th>Exceptions</th></tr></thead>
              <tbody>
                {data.officers.map((o) => (
                  <tr key={o.id}>
                    <td data-label="Officer"><div className="cell-title">{o.name}</div></td>
                    <td data-label="Open">{o.open}</td>
                    <td data-label="Overdue">{o.overdue ? <span className="chip chip-bad">{o.overdue}</span> : <span className="muted">0</span>}</td>
                    <td data-label="Decided">{o.approved + o.rejected}</td>
                    <td data-label="Avg officer days">{fmtDays(o.avg_officer_days)}</td>
                    <td data-label="On time"><RateBar value={o.on_time_rate} /></td>
                    <td data-label="Exceptions">{o.exceptions || <span className="muted">0</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <p className="muted small">Based on {k.submitted} submitted applications. Averages use completed stages only.</p>
    </div>
  );
}
