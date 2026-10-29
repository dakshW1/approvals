import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../App.jsx';
import { api, fileUrl } from '../api.js';
import {
  CheckList, DueChip, ErrorBox, Icon, Loading, ScoreRing, StatusBadge, ROLE_LABEL, fmtDate, fmtDateTime, useLoad,
} from '../components/ui.jsx';
import { deficiencies, downloadDeficiencyLetter } from '../letter.js';
import Inspection from '../components/Inspection.jsx';

function LetterButton({ data }) {
  const { meta } = useAuth();
  const [busy, setBusy] = useState(false);
  const count = deficiencies(data).length;
  if (data.app.status === 'APPROVED' || count === 0) return null;
  const download = async () => {
    setBusy(true);
    try {
      await downloadDeficiencyLetter(data, meta.SLA);
      api(`/applications/${data.app.id}/letter`, { method: 'POST' }).catch(() => {});
    } finally {
      setBusy(false);
    }
  };
  return (
    <button className="btn btn-sm btn-ghost" onClick={download} disabled={busy} title={`${count} deficiencies`}>
      <Icon name="file" size={16} /> {busy ? 'Preparing…' : 'Deficiency letter'}
    </button>
  );
}

const DOC_STATUS = {
  VERIFIED: { label: 'Verified', tone: 'ok' },
  REJECTED: { label: 'Rejected', tone: 'bad' },
  PENDING: { label: 'Awaiting review', tone: 'neutral' },
};

function Stepper({ app, history }) {
  const hadAction = history.some((h) => h.to_status === 'ACTION_REQUIRED');
  const reached = new Set(history.map((h) => h.to_status));
  const final = app.status === 'APPROVED' || app.status === 'REJECTED';
  const steps = [
    ...(app.status === 'DRAFT' ? [{ key: 'DRAFT', label: 'Draft' }] : []),
    { key: 'SUBMITTED', label: 'Submitted' },
    { key: 'UNDER_REVIEW', label: 'Under Review' },
    ...(hadAction || app.status === 'ACTION_REQUIRED' ? [{ key: 'ACTION_REQUIRED', label: 'Action Required' }] : []),
    { key: 'DECISION', label: final ? (app.status === 'APPROVED' ? 'Approved' : 'Rejected') : 'Decision' },
  ];
  return (
    <ol className="stepper">
      {steps.map((s) => {
        const current = s.key === app.status || (s.key === 'DECISION' && final);
        const done = !current && (reached.has(s.key) || (s.key === 'DECISION' && final));
        const tone = s.key === 'DECISION' && final ? (app.status === 'APPROVED' ? 'ok' : 'bad') : s.key === 'ACTION_REQUIRED' && current ? 'warn' : '';
        return (
          <li key={s.key} className={`step ${done ? 'done' : ''} ${current ? 'current' : ''} ${tone ? `step-${tone}` : ''}`}>
            <span className="step-dot" />
            <span className="step-label">{s.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function DocumentRow({ item, perms, onChanged, appId }) {
  const [expiry, setExpiry] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [remark, setRemark] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);
  const d = item.doc;
  const canUploadThis = perms.canUpload || (perms.canRenew && item.expiring);

  const run = async (fn) => {
    setBusy(true);
    setError('');
    try {
      onChanged(await fn());
      setRejecting(false);
      setRemark('');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const upload = (file) => {
    if (!file) return;
    if (item.expiring && !expiry) {
      setError('Enter the valid-until date first.');
      fileRef.current.value = '';
      return;
    }
    const form = new FormData();
    form.append('doc_type', item.type);
    form.append('file', file);
    if (expiry) form.append('expiry_date', expiry);
    run(() => api(`/applications/${appId}/documents`, { method: 'POST', form })).finally(() => {
      if (fileRef.current) fileRef.current.value = '';
    });
  };
  const review = (decision) =>
    run(() => api(`/documents/${d.id}/review`, { method: 'POST', body: { decision, remark } }));

  const expiryDays = d?.expiry_date ? Math.floor((new Date(d.expiry_date) - Date.now()) / 86400000) : null;

  return (
    <li className={`doc ${!d ? 'doc-missing' : ''}`}>
      <div className="doc-main">
        <div className="doc-title">
          {item.label}
          {item.expiring && <span className="tag">Dated certificate</span>}
        </div>
        {d ? (
          <div className="doc-meta">
            <a href={fileUrl(`/documents/${d.id}/file`)} target="_blank" rel="noreferrer" className="link mono">{d.original_name}</a>
            <span>· uploaded {fmtDate(d.uploaded_at)}</span>
            {d.expiry_date && (
              <span className={expiryDays < 0 ? 'text-bad' : expiryDays <= 30 ? 'text-warn' : ''}>
                · valid until {fmtDate(d.expiry_date)}
                {expiryDays < 0 ? ' (expired)' : expiryDays <= 30 ? ` (${expiryDays} days left)` : ''}
              </span>
            )}
          </div>
        ) : (
          <div className="doc-meta text-bad">Not uploaded</div>
        )}
        {d?.remark && <div className="doc-remark">Officer remark: {d.remark}</div>}
        {error && <div className="doc-error">{error}</div>}
      </div>
      <div className="doc-side">
        {d && <span className={`pill pill-${DOC_STATUS[d.status].tone}`}>{DOC_STATUS[d.status].label}</span>}
        {!d && <span className="pill pill-bad">Missing</span>}
        <div className="doc-actions">
          {canUploadThis && (
            <>
              {item.expiring && (
                <input
                  id={`expiry-${item.type}`}
                  type="date"
                  className="input input-sm"
                  value={expiry}
                  onChange={(e) => setExpiry(e.target.value)}
                  aria-label="Valid until"
                  title="Valid until"
                />
              )}
              <input ref={fileRef} type="file" accept=".pdf,.png,.jpg,.jpeg" hidden onChange={(e) => upload(e.target.files[0])} />
              <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => fileRef.current.click()}>
                {busy ? 'Uploading…' : d ? 'Replace' : 'Upload'}
              </button>
            </>
          )}
          {perms.canVerify && d && !rejecting && (
            <>
              {d.status !== 'VERIFIED' && (
                <button className="btn btn-sm btn-ok" disabled={busy} onClick={() => review('VERIFIED')}>Verify</button>
              )}
              {d.status !== 'REJECTED' && (
                <button className="btn btn-sm btn-danger-ghost" disabled={busy} onClick={() => setRejecting(true)}>Reject</button>
              )}
            </>
          )}
        </div>
        {rejecting && (
          <div className="reject-box">
            <input
              id={`reject-${item.type}`}
              className="input input-sm"
              placeholder="Reason for rejection"
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              autoFocus
            />
            <button className="btn btn-sm btn-danger" disabled={busy || !remark.trim()} onClick={() => review('REJECTED')}>Reject</button>
            <button className="btn btn-sm btn-ghost" onClick={() => setRejecting(false)}>Cancel</button>
          </div>
        )}
      </div>
    </li>
  );
}

function ActionPanel({ data, onChanged }) {
  const [remark, setRemark] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmException, setConfirmException] = useState(false);
  const { app, actions, approval } = data;
  if (!actions.length) return null;
  // Unmet checks the officer would be waiving by approving now.
  const blocking = approval?.blocking || [];
  const needsException = blocking.length > 0;

  const act = async (a) => {
    const isException = a.to === 'APPROVED' && needsException;
    if (a.needsRemark && !remark.trim()) {
      setError(`Add a remark before choosing "${a.label}".`);
      return;
    }
    if (isException) {
      if (!approval.overridable) {
        setError(`${approval.hardReason} must be completed before approval, even with an exception.`);
        return;
      }
      if (remark.trim().length < approval.minReason) {
        setError(`Explain why the unmet checks are being waived (at least ${approval.minReason} characters).`);
        return;
      }
      if (!confirmException) {
        setError('Tick the confirmation box to approve with an exception.');
        return;
      }
    }
    setBusy(true);
    setError('');
    try {
      onChanged(await api(`/applications/${app.id}/status`, { method: 'POST', body: { to: a.to, remark, override: isException } }));
      setRemark('');
      setConfirmException(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const hint =
    app.status === 'DRAFT'
      ? 'This draft is visible only to your institution. Submit it when the details are complete; missing documents can still be added later.'
      : app.status === 'SUBMITTED'
        ? 'Start the review to verify documents and record a decision.'
        : app.status === 'ACTION_REQUIRED'
          ? 'Fix the issues listed by the officer, upload any missing documents, then resubmit.'
          : needsException
            ? 'Some checks are not met. Request action from the institution, reject, or approve with a recorded exception.'
            : 'Every compliance check passes. You can approve, or request action or reject with a clear remark.';

  return (
    <section className="card action-card">
      <h2>Take action</h2>
      <p className="muted small">{hint}</p>
      {app.status === 'UNDER_REVIEW' && needsException && (
        <div className="exception-box">
          <div className="exception-title">Not yet met</div>
          <ul>
            {blocking.map((b) => (
              <li key={b.key}><strong>{b.label}</strong> · {b.detail}</li>
            ))}
          </ul>
          {approval.overridable ? (
            <label className="check-row small">
              <input type="checkbox" className="check-box" checked={confirmException} onChange={(e) => setConfirmException(e.target.checked)} />
              I am approving despite these checks. My reason below will be recorded and the administrator will be alerted.
            </label>
          ) : (
            <p className="small text-bad">{approval.hardReason} must be completed before this can be approved, even with an exception.</p>
          )}
        </div>
      )}
      <textarea
        id="action-remark"
        className="input"
        rows={3}
        placeholder={
          app.status === 'ACTION_REQUIRED'
            ? 'Describe what you fixed'
            : needsException
              ? 'Remark for the institution, or the reason for approving with an exception'
              : 'Remark for the institution (required to request action or reject)'
        }
        value={remark}
        onChange={(e) => setRemark(e.target.value)}
      />
      {error && <div className="alert alert-bad">{error}</div>}
      <div className="action-buttons">
        {actions.map((a) => (
          <button
            key={a.to}
            className={`btn btn-${a.to === 'APPROVED' && needsException ? 'warn' : a.variant}`}
            disabled={busy || (a.to === 'APPROVED' && needsException && !approval.overridable)}
            onClick={() => act(a)}
          >
            {a.to === 'APPROVED' && needsException ? 'Approve with exception' : a.label}
          </button>
        ))}
      </div>
    </section>
  );
}

function Messages({ data, onChanged }) {
  const { user } = useAuth();
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef(null);
  const { app, comments } = data;

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [comments.length]);

  if (app.is_draft) return null;
  const send = async (e) => {
    e?.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError('');
    try {
      const r = await api(`/applications/${app.id}/comments`, { method: 'POST', body: { body: text } });
      onChanged({ ...data, comments: r.comments });
      setText('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const other = user.role === 'COLLEGE' ? 'the scrutiny officer' : 'the institution';

  return (
    <section className="card">
      <div className="card-head">
        <h2>Messages</h2>
        <span className="muted small">{comments.length ? `${comments.length} message${comments.length > 1 ? 's' : ''}` : 'No messages yet'}</span>
      </div>
      {comments.length > 0 && (
        <ol className="thread" ref={listRef}>
          {comments.map((c) => {
            const mine = c.user_id === user.id;
            return (
              <li key={c.id} className={`bubble ${mine ? 'mine' : ''}`}>
                <div className="bubble-meta">
                  {mine ? 'You' : c.user_role === 'COLLEGE' ? 'Institution' : c.user_name || 'AICTE'}
                  {!mine && c.user_role && c.user_role !== 'COLLEGE' && <span> · {ROLE_LABEL[c.user_role]}</span>}
                  <span> · {fmtDateTime(c.created_at)}</span>
                </div>
                <div className="bubble-body">{c.body}</div>
              </li>
            );
          })}
        </ol>
      )}
      <form className="composer" onSubmit={send}>
        <textarea
          id="message-text"
          className="input"
          rows={2}
          placeholder={`Ask or answer ${other}… (Ctrl+Enter to send)`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => (e.ctrlKey || e.metaKey) && e.key === 'Enter' && send()}
          maxLength={2000}
        />
        <button className="btn btn-primary btn-sm" disabled={busy || !text.trim()}>{busy ? 'Sending…' : 'Send'}</button>
      </form>
      {error && <div className="alert alert-bad">{error}</div>}
    </section>
  );
}

function Reassign({ data, onChanged }) {
  const [officer, setOfficer] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (body) => {
    setBusy(true);
    setError('');
    try {
      onChanged(await api(`/applications/${data.app.id}/assign`, { method: 'POST', body }));
      setOfficer('');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="reassign">
      <select id="reassign-officer" className="input input-sm" value={officer} onChange={(e) => setOfficer(e.target.value)}>
        <option value="">Choose officer…</option>
        {data.officers
          .filter((o) => o.id !== data.app.assigned_officer_id)
          .map((o) => (
            <option key={o.id} value={o.id}>
              {o.name} ({o.region}, {o.open_load}/{o.max_load})
            </option>
          ))}
      </select>
      <button className="btn btn-sm btn-ghost" disabled={busy || !officer} onClick={() => run({ officer_id: Number(officer) })}>Reassign</button>
      <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => run({})}>Auto-reassign</button>
      {error && <div className="alert alert-bad">{error}</div>}
    </div>
  );
}

export default function ApplicationDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const { data, error, loading, setData } = useLoad(() => api(`/applications/${id}`), [id]);
  const [tab, setTab] = useState('timeline');
  useEffect(() => {
    const onLive = (e) => {
      if (String(e.detail?.application_id) === String(id)) api(`/applications/${id}`).then(setData).catch(() => {});
    };
    window.addEventListener('portal:notification', onLive);
    return () => window.removeEventListener('portal:notification', onLive);
  }, [id]);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  const { app, institution, documents, history, activity, permissions } = data;
  const c = app.compliance;
  const missing = documents.filter((d) => !d.doc).length;

  return (
    <div className="page">
      <Link to="/applications" className="back">← Applications</Link>
      <div className="detail-head card">
        <div className="detail-title">
          <div className="mono detail-no">{app.app_no}</div>
          <h1>{app.program}</h1>
          <div className="detail-sub">
            {institution.name} · {institution.city}, {institution.state} · {app.category_label} · AY {app.academic_year}
          </div>
        </div>
        <div className="detail-status">
          <StatusBadge status={app.status} />
          <DueChip app={app} />
          {app.pending_with && <span className="muted small">Pending with {app.pending_with.toLowerCase()}</span>}
          <div className="head-actions">
            {permissions.canEdit && (
              <Link to={`/applications/${app.id}/edit`} className="btn btn-sm btn-ghost">Edit details</Link>
            )}
            {!app.is_draft && <LetterButton data={data} />}
          </div>
        </div>
        <Stepper app={app} history={history} />
      </div>

      {app.override_note && (
        <div className="alert alert-warn exception-note">
          <strong>Approved with an exception.</strong> Waived: {app.override_checks}
          <div className="small">Reason recorded by {app.officer_name || 'the officer'}: "{app.override_note}"</div>
        </div>
      )}

      {app.is_draft && (
        <div className="alert alert-warn">
          <strong>Draft, not yet submitted.</strong> Only your institution can see it. Fill in the remaining details, then choose "Submit application".
        </div>
      )}

      {user.role === 'COLLEGE' && app.status === 'ACTION_REQUIRED' && (
        <div className="alert alert-warn">
          <strong>AICTE has requested action.</strong> {history.filter((h) => h.to_status === 'ACTION_REQUIRED').at(-1)?.remark} Respond
          by {fmtDate(app.due_date)}.
        </div>
      )}

      <div className="detail-grid">
        <div className="col">
          <section className="card">
            <div className="card-head">
              <h2>Compliance check</h2>
              <span className="muted small">
                {c.passed} passed · {c.warned} warnings · {c.failed} failed · AY {app.academic_year} rules
                {data.rules_source !== app.academic_year && <> (from {data.rules_source === 'default' ? 'defaults' : `AY ${data.rules_source}`})</>}
              </span>
            </div>
            <div className="compliance">
              <ScoreRing score={c.score} />
              <CheckList checks={c.checks} />
            </div>
            {app.deadline && (
              <div className={`deadline-row deadline-${app.deadline.status}`}>
                <span>
                  <strong>Processing deadline</strong> · {app.deadline.detail} · with the {app.deadline.owner.toLowerCase()}
                </span>
                <span className="muted small">Tracked separately, not part of the score</span>
              </div>
            )}
          </section>

          <section className="card">
            <div className="card-head">
              <h2>Documents</h2>
              <span className={`small ${missing ? 'text-bad' : 'muted'}`}>
                {documents.length - missing} of {documents.length} uploaded{missing ? ` · ${missing} missing` : ''}
              </span>
            </div>
            {permissions.canVerify === false && (user.role === 'OFFICER' || user.role === 'ADMIN') && app.status === 'SUBMITTED' && (
              <p className="muted small">Start the review to verify or reject documents.</p>
            )}
            <ul className="docs">
              {documents.map((item) => (
                <DocumentRow key={item.type} item={item} perms={permissions} onChanged={setData} appId={app.id} />
              ))}
            </ul>
          </section>

          <Inspection data={data} onChanged={setData} />

          <section className="card">
            <h2>Application details</h2>
            <dl className="facts">
              <div><dt>Institution type</dt><dd>{institution.type}</dd></div>
              <div><dt>AICTE ID</dt><dd className="mono">{institution.aicte_code}</dd></div>
              <div><dt>Region</dt><dd>{institution.region}</dd></div>
              <div><dt>Program duration</dt><dd>{app.duration_years} years</dd></div>
              <div><dt>Proposed intake</dt><dd>{app.proposed_intake} per year</dd></div>
              <div><dt>Faculty declared</dt><dd>{app.faculty_count} (needs {c.facultyNeeded})</dd></div>
              <div><dt>Land area</dt><dd>{app.land_area} acres</dd></div>
              <div><dt>Built-up area</dt><dd>{Number(app.built_up_area).toLocaleString('en-IN')} sq.m</dd></div>
              <div><dt>Submitted</dt><dd>{fmtDateTime(app.submitted_at)}</dd></div>
              <div><dt>{app.is_open ? 'Current deadline' : 'Decided'}</dt><dd>{app.is_open ? fmtDate(app.due_date) : fmtDate(app.decided_at)}</dd></div>
            </dl>
          </section>
        </div>

        <div className="col">
          <ActionPanel data={data} onChanged={setData} />

          <Messages data={data} onChanged={setData} />

          <section className="card">
            <h2>Assigned officer</h2>
            {app.officer_name ? (
              <div className="officer">
                <div className="avatar">{app.officer_name.replace(/^Dr\.\s*/, '').charAt(0)}</div>
                <div>
                  <div className="cell-title">{app.officer_name}</div>
                  <div className="cell-sub">{app.officer_designation}</div>
                </div>
              </div>
            ) : (
              <div className="text-bad">Not assigned</div>
            )}
            {data.assignment_reason && user.role !== 'COLLEGE' && <p className="reason">{data.assignment_reason}</p>}
            {permissions.canReassign && <Reassign data={data} onChanged={setData} />}
          </section>

          <section className="card">
            <div className="tabs" role="tablist">
              <button role="tab" aria-selected={tab === 'timeline'} className={tab === 'timeline' ? 'active' : ''} onClick={() => setTab('timeline')}>Status history</button>
              <button role="tab" aria-selected={tab === 'audit'} className={tab === 'audit' ? 'active' : ''} onClick={() => setTab('audit')}>Audit trail ({activity.length})</button>
            </div>
            {tab === 'timeline' ? (
              <ol className="timeline">
                {[...history].reverse().map((h) => (
                  <li key={h.id}>
                    <span className={`tl-dot tl-${h.to_status}`} />
                    <div>
                      <div className="tl-head">
                        <StatusBadge status={h.to_status} />
                        <span className="muted small">{fmtDateTime(h.created_at)}</span>
                      </div>
                      <div className="small">
                        {h.user_name || 'System'}
                        {h.user_role && <span className="muted"> · {ROLE_LABEL[h.user_role]}</span>}
                      </div>
                      {h.remark && <div className="tl-remark">{h.remark}</div>}
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <ul className="audit-list">
                {activity.map((a) => (
                  <li key={a.id}>
                    <div className="audit-top">
                      <span className="mono audit-action">{a.action}</span>
                      <span className="muted small">{fmtDateTime(a.created_at)}</span>
                    </div>
                    <div className="small">{a.user_name || 'System (automated)'}</div>
                    {a.details && <div className="muted small">{a.details}</div>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
