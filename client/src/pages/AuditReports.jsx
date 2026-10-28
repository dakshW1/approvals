import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fileUrl } from '../api.js';
import { ErrorBox, Loading, ROLE_LABEL, fmtDateTime, useLoad } from '../components/ui.jsx';

export default function AuditReports() {
  const [action, setAction] = useState('');
  const [q, setQ] = useState('');
  const query = new URLSearchParams({ ...(action && { action }), ...(q && { q }) }).toString();
  const { data, error, loading } = useLoad(() => api(`/audit?${query}`), [query]);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Audit trail & reports</h1>
          <p className="sub">Every submission, assignment, document review and status change, with who did it and when.</p>
        </div>
      </div>

      <div className="grid-2">
        <section className="card report-card">
          <div>
            <h2>Applications report</h2>
            <p className="muted small">All applications with status, officer, deadline, compliance score and missing documents.</p>
          </div>
          <a className="btn btn-primary" href={fileUrl('/reports/applications')}>Download CSV</a>
        </section>
        <section className="card report-card">
          <div>
            <h2>Audit trail export</h2>
            <p className="muted small">Complete action log for accountability reviews and RTI requests.</p>
          </div>
          <a className="btn btn-primary" href={fileUrl('/reports/audit')}>Download CSV</a>
        </section>
      </div>

      <div className="filters card">
        <input id="audit-q" className="input" placeholder="Search details, user or application no." value={q} onChange={(e) => setQ(e.target.value)} />
        <select id="audit-action" className="input" value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">All actions</option>
          {data?.actions.map((a) => (
            <option key={a} value={a}>{a.replace(/_/g, ' ').toLowerCase()}</option>
          ))}
        </select>
      </div>

      <ErrorBox error={error} />
      {loading && !data ? (
        <Loading />
      ) : (
        <section className="card card-flush">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>User</th>
                  <th>Action</th>
                  <th>Application</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="nowrap mono small">{fmtDateTime(r.created_at)}</td>
                    <td>
                      <div className="cell-title">{r.user_name || 'System'}</div>
                      <div className="cell-sub">{r.user_role ? ROLE_LABEL[r.user_role] : 'Automated rule'}</div>
                    </td>
                    <td><span className="mono audit-action">{r.action}</span></td>
                    <td className="nowrap">
                      {r.app_no ? <Link className="link mono small" to={`/applications/${r.application_id}`}>{r.app_no}</Link> : <span className="muted">-</span>}
                    </td>
                    <td className="details-cell">{r.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data.rows.length === 0 && <div className="empty">No audit entries match.</div>}
          </div>
        </section>
      )}
    </div>
  );
}
