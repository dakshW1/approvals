import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../App.jsx';
import { api } from '../api.js';
import { ErrorBox, Loading, fmtDateTime, useLoad } from '../components/ui.jsx';

const SLA_FIELDS = [
  ['reviewDays', 'Officer review window', 'days after submission'],
  ['responseDays', 'Institution response window', 'days after "Action required"'],
  ['reReviewDays', 'Re-review after resubmission', 'days'],
  ['warnDays', 'Deadline warning', 'days before the deadline'],
  ['pickupDays', '"Review not started" alert', 'days after submission'],
  ['expiryWarnDays', 'Certificate expiry warning', 'days before expiry'],
];
const NORM_FIELDS = [
  ['fsr', 'Students / faculty', '1:'],
  ['minLand', 'Min. land', 'acres'],
  ['sqmPerStudent', 'Built-up / student', 'sq.m'],
];

export default function Rules() {
  const { meta, reloadMeta } = useAuth();
  const { data, error, loading, setData } = useLoad(() => api('/rules'), []);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    if (data) setDraft(structuredClone(data.rules));
  }, [data]);

  const dirty = useMemo(() => data && draft && JSON.stringify(draft) !== JSON.stringify(data.rules), [data, draft]);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!draft) return <Loading />;

  const setSla = (k, v) => setDraft((d) => ({ ...d, sla: { ...d.sla, [k]: v } }));
  const setNorm = (type, k, v) => setDraft((d) => ({ ...d, norms: { ...d.norms, [type]: { ...d.norms[type], [k]: v } } }));
  const toggle = (group, cat, value) =>
    setDraft((d) => {
      const list = d[group][cat];
      const next = list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
      return { ...d, [group]: { ...d[group], [cat]: next } };
    });

  const run = async (fn, ok) => {
    setBusy(true);
    setMsg(null);
    try {
      setData(await fn());
      await reloadMeta();
      setMsg({ tone: 'ok', text: ok });
    } catch (e) {
      setMsg({ tone: 'bad', text: e.message });
    } finally {
      setBusy(false);
    }
  };
  const save = () => run(() => api('/rules', { method: 'PUT', body: draft }), 'Rules saved. They apply to every open application from now on.');
  const reset = () => run(() => api('/rules/reset', { method: 'POST' }), 'Rules reset to the built-in defaults.');
  const isDefault = JSON.stringify(data.rules) === JSON.stringify(data.defaults);
  const cats = Object.entries(meta.CATEGORIES);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Rules & norms</h1>
          <p className="sub">
            The norms, deadlines and document lists the system checks every application against. Changes take effect immediately and are recorded in the audit trail.
          </p>
        </div>
        <div className="muted small">
          {data.updated_at ? <>Last changed {fmtDateTime(data.updated_at)} by {data.updated_by || 'an administrator'}</> : 'Using built-in defaults'}
        </div>
      </div>

      <div className="rules-top">
        <section className="card">
          <h2>Deadlines</h2>
          <div className="rule-fields">
            {SLA_FIELDS.map(([k, label, unit]) => (
              <label key={k} className="rule-field">
                <span>
                  <span className="rule-label">{label}</span>
                  <span className="rule-unit">{unit}</span>
                </span>
                <input id={`sla-${k}`} className="input input-num" type="number" min="0" value={draft.sla[k]} onChange={(e) => setSla(k, e.target.value)} />
              </label>
            ))}
          </div>
        </section>

        <section className="card">
          <h2>Infrastructure & faculty norms</h2>
          <div className="table-wrap">
            <table className="table table-compact table-cards">
              <thead>
                <tr>
                  <th>Institution type</th>
                  {NORM_FIELDS.map(([k, label]) => <th key={k}>{label}</th>)}
                </tr>
              </thead>
              <tbody>
                {Object.keys(draft.norms).map((type) => (
                  <tr key={type}>
                    <td data-label="Type"><strong>{type}</strong></td>
                    {NORM_FIELDS.map(([k, label, unit]) => (
                      <td key={k} data-label={label}>
                        <span className="rule-input">
                          {unit === '1:' && <span className="muted small">1:</span>}
                          <input
                            id={`norm-${type}-${k}`}
                            className="input input-num"
                            type="number"
                            min="0"
                            step={k === 'fsr' ? 1 : 0.1}
                            value={draft.norms[type][k]}
                            onChange={(e) => setNorm(type, k, e.target.value)}
                          />
                          {unit !== '1:' && <span className="muted small">{unit}</span>}
                        </span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Required documents</h2>
          <span className="muted small">Tick the documents each application category must upload.</span>
        </div>
        <div className="table-wrap">
          <table className="table table-compact matrix">
            <thead>
              <tr>
                <th>Document</th>
                {cats.map(([k, v]) => <th key={k} className="matrix-col">{v}</th>)}
              </tr>
            </thead>
            <tbody>
              {Object.entries(meta.DOC_TYPES).map(([doc, label]) => (
                <tr key={doc}>
                  <td>
                    {label}
                    {meta.EXPIRING_DOC_TYPES.includes(doc) && <span className="tag">Dated</span>}
                  </td>
                  {cats.map(([cat, catLabel]) => (
                    <td key={cat} className="matrix-col">
                      <input
                        type="checkbox"
                        className="check-box"
                        aria-label={`${label} required for ${catLabel}`}
                        checked={draft.requiredDocs[cat].includes(doc)}
                        onChange={() => toggle('requiredDocs', cat, doc)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="matrix-total">
                <td>Total required</td>
                {cats.map(([cat]) => <td key={cat} className="matrix-col">{draft.requiredDocs[cat].length}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Assignment roles</h2>
          <span className="muted small">Which officer designations may be auto-assigned each category.</span>
        </div>
        <div className="role-grid">
          {cats.map(([cat, label]) => (
            <div key={cat} className="role-card">
              <div className="cell-title">{label}</div>
              {meta.DESIGNATIONS.map((d) => (
                <label key={d} className="check-row">
                  <input type="checkbox" className="check-box" checked={draft.assignmentRules[cat].includes(d)} onChange={() => toggle('assignmentRules', cat, d)} />
                  {d}
                </label>
              ))}
            </div>
          ))}
        </div>
      </section>

      <div className={`save-bar ${dirty ? 'is-dirty' : ''}`} role="status">
        <span className="save-msg">
          {msg ? <span className={msg.tone === 'ok' ? 'text-ok' : 'text-bad'}>{msg.text}</span> : dirty ? 'You have unsaved changes.' : 'All changes saved.'}
        </span>
        <div className="head-actions">
          {!isDefault && <button className="btn btn-ghost" disabled={busy} onClick={reset}>Reset to defaults</button>}
          {dirty && <button className="btn btn-ghost" disabled={busy} onClick={() => setDraft(structuredClone(data.rules))}>Discard</button>}
          <button className="btn btn-primary" disabled={busy || !dirty} onClick={save}>{busy ? 'Saving…' : 'Save changes'}</button>
        </div>
      </div>
    </div>
  );
}
