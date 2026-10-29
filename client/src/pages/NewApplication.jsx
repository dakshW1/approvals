import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../App.jsx';
import { api } from '../api.js';
import { CheckList, ErrorBox, Loading, ScoreRing } from '../components/ui.jsx';

const DEFAULTS = {
  category: 'NEW_COURSE',
  program: '',
  academic_year: '2027-28',
  duration_years: 4,
  proposed_intake: 60,
  faculty_count: 12,
  land_area: '',
  built_up_area: '',
};
const FIELDS = Object.keys(DEFAULTS);

// One form for three jobs: a new application, editing a draft, and correcting a submitted one.
export default function NewApplication() {
  const { id } = useParams();
  const editing = Boolean(id);
  const { user, meta } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState(DEFAULTS);
  const [existing, setExisting] = useState(null);
  const [files, setFiles] = useState({});
  const [expiries, setExpiries] = useState({});
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState(null);
  const [busy, setBusy] = useState(null);
  const required = meta.REQUIRED_DOCS[form.category];
  const norm = meta.NORMS[user.institution?.type] || meta.NORMS.Engineering;
  const isDraft = !editing || existing?.app.status === 'DRAFT';

  useEffect(() => {
    if (!editing) return;
    api(`/applications/${id}`)
      .then((d) => {
        setExisting(d);
        const a = d.app;
        // Empty draft fields are stored as 0 / "Untitled draft"; show them as blank inputs again.
        const blank = (k) => a[k] === 'Untitled draft' || (a.status === 'DRAFT' && a[k] === 0);
        setForm(Object.fromEntries(FIELDS.map((k) => [k, blank(k) ? '' : a[k]])));
      })
      .catch(setLoadError);
  }, [editing, id]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Live readiness check against the same rules officers see. When editing, count documents already on file.
  useEffect(() => {
    const onFile = existing ? existing.app.docs.map((d) => d.doc_type) : [];
    const t = setTimeout(() => {
      api('/compliance/preview', {
        method: 'POST',
        body: { ...form, docs: [...new Set([...onFile, ...required.filter((d) => files[d])])], expiries },
      })
        .then(setPreview)
        .catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [form, files, expiries, required, existing]);

  const save = async (kind) => {
    setError('');
    for (const t of required)
      if (files[t] && meta.EXPIRING_DOC_TYPES.includes(t) && !expiries[t]) {
        setError(`Enter the valid-until date for ${meta.DOC_TYPES[t]}.`);
        return;
      }
    setBusy(kind);
    try {
      if (editing) {
        await api(`/applications/${id}`, { method: 'PATCH', body: form });
        if (kind === 'submit') await api(`/applications/${id}/status`, { method: 'POST', body: { to: 'SUBMITTED' } });
        navigate(`/applications/${id}`);
        return;
      }
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v));
      if (kind === 'draft') fd.append('draft', '1');
      for (const t of required) {
        if (files[t]) fd.append(`doc_${t}`, files[t]);
        if (expiries[t]) fd.append(`expiry_${t}`, expiries[t]);
      }
      const { id: newId } = await api('/applications', { method: 'POST', form: fd });
      navigate(`/applications/${newId}`);
    } catch (err) {
      setError(err.message);
      setBusy(null);
    }
  };
  const onSubmit = (e) => {
    e.preventDefault();
    save(isDraft ? 'submit' : 'save');
  };

  if (loadError) return <ErrorBox error={loadError} />;
  if (editing && !existing) return <Loading />;
  if (editing && !existing.permissions.canEdit)
    return (
      <div className="page">
        <div className="alert alert-warn">This application is being reviewed by the officer, so its details can't be changed now.</div>
        <Link to={`/applications/${id}`} className="back">← Back to application</Link>
      </div>
    );

  const missingCount = required.filter((t) => !files[t]).length;
  const title = !editing ? 'New approval application' : isDraft ? 'Edit draft' : 'Correct application details';

  return (
    <div className="page">
      {editing && <Link to={`/applications/${id}`} className="back">← Back to application</Link>}
      <div className="page-head">
        <div>
          <h1>{title}</h1>
          <p className="sub">
            {editing ? <span className="mono">{existing.app.app_no}</span> : user.institution.name} · {user.institution.type} · {user.institution.city}, {user.institution.state}
          </p>
        </div>
      </div>

      {editing && !isDraft && (
        <div className="alert alert-warn">
          The assigned officer is notified of every change you make here, and each change is recorded in the audit trail.
        </div>
      )}

      <form className="detail-grid" onSubmit={onSubmit}>
        <div className="col">
          <section className="card">
            <h2>1. Application</h2>
            <div className="form-grid">
              <label className="field span-2">
                <span>Category {editing && !isDraft && <span className="muted">(fixed after submission)</span>}</span>
                <select id="f-category" className="input" value={form.category} onChange={set('category')} disabled={editing && !isDraft}>
                  {Object.entries(meta.CATEGORIES).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </label>
              <label className="field span-2">
                <span>Program / course name</span>
                <input id="f-program" className="input" value={form.program} onChange={set('program')} placeholder="e.g. B.Tech Cyber Security" required={!isDraft} />
              </label>
              <label className="field">
                <span>Academic year</span>
                <input id="f-ay" className="input" value={form.academic_year} onChange={set('academic_year')} pattern="\d{4}-\d{2}" required />
              </label>
              <label className="field">
                <span>Program duration (years)</span>
                <input id="f-duration" className="input" type="number" min="1" max="6" value={form.duration_years} onChange={set('duration_years')} required={!isDraft} />
              </label>
            </div>
          </section>

          <section className="card">
            <h2>2. Infrastructure & faculty</h2>
            <p className="muted small">
              Norms for {user.institution.type}: faculty-student ratio 1:{norm.fsr}, minimum land {norm.minLand} acres, {norm.sqmPerStudent} sq.m built-up per student.
            </p>
            <div className="form-grid">
              <label className="field">
                <span>Proposed intake (per year)</span>
                <input id="f-intake" className="input" type="number" min="1" value={form.proposed_intake} onChange={set('proposed_intake')} required={!isDraft} />
              </label>
              <label className="field">
                <span>Regular faculty</span>
                <input id="f-faculty" className="input" type="number" min="0" value={form.faculty_count} onChange={set('faculty_count')} required={!isDraft} />
              </label>
              <label className="field">
                <span>Land area (acres)</span>
                <input id="f-land" className="input" type="number" min="0" step="0.1" value={form.land_area} onChange={set('land_area')} required={!isDraft} />
              </label>
              <label className="field">
                <span>Built-up area (sq.m)</span>
                <input id="f-built" className="input" type="number" min="0" value={form.built_up_area} onChange={set('built_up_area')} required={!isDraft} />
              </label>
            </div>
          </section>

          {editing ? (
            <section className="card">
              <h2>3. Documents</h2>
              <p className="muted small">
                Documents are managed on the application page: {existing.app.docs.length} of {existing.documents.length} uploaded.{' '}
                <Link to={`/applications/${id}`} className="link">Upload or replace documents</Link>
              </p>
            </section>
          ) : (
            <section className="card">
              <div className="card-head">
                <h2>3. Required documents</h2>
                <span className={`small ${missingCount ? 'text-warn' : 'muted'}`}>
                  {required.length - missingCount} of {required.length} attached
                </span>
              </div>
              <p className="muted small">PDF, JPG or PNG up to 4 MB each. You can save a draft or submit with documents missing and upload them later, but the officer cannot approve until all are verified.</p>
              <ul className="docs">
                {required.map((t) => {
                  const expiring = meta.EXPIRING_DOC_TYPES.includes(t);
                  return (
                    <li key={t} className={`doc ${files[t] ? '' : 'doc-missing'}`}>
                      <div className="doc-main">
                        <div className="doc-title">
                          {meta.DOC_TYPES[t]}
                          {expiring && <span className="tag">Dated certificate</span>}
                        </div>
                        <div className="doc-meta">{files[t] ? <span className="mono">{files[t].name}</span> : 'No file chosen'}</div>
                      </div>
                      <div className="doc-side doc-actions">
                        {expiring && (
                          <input
                            id={`f-expiry-${t}`}
                            type="date"
                            className="input input-sm"
                            value={expiries[t] || ''}
                            onChange={(e) => setExpiries((x) => ({ ...x, [t]: e.target.value }))}
                            aria-label={`${meta.DOC_TYPES[t]} valid until`}
                            title="Valid until"
                          />
                        )}
                        <label className="btn btn-sm btn-ghost">
                          {files[t] ? 'Change' : 'Choose file'}
                          <input
                            id={`f-file-${t}`}
                            type="file"
                            accept=".pdf,.png,.jpg,.jpeg"
                            hidden
                            onChange={(e) => setFiles((f) => ({ ...f, [t]: e.target.files[0] }))}
                          />
                        </label>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>

        <div className="col">
          <section className="card sticky">
            <h2>Readiness check</h2>
            <p className="muted small">Checked live against AICTE norms.</p>
            {preview && (
              <div className="compliance compliance-stack">
                <ScoreRing score={preview.score} size={88} />
                <CheckList checks={preview.checks.filter((c) => c.key !== 'docs_verified')} />
              </div>
            )}
            {error && <div className="alert alert-bad">{error}</div>}
            {isDraft ? (
              <>
                <button className="btn btn-primary btn-block" disabled={Boolean(busy)}>
                  {busy === 'submit' ? 'Submitting…' : 'Submit application'}
                </button>
                <button type="button" className="btn btn-ghost btn-block" disabled={Boolean(busy)} onClick={() => save('draft')}>
                  {busy === 'draft' ? 'Saving…' : editing ? 'Save draft' : 'Save as draft'}
                </button>
                <p className="muted small">
                  A draft is visible only to your institution. On submit, the application is assigned to an eligible officer and the review deadline is set to {meta.SLA.reviewDays} days.
                </p>
              </>
            ) : (
              <button className="btn btn-primary btn-block" disabled={Boolean(busy)}>{busy ? 'Saving…' : 'Save changes'}</button>
            )}
          </section>
        </div>
      </form>
    </div>
  );
}
