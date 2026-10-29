import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../App.jsx';
import { api } from '../api.js';
import { DueChip, ErrorBox, Icon, Loading, ScoreBar, ScoreRing, STATUS_META, StatusBadge, timeAgo, useLoad } from '../components/ui.jsx';

const GREETING = {
  ADMIN: 'Every approval application across regions, with what needs attention first.',
  OFFICER: 'Applications assigned to you, sorted by what needs action first.',
  COLLEGE: 'Your applications, deadlines and what AICTE needs from you.',
};

function salutation() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

function firstName(user) {
  if (user.role === 'COLLEGE') return 'Principal';
  if (user.role === 'ADMIN') return 'Director';
  return user.name.replace(/^Dr\.\s*/, '').split(' ')[0];
}

function Tile({ label, value, to, tone, foot, icon }) {
  return (
    <Link to={to} className={`tile ${tone ? `tile-${tone}` : ''}`}>
      <span className="tile-top">
        <span className="tile-label">{label}</span>
        <span className="tile-icon"><Icon name={icon} size={17} /></span>
      </span>
      <span className="tile-value">{value}</span>
      {foot && <span className="tile-foot">{foot}</span>}
    </Link>
  );
}

function HeroCard({ t, role }) {
  const open = t.pending + t.action_required;
  const caption =
    role === 'COLLEGE' ? 'applications in progress' : role === 'OFFICER' ? 'applications on your desk' : 'applications in progress';
  return (
    <section className="card night hero-card">
      <div className="hero-top">
        <ScoreRing score={t.avg_score} size={112} />
        <div>
          <div className="eyebrow">Open right now</div>
          <div className="hero-num">{open}</div>
          <div className="hero-caption">{caption}</div>
          <div className="muted small">Ring shows average compliance score</div>
        </div>
      </div>
      <div className="hero-stats">
        <Link to="/applications?flag=overdue">
          <span className={`hero-stat-num ${t.overdue ? 'is-bad' : ''}`}>{t.overdue}</span>
          <span className="hero-stat-label">Overdue</span>
        </Link>
        <Link to="/applications?flag=due-soon">
          <span className={`hero-stat-num ${t.due_soon ? 'is-warn' : ''}`}>{t.due_soon}</span>
          <span className="hero-stat-label">Due in 3 days</span>
        </Link>
        <Link to="/applications?status=SUBMITTED">
          <span className="hero-stat-num">{t.submitted}</span>
          <span className="hero-stat-label">Not started</span>
        </Link>
      </div>
    </section>
  );
}

function StatusStrip({ totals }) {
  const parts = ['SUBMITTED', 'UNDER_REVIEW', 'ACTION_REQUIRED', 'APPROVED', 'REJECTED'].map((s) => ({
    s,
    n: totals[s.toLowerCase()],
  }));
  const total = totals.total || 1;
  return (
    <div>
      <div className="strip" role="img" aria-label="Applications by status">
        {parts.map((p) =>
          p.n ? <div key={p.s} className={`strip-seg bg-${STATUS_META[p.s].tone}`} style={{ flexGrow: p.n }} title={`${STATUS_META[p.s].label}: ${p.n}`} /> : null
        )}
      </div>
      <ul className="legend">
        {parts.map((p) => (
          <li key={p.s}>
            <Link to={`/applications?status=${p.s}`}>
              <span className={`legend-dot bg-${STATUS_META[p.s].tone}`} />
              {STATUS_META[p.s].label}
              <strong>{p.n}</strong>
              <span className="muted">{Math.round((p.n / total) * 100)}%</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Bars({ rows, max, render }) {
  const top = Math.max(max ?? 0, ...rows.map((r) => r.value), 1);
  return (
    <ul className="bars">
      {rows.map((r) => (
        <li key={r.key}>
          <span className="bars-label">{r.label}</span>
          <span className="bars-track">
            <span className={`bars-fill ${r.tone ? `bg-${r.tone}` : ''}`} style={{ width: `${(r.value / top) * 100}%` }} />
          </span>
          <span className="bars-num">{render ? render(r) : r.value}</span>
        </li>
      ))}
    </ul>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data, error, loading } = useLoad(() => api('/dashboard'), []);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const t = data.totals;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <p className="greet-date">
            {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
          <h1>{salutation()}, {firstName(user)}.</h1>
          <p className="sub">{GREETING[user.role]}</p>
        </div>
        {user.role === 'COLLEGE' && (
          <Link to="/applications/new" className="btn btn-primary"><Icon name="plus" size={17} /> New application</Link>
        )}
      </div>

      <div className="hero-grid">
        <HeroCard t={t} role={user.role} />
        <div className="tiles">
          <Tile label="Pending review" icon="clock" value={t.pending} to="/applications?flag=pending" foot={`${t.under_review} under review`} />
          <Tile label="Action required" icon="alert" value={t.action_required} to="/applications?status=ACTION_REQUIRED" tone={t.action_required ? 'warn' : ''} foot="Waiting on institution" />
          <Tile label="Approved" icon="check" value={t.approved} to="/applications?status=APPROVED" tone="ok" foot={data.avg_decision_days ? `Avg ${data.avg_decision_days} days to decide` : `${t.rejected} rejected`} />
          <Tile label="Compliance alerts" icon="shield" value={t.non_compliant} to="/applications?flag=non-compliant" tone={t.non_compliant ? 'bad' : ''} foot={`of ${t.total} applications`} />
        </div>
      </div>

      <div className="grid-2">
        <section className="card">
          <div className="card-head">
            <h2>Needs attention</h2>
            <Link to="/applications?flag=overdue" className="link">View overdue</Link>
          </div>
          {data.attention.length === 0 ? (
            <div className="empty">Nothing overdue or failing compliance. Good work.</div>
          ) : (
            <div className="table-wrap">
              <table className="table table-compact table-cards">
                <thead>
                  <tr>
                    <th>Application</th>
                    <th>Status</th>
                    <th>Deadline</th>
                    <th>Compliance</th>
                  </tr>
                </thead>
                <tbody>
                  {data.attention.map((a) => (
                    <tr key={a.id} className="row-link" onClick={() => navigate(`/applications/${a.id}`)}>
                      <td data-label="Application" className="card-title-cell">
                        <div className="cell-title">{a.institution_name}</div>
                        <div className="cell-sub mono">{a.app_no}</div>
                      </td>
                      <td data-label="Status"><StatusBadge status={a.status} /></td>
                      <td data-label="Deadline"><DueChip app={a} /></td>
                      <td data-label="Compliance"><ScoreBar score={a.compliance.score} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Status overview</h2>
          </div>
          <StatusStrip totals={t} />
          <h3 className="mini-head">By category</h3>
          <Bars
            rows={data.byCategory.map((c) => ({ key: c.key, label: c.label, value: c.count, open: c.open }))}
            render={(r) => (
              <>
                {r.value} <span className="muted">({r.open} open)</span>
              </>
            )}
          />
        </section>
      </div>

      <div className={data.workload ? 'grid-2' : ''}>
        {data.workload && (
          <section className="card">
            <div className="card-head">
              <h2>Officer workload</h2>
              <Link to="/officers" className="link">Manage officers</Link>
            </div>
            <Bars
              max={8}
              rows={data.workload.map((o) => ({
                key: o.id,
                label: `${o.name} · ${o.region}`,
                value: o.open_load,
                tone: o.overdue ? 'warn' : 'brand',
                o,
              }))}
              render={(r) => (
                <>
                  {r.value}/{r.o.max_load}
                  {r.o.overdue > 0 && <span className="text-bad"> · {r.o.overdue} overdue</span>}
                </>
              )}
            />
          </section>
        )}
        <section className="card">
          <div className="card-head">
            <h2>Recent activity</h2>
          </div>
          <ul className="feed">
            {data.recent.map((h) => (
              <li key={h.id}>
                <Link to={`/applications/${h.application_id}`} className="mono feed-app">{h.app_no}</Link>
                <span>
                  {h.from_status ? (
                    <>moved to <StatusBadge status={h.to_status} /></>
                  ) : (
                    'submitted'
                  )}{' '}
                  by {h.user_name || 'System'}
                </span>
                <span className="muted feed-time">{timeAgo(h.created_at)}</span>
              </li>
            ))}
            {data.recent.length === 0 && <li className="empty">No activity yet.</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}
