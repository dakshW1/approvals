import { useState } from 'react';
import { useAuth } from '../App.jsx';
import { api } from '../api.js';
import { ErrorBox, Loading, useLoad } from '../components/ui.jsx';

export default function Officers() {
  const { meta } = useAuth();
  const { data, error, loading, setData } = useLoad(() => api('/officers'), []);
  const [busy, setBusy] = useState(null);

  const toggle = async (id) => {
    setBusy(id);
    try {
      setData(await api(`/officers/${id}/toggle`, { method: 'POST' }));
    } finally {
      setBusy(null);
    }
  };

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Officers & assignment rules</h1>
          <p className="sub">New applications are routed automatically using these rules. Pause an officer to remove them from auto-assignment.</p>
        </div>
      </div>

      <section className="card card-flush">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Officer</th>
                <th>Region</th>
                <th>Handles</th>
                <th>Workload</th>
                <th>Overdue</th>
                <th>Decided</th>
                <th>Auto-assign</th>
              </tr>
            </thead>
            <tbody>
              {data.map((o) => (
                <tr key={o.id} className={o.active ? '' : 'row-muted'}>
                  <td>
                    <div className="cell-title">{o.name}</div>
                    <div className="cell-sub">{o.designation}</div>
                  </td>
                  <td>{o.region}</td>
                  <td>
                    <div className="tag-row">
                      {o.categories.map((c) => (
                        <span key={c} className="tag">{meta.CATEGORIES[c]}</span>
                      ))}
                    </div>
                  </td>
                  <td>
                    <div className="load">
                      <div className="load-track">
                        <div className={`load-fill ${o.open_load / o.max_load > 0.75 ? 'bg-warn' : 'bg-brand'}`} style={{ width: `${(o.open_load / o.max_load) * 100}%` }} />
                      </div>
                      <span className="mono small">{o.open_load}/{o.max_load}</span>
                    </div>
                  </td>
                  <td>{o.overdue ? <span className="chip chip-bad">{o.overdue}</span> : <span className="muted">0</span>}</td>
                  <td>{o.decided}</td>
                  <td>
                    <button className={`switch ${o.active ? 'on' : ''}`} role="switch" aria-checked={!!o.active} disabled={busy === o.id} onClick={() => toggle(o.id)}>
                      <span className="switch-knob" />
                      <span className="switch-text">{o.active ? 'Active' : 'Paused'}</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid-2">
        <section className="card">
          <h2>How assignment works</h2>
          <ol className="rule-steps">
            <li><strong>Category to role.</strong> Only officers whose designation is allowed for the application category are eligible.</li>
            <li><strong>Specialisation.</strong> The officer must handle that category.</li>
            <li><strong>Capacity.</strong> Officers at their maximum open workload are skipped.</li>
            <li><strong>Region.</strong> An officer from the institution's region is preferred.</li>
            <li><strong>Workload.</strong> Among the rest, the officer with the fewest open applications is chosen.</li>
          </ol>
          <div className="table-wrap">
            <table className="table table-compact">
              <thead>
                <tr><th>Category</th><th>Eligible roles</th><th>Required documents</th></tr>
              </thead>
              <tbody>
                {Object.entries(meta.CATEGORIES).map(([k, v]) => (
                  <tr key={k}>
                    <td>{v}</td>
                    <td>{meta.ASSIGNMENT_RULES[k].join(', ')}</td>
                    <td>{meta.REQUIRED_DOCS[k].length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section className="card">
          <h2>Deadlines & compliance norms</h2>
          <dl className="facts">
            <div><dt>Officer review window</dt><dd>{meta.SLA.reviewDays} days</dd></div>
            <div><dt>Institution response window</dt><dd>{meta.SLA.responseDays} days</dd></div>
            <div><dt>Re-review after resubmission</dt><dd>{meta.SLA.reReviewDays} days</dd></div>
            <div><dt>Deadline warning</dt><dd>{meta.SLA.warnDays} days before</dd></div>
            <div><dt>Review not started alert</dt><dd>after {meta.SLA.pickupDays} days</dd></div>
            <div><dt>Certificate expiry warning</dt><dd>{meta.SLA.expiryWarnDays} days before</dd></div>
          </dl>
          <div className="table-wrap">
            <table className="table table-compact">
              <thead>
                <tr><th>Institution type</th><th>Faculty ratio</th><th>Min land</th><th>Built-up / student</th></tr>
              </thead>
              <tbody>
                {Object.entries(meta.NORMS).map(([k, n]) => (
                  <tr key={k}>
                    <td>{k}</td>
                    <td>1:{n.fsr}</td>
                    <td>{n.minLand} acres</td>
                    <td>{n.sqmPerStudent} sq.m</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small">Sample norms for the prototype. In production these are loaded from the current Approval Process Handbook.</p>
        </section>
      </div>
    </div>
  );
}
