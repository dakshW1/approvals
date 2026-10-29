import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../App.jsx';
import { api, fileUrl } from '../api.js';
import { DueChip, ErrorBox, Loading, ScoreBar, StatusBadge, fmtDate, useLoad } from '../components/ui.jsx';

const FLAGS = {
  '': 'All',
  pending: 'Pending review',
  overdue: 'Overdue',
  'due-soon': 'Due within 3 days',
  'non-compliant': 'Compliance alerts',
};

export default function Applications() {
  const { user, meta } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const query = params.toString();
  const { data, error, loading } = useLoad(() => api(`/applications?${query}`), [query]);

  const set = (key, value) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{user.role === 'COLLEGE' ? 'My applications' : 'Applications'}</h1>
          <p className="sub">
            {user.role === 'OFFICER' ? 'Applications assigned to you.' : user.role === 'ADMIN' ? 'All applications across regions.' : 'Every application your institution has submitted.'}
          </p>
        </div>
        <div className="head-actions">
          {user.role !== 'COLLEGE' && (
            <a className="btn btn-ghost" href={fileUrl('/reports/applications')}>Export CSV</a>
          )}
          {user.role === 'COLLEGE' && <Link to="/applications/new" className="btn btn-primary">New application</Link>}
        </div>
      </div>

      <div className="filters card">
        <input
          id="filter-q"
          className="input"
          placeholder="Search by application no., institution, program, city"
          defaultValue={params.get('q') || ''}
          onKeyDown={(e) => e.key === 'Enter' && set('q', e.target.value.trim())}
          onBlur={(e) => e.target.value.trim() !== (params.get('q') || '') && set('q', e.target.value.trim())}
        />
        <select id="filter-status" className="input" value={params.get('status') || ''} onChange={(e) => set('status', e.target.value)}>
          <option value="">All statuses</option>
          {Object.entries(meta.STATUSES).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select id="filter-category" className="input" value={params.get('category') || ''} onChange={(e) => set('category', e.target.value)}>
          <option value="">All categories</option>
          {Object.entries(meta.CATEGORIES).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <div className="segmented" role="group" aria-label="Quick filters">
          {Object.entries(FLAGS).map(([k, v]) => (
            <button key={k} className={(params.get('flag') || '') === k ? 'active' : ''} onClick={() => set('flag', k)}>{v}</button>
          ))}
        </div>
      </div>

      <ErrorBox error={error} />
      {loading && !data ? (
        <Loading />
      ) : (
        <section className="card card-flush">
          <div className="table-wrap">
            <table className="table table-cards">
              <thead>
                <tr>
                  <th>Application</th>
                  {user.role !== 'COLLEGE' && <th>Institution</th>}
                  <th>Category</th>
                  <th>Status</th>
                  <th>Pending with</th>
                  <th>Deadline</th>
                  <th>Compliance</th>
                  {user.role === 'ADMIN' && <th>Officer</th>}
                  <th>Submitted</th>
                </tr>
              </thead>
              <tbody>
                {data?.map((a) => (
                  <tr key={a.id} className="row-link" onClick={() => navigate(`/applications/${a.id}`)}>
                    <td data-label="Application" className="card-title-cell">
                      <div className="cell-title">{a.program}</div>
                      <div className="cell-sub mono">{a.app_no}</div>
                    </td>
                    {user.role !== 'COLLEGE' && (
                      <td data-label="Institution">
                        <div className="cell-title">{a.institution_name}</div>
                        <div className="cell-sub">{a.city}, {a.state}</div>
                      </td>
                    )}
                    <td data-label="Category">{a.category_label}</td>
                    <td data-label="Status"><StatusBadge status={a.status} /></td>
                    <td data-label="Pending with">{a.pending_with || <span className="muted">-</span>}</td>
                    <td data-label="Deadline"><DueChip app={a} /></td>
                    <td data-label="Compliance">
                      <ScoreBar score={a.compliance.score} />
                      {a.compliance.missing > 0 && <div className="cell-sub text-bad">{a.compliance.missing} doc(s) missing</div>}
                    </td>
                    {user.role === 'ADMIN' && <td data-label="Officer">{a.officer_name || <span className="text-bad">Unassigned</span>}</td>}
                    <td data-label="Submitted" className="nowrap">{fmtDate(a.submitted_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {data?.length === 0 && <div className="empty">No applications match these filters.</div>}
          </div>
        </section>
      )}
    </div>
  );
}
