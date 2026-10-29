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
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sourceLabel = (s) => (s === 'default' ? 'built-in defaults' : `AY ${s}`);

function SaveBar({ dirty, busy, msg, children }) {
  return (
    <div className={`save-bar ${dirty ? 'is-dirty' : ''}`} role="status">
      <span className="save-msg">
        {msg ? <span className={msg.tone === 'ok' ? 'text-ok' : 'text-bad'}>{msg.text}</span> : dirty ? 'You have unsaved changes.' : 'All changes saved.'}
      </span>
      <div className="head-actions">{children(busy)}</div>
    </div>
  );
}

function YearRules({ info, setInfo, reloadMeta }) {
  const { meta } = useAuth();
  const thisYear = info.years.find((y) => y.applications > 0 && y.own)?.academic_year || info.years[info.years.length - 2]?.academic_year;
  const [ay, setAy] = useState(thisYear || info.years[0].academic_year);
  const year = info.years.find((y) => y.academic_year === ay) || info.years[0];
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [newYear, setNewYear] = useState('');

  useEffect(() => {
    setDraft({ norms: structuredClone(year.norms), requiredDocs: structuredClone(year.requiredDocs) });
    setMsg(null);
  }, [ay, info]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = useMemo(() => draft && !same(draft, { norms: year.norms, requiredDocs: year.requiredDocs }), [draft, year]);
  if (!draft) return null;
  const cats = Object.entries(meta.CATEGORIES);
  const setNorm = (type, k, v) => setDraft((d) => ({ ...d, norms: { ...d.norms, [type]: { ...d.norms[type], [k]: v } } }));
  const toggleDoc = (cat, doc) =>
    setDraft((d) => {
      const list = d.requiredDocs[cat];
      return { ...d, requiredDocs: { ...d.requiredDocs, [cat]: list.includes(doc) ? list.filter((x) => x !== doc) : [...list, doc] } };
    });
  const run = async (fn, ok) => {
    setBusy(true);
    setMsg(null);
    try {
      setInfo(await fn());
      await reloadMeta();
      setMsg({ tone: 'ok', text: ok });
    } catch (e) {
      setMsg({ tone: 'bad', text: e.message });
    } finally {
      setBusy(false);
    }
  };
  const addYear = () => {
    if (!/^\d{4}-\d{2}$/.test(newYear)) return setMsg({ tone: 'bad', text: 'Enter a year like 2028-29.' });
    if (!info.years.some((y) => y.academic_year === newYear)) setInfo({ ...info, years: [...info.years, { ...year, academic_year: newYear, own: false, applications: 0, updated_at: null }].sort((a, b) => a.academic_year.localeCompare(b.academic_year)) });
    setAy(newYear);
    setNewYear('');
  };

  return (
    <>
      <section className="card">
        <div className="card-head">
          <h2>Norms & documents by academic year</h2>
          <span className="muted small">Each application is checked against the rules for its own academic year.</span>
        </div>
        <div className="year-picker" role="tablist" aria-label="Academic year">
          {info.years.map((y) => (
            <button key={y.academic_year} role="tab" aria-selected={y.academic_year === ay} className={`year-chip ${y.academic_year === ay ? 'active' : ''}`} onClick={() => setAy(y.academic_year)}>
              <span className="year-chip-ay">AY {y.academic_year}</span>
              <span className="year-chip-sub">{y.own ? 'Own rules' : `Uses ${sourceLabel(y.source)}`}{y.applications ? ` · ${y.applications} apps` : ''}</span>
            </button>
          ))}
          <span className="year-add">
            <input id="new-year" className="input input-sm" placeholder="2028-29" value={newYear} onChange={(e) => setNewYear(e.target.value)} aria-label="Add academic year" />
            <button className="btn btn-sm btn-ghost" onClick={addYear}>Add year</button>
          </span>
        </div>
        <p className="year-note">
          {year.own ? (
            <>AY {ay} has its own rules{year.updated_at && <>, last changed {fmtDateTime(year.updated_at)}{year.updated_by ? ` by ${year.updated_by}` : ''}</>}.</>
          ) : (
            <>AY {ay} currently uses the {sourceLabel(year.source)}. Saving creates rules for AY {ay} only; other years stay as they are.</>
          )}{' '}
          {year.applications > 0 ? `${year.applications} application(s) for this year are checked against these rules.` : 'No applications for this year yet.'}
        </p>

        <h3 className="mini-head">Infrastructure & faculty norms</h3>
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

        <h3 className="mini-head">Required documents</h3>
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
                      <input type="checkbox" className="check-box" aria-label={`${label} required for ${catLabel}`} checked={draft.requiredDocs[cat].includes(doc)} onChange={() => toggleDoc(cat, doc)} />
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
      <SaveBar dirty={dirty} busy={busy} msg={msg}>
        {(b) => (
          <>
            {year.own && (
              <button className="btn btn-ghost" disabled={b} onClick={() => run(() => api(`/rules/years/${ay}`, { method: 'DELETE' }), `AY ${ay} now inherits its rules again.`)}>
                Remove AY {ay} rules
              </button>
            )}
            {dirty && <button className="btn btn-ghost" disabled={b} onClick={() => setDraft({ norms: structuredClone(year.norms), requiredDocs: structuredClone(year.requiredDocs) })}>Discard</button>}
            <button className="btn btn-primary" disabled={b || (!dirty && year.own)} onClick={() => run(() => api(`/rules/years/${ay}`, { method: 'PUT', body: draft }), `Rules for AY ${ay} saved.`)}>
              {b ? 'Saving…' : `Save AY ${ay} rules`}
            </button>
          </>
        )}
      </SaveBar>
    </>
  );
}

function GlobalRules({ info, setInfo, reloadMeta }) {
  const { meta } = useAuth();
  const [draft, setDraft] = useState(() => structuredClone(info.global));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  useEffect(() => setDraft(structuredClone(info.global)), [info]);
  const dirty = !same(draft, info.global);
  const isDefault = same(info.global, info.globalDefaults);
  const setSla = (k, v) => setDraft((d) => ({ ...d, sla: { ...d.sla, [k]: v } }));
  const toggleRole = (cat, role) =>
    setDraft((d) => {
      const list = d.assignmentRules[cat];
      return { ...d, assignmentRules: { ...d.assignmentRules, [cat]: list.includes(role) ? list.filter((x) => x !== role) : [...list, role] } };
    });
  const run = async (fn, ok) => {
    setBusy(true);
    setMsg(null);
    try {
      setInfo(await fn());
      await reloadMeta();
      setMsg({ tone: 'ok', text: ok });
    } catch (e) {
      setMsg({ tone: 'bad', text: e.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="rules-top">
        <section className="card">
          <div className="card-head">
            <h2>Deadlines</h2>
            <span className="muted small">Apply to every year</span>
          </div>
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
          <div className="card-head">
            <h2>Assignment roles</h2>
            <span className="muted small">Which designations may be auto-assigned each category</span>
          </div>
          <div className="role-grid">
            {Object.entries(meta.CATEGORIES).map(([cat, label]) => (
              <div key={cat} className="role-card">
                <div className="cell-title">{label}</div>
                {meta.DESIGNATIONS.map((d) => (
                  <label key={d} className="check-row">
                    <input type="checkbox" className="check-box" checked={draft.assignmentRules[cat].includes(d)} onChange={() => toggleRole(cat, d)} />
                    {d}
                  </label>
                ))}
              </div>
            ))}
          </div>
        </section>
      </div>
      <SaveBar dirty={dirty} busy={busy} msg={msg}>
        {(b) => (
          <>
            {!isDefault && <button className="btn btn-ghost" disabled={b} onClick={() => run(() => api('/rules/global/reset', { method: 'POST' }), 'Deadlines and roles reset to defaults.')}>Reset to defaults</button>}
            {dirty && <button className="btn btn-ghost" disabled={b} onClick={() => setDraft(structuredClone(info.global))}>Discard</button>}
            <button className="btn btn-primary" disabled={b || !dirty} onClick={() => run(() => api('/rules/global', { method: 'PUT', body: draft }), 'Deadlines and roles saved.')}>
              {b ? 'Saving…' : 'Save deadlines & roles'}
            </button>
          </>
        )}
      </SaveBar>
    </>
  );
}

export default function Rules() {
  const { reloadMeta } = useAuth();
  const { data, error, loading, setData } = useLoad(() => api('/rules'), []);
  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={error} />;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Rules & norms</h1>
          <p className="sub">
            Norms and required documents are set per academic year, so changing next year's rules never affects applications already in progress. Every change is recorded in the audit trail.
          </p>
        </div>
      </div>
      <YearRules info={data} setInfo={setData} reloadMeta={reloadMeta} />
      <h2 className="section-title">Process settings</h2>
      <GlobalRules info={data} setInfo={setData} reloadMeta={reloadMeta} />
    </div>
  );
}
