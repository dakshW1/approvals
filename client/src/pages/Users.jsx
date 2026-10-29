import { useState } from 'react';
import { useAuth } from '../App.jsx';
import { api } from '../api.js';
import { ErrorBox, Icon, Loading, Modal, fmtDate, useLoad } from '../components/ui.jsx';

const EMPTY_OFFICER = { role: 'OFFICER', name: '', email: '', designation: 'Assistant Director', region: 'North', categories: [], max_load: 8 };

function LoginStatus({ u }) {
  if (u.suspended) return <span className="pill pill-bad">Suspended</span>;
  if (u.has_login) return <span className="pill pill-ok">Can sign in</span>;
  return <span className="pill pill-neutral">No login</span>;
}

function OfficerForm({ initial, options, isNew, onClose, onSaved }) {
  const [f, setF] = useState(initial);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const toggleCat = (c) => setF((x) => ({ ...x, categories: x.categories.includes(c) ? x.categories.filter((y) => y !== c) : [...x.categories, c] }));
  const isAdmin = f.role === 'ADMIN';

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = { ...f, max_load: Number(f.max_load) };
      const result = isNew ? await api('/users', { method: 'POST', body }) : await api(`/users/${f.id}`, { method: 'PATCH', body });
      onSaved(result, isNew ? `${f.name} added. ${result.emailed ? 'They have been emailed a code to set their password.' : ''}` : `${f.name} updated.`);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={isNew ? (isAdmin ? 'Add administrator' : 'Add officer') : `Edit ${initial.name}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" form="officer-form" disabled={busy}>{busy ? 'Saving…' : isNew ? 'Add and send invite' : 'Save changes'}</button>
        </>
      }
    >
      <form id="officer-form" className="form-grid" onSubmit={submit}>
        <label className="field span-2">
          <span>Full name</span>
          <input id="u-name" className="input" value={f.name} onChange={set('name')} required />
        </label>
        <label className="field span-2">
          <span>Email {!isNew && f.has_login && <span className="muted">(their login, cannot change)</span>}</span>
          <input id="u-email" className="input" type="email" value={f.email} onChange={set('email')} disabled={!isNew && f.has_login} required />
        </label>
        {!isAdmin && (
          <>
            <label className="field">
              <span>Designation</span>
              <select id="u-designation" className="input" value={f.designation} onChange={set('designation')}>
                {options.designations.map((d) => <option key={d}>{d}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Region</span>
              <select id="u-region" className="input" value={f.region} onChange={set('region')}>
                {options.regions.map((r) => <option key={r}>{r}</option>)}
              </select>
            </label>
            <div className="field span-2">
              <span>Handles these categories</span>
              <div className="chip-picks">
                {Object.entries(options.categories).map(([k, v]) => (
                  <button type="button" key={k} className={`chip-pick ${f.categories.includes(k) ? 'on' : ''}`} onClick={() => toggleCat(k)} aria-pressed={f.categories.includes(k)}>
                    {v}
                  </button>
                ))}
              </div>
            </div>
            <label className="field">
              <span>Maximum open applications</span>
              <input id="u-load" className="input" type="number" min="1" max="50" value={f.max_load} onChange={set('max_load')} required />
            </label>
          </>
        )}
        {isNew && (
          <p className="muted small span-2">
            They'll get an email with a code. On the sign-in page they choose "Forgot password?", enter this email and the code, and set their own password.
          </p>
        )}
        {error && <div className="alert alert-bad span-2">{error}</div>}
      </form>
    </Modal>
  );
}

export default function Users() {
  const { user, meta } = useAuth();
  const { data, error, loading, setData } = useLoad(() => api('/users'), []);
  const [tab, setTab] = useState('officers');
  const [editing, setEditing] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busyId, setBusyId] = useState(null);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  const act = async (id, fn, ok) => {
    setBusyId(id);
    setNotice(null);
    try {
      setData(await fn());
      if (ok) setNotice({ tone: 'ok', text: ok });
    } catch (e) {
      setNotice({ tone: 'bad', text: e.message });
    } finally {
      setBusyId(null);
    }
  };
  const suspend = (u, suspended) =>
    act(u.id, () => api(`/users/${u.id}/suspend`, { method: 'POST', body: { suspended } }), `${u.name} ${suspended ? 'suspended' : 'restored'}.`);
  const enableLogin = (u) => act(u.id, () => api(`/users/${u.id}/login`, { method: 'POST' }), `${u.name} can now sign in. They've been emailed a code to set a password.`);
  const toggleAssign = (u) => act(u.id, () => api(`/officers/${u.id}/toggle`, { method: 'POST' }).then(() => api('/users')));

  const tabs = [
    ['officers', `Officers (${data.officers.length})`],
    ['institutions', `Institutions (${data.institutions.length})`],
    ['admins', `Administrators (${data.admins.length})`],
  ];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Users & officers</h1>
          <p className="sub">Add officers, adjust who handles what, and control who can sign in.</p>
        </div>
        <div className="head-actions">
          {tab === 'admins' ? (
            <button className="btn btn-primary" onClick={() => setEditing({ isNew: true, value: { ...EMPTY_OFFICER, role: 'ADMIN' } })}><Icon name="plus" size={17} /> Add administrator</button>
          ) : (
            <button className="btn btn-primary" onClick={() => setEditing({ isNew: true, value: EMPTY_OFFICER })}><Icon name="plus" size={17} /> Add officer</button>
          )}
        </div>
      </div>

      {!meta.EMAIL_ENABLED && (
        <div className="alert alert-warn">
          Portal emails are off (no SMTP settings), so new users only receive Supabase's password-code email. Add SMTP settings to send welcome and alert emails too.
        </div>
      )}
      {notice && <div className={`alert ${notice.tone === 'ok' ? 'alert-ok' : 'alert-bad'}`}>{notice.text}</div>}

      <div className="tabs" role="tablist">
        {tabs.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      {tab === 'officers' && (
        <section className="card card-flush">
          <div className="table-wrap">
            <table className="table table-cards">
              <thead>
                <tr>
                  <th>Officer</th>
                  <th>Region</th>
                  <th>Handles</th>
                  <th>Workload</th>
                  <th>Access</th>
                  <th>Auto-assign</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.officers.map((o) => (
                  <tr key={o.id} className={o.active && !o.suspended ? '' : 'row-muted'}>
                    <td data-label="Officer">
                      <div className="cell-title">{o.name}</div>
                      <div className="cell-sub">{o.designation} · {o.email}</div>
                    </td>
                    <td data-label="Region">{o.region}</td>
                    <td data-label="Handles">
                      <div className="tag-row">
                        {o.categories.map((c) => <span key={c} className="tag">{meta.CATEGORIES[c]}</span>)}
                      </div>
                    </td>
                    <td data-label="Workload">
                      <div className="load">
                        <div className="load-track">
                          <div className={`load-fill ${o.open_load / o.max_load > 0.75 ? 'bg-warn' : 'bg-brand'}`} style={{ width: `${Math.min(100, (o.open_load / o.max_load) * 100)}%` }} />
                        </div>
                        <span className="small">{o.open_load}/{o.max_load}</span>
                        {o.overdue > 0 && <span className="chip chip-bad">{o.overdue} overdue</span>}
                      </div>
                    </td>
                    <td data-label="Access"><LoginStatus u={o} /></td>
                    <td data-label="Auto-assign">
                      <button className={`switch ${o.active ? 'on' : ''}`} role="switch" aria-checked={!!o.active} disabled={busyId === o.id} onClick={() => toggleAssign(o)}>
                        <span className="switch-knob" />
                        <span className="switch-text">{o.active ? 'On' : 'Paused'}</span>
                      </button>
                    </td>
                    <td className="row-actions">
                      <button className="btn btn-sm btn-ghost" onClick={() => setEditing({ isNew: false, value: { ...o, role: 'OFFICER' } })}>Edit</button>
                      {!o.has_login && !o.suspended && <button className="btn btn-sm btn-ghost" disabled={busyId === o.id} onClick={() => enableLogin(o)}>Give login</button>}
                      <button className={`btn btn-sm ${o.suspended ? 'btn-ghost' : 'btn-danger-ghost'}`} disabled={busyId === o.id} onClick={() => suspend(o, !o.suspended)}>
                        {o.suspended ? 'Restore' : 'Suspend'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === 'institutions' && (
        <section className="card card-flush">
          <div className="table-wrap">
            <table className="table table-cards">
              <thead>
                <tr>
                  <th>Institution</th>
                  <th>Type</th>
                  <th>Principal</th>
                  <th>Applications</th>
                  <th>Access</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.institutions.map((i) => (
                  <tr key={i.id} className={i.suspended ? 'row-muted' : ''}>
                    <td data-label="Institution">
                      <div className="cell-title">{i.institution_name}</div>
                      <div className="cell-sub">{[i.city, i.state].filter(Boolean).join(', ')} · {i.region} · <span className="mono">{i.aicte_code}</span></div>
                    </td>
                    <td data-label="Type">{i.type}</td>
                    <td data-label="Principal">
                      <div>{i.name.replace(/^Principal, .*/, 'Principal')}</div>
                      <div className="cell-sub">{i.email}</div>
                    </td>
                    <td data-label="Applications">{i.applications} <span className="muted">({i.open_applications} open)</span></td>
                    <td data-label="Access">
                      <LoginStatus u={i} />
                      {i.has_login && i.created_at && <div className="cell-sub">Joined {fmtDate(i.created_at)}</div>}
                    </td>
                    <td className="row-actions">
                      <button className={`btn btn-sm ${i.suspended ? 'btn-ghost' : 'btn-danger-ghost'}`} disabled={busyId === i.id} onClick={() => suspend(i, !i.suspended)}>
                        {i.suspended ? 'Restore' : 'Suspend'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === 'admins' && (
        <section className="card card-flush">
          <div className="table-wrap">
            <table className="table table-cards">
              <thead>
                <tr>
                  <th>Administrator</th>
                  <th>Access</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.admins.map((a) => (
                  <tr key={a.id}>
                    <td data-label="Administrator">
                      <div className="cell-title">{a.name}{a.id === user.id && <span className="tag">You</span>}</div>
                      <div className="cell-sub">{a.email}</div>
                    </td>
                    <td data-label="Access"><LoginStatus u={a} /></td>
                    <td className="row-actions">
                      {a.id !== user.id && (
                        <button className={`btn btn-sm ${a.suspended ? 'btn-ghost' : 'btn-danger-ghost'}`} disabled={busyId === a.id} onClick={() => suspend(a, !a.suspended)}>
                          {a.suspended ? 'Restore' : 'Suspend'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {editing && (
        <OfficerForm
          initial={{ ...editing.value, categories: [...(editing.value.categories || [])] }}
          options={data.options}
          isNew={editing.isNew}
          onClose={() => setEditing(null)}
          onSaved={(result, text) => {
            setData(result);
            setEditing(null);
            setNotice({ tone: 'ok', text });
          }}
        />
      )}
    </div>
  );
}
