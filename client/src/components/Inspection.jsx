import { useRef, useState } from 'react';
import { useAuth } from '../App.jsx';
import { api } from '../api.js';
import { compressImage, currentPosition, readExif } from '../exif.js';
import { Icon, fmtDate, fmtDateTime } from './ui.jsx';

const km = (m) => (m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`);
const VERDICT = {
  on_campus: { tone: 'ok', text: (p) => `On campus · ${km(p.distance_m)}` },
  off_campus: { tone: 'bad', text: (p) => `Away from campus · ${km(p.distance_m)}` },
  no_campus: { tone: 'warn', text: () => 'Located · campus not on file' },
  no_location: { tone: 'warn', text: () => 'No location' },
};
const SOURCE = { exif: 'GPS from photo', device: 'GPS from phone', none: 'No GPS' };

function PhotoCard({ p, canSetCampus, onSetCampus }) {
  const v = VERDICT[p.verdict];
  return (
    <figure className="photo">
      {p.url ? (
        <a href={p.url} target="_blank" rel="noreferrer" className="photo-img"><img src={p.url} alt={p.caption || 'Site photo'} loading="lazy" /></a>
      ) : (
        <div className="photo-img photo-missing">Image unavailable</div>
      )}
      <figcaption>
        <span className={`pill pill-${v.tone}`}>{v.text(p)}</span>
        {p.caption && <span className="photo-caption">{p.caption}</span>}
        <span className="photo-meta">
          {SOURCE[p.location_source] || 'No GPS'}
          {p.taken_at && <> · {fmtDateTime(p.taken_at)}</>}
          {p.lat !== null && (
            <>
              {' · '}
              <a className="link" href={`https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=17/${p.lat}/${p.lng}`} target="_blank" rel="noreferrer">Map</a>
            </>
          )}
        </span>
        {canSetCampus && p.lat !== null && (
          <button className="link-btn small" onClick={() => onSetCampus(p)}>Use as campus location</button>
        )}
      </figcaption>
    </figure>
  );
}

export default function Inspection({ data, onChanged }) {
  const { user } = useAuth();
  const { app, site } = data;
  const insp = site?.inspection;
  const staff = user.role === 'OFFICER' || user.role === 'ADMIN';
  const canAct = staff && app.status === 'UNDER_REVIEW';
  const [date, setDate] = useState(insp ? insp.scheduled_for.slice(0, 10) : '');
  const [committee, setCommittee] = useState(insp?.committee || '');
  const [editing, setEditing] = useState(false);
  const [findings, setFindings] = useState('');
  const [recommendation, setRecommendation] = useState('');
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const fileRef = useRef(null);

  if (!site || (!site.required && !insp && !canAct)) return null;

  const run = async (key, fn) => {
    setBusy(key);
    setError('');
    setInfo('');
    try {
      const next = await fn();
      if (next) onChanged(next);
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setBusy(null);
    }
  };
  const schedule = () =>
    run('schedule', () => api(`/applications/${app.id}/inspection`, { method: 'POST', body: { scheduled_for: date, committee } })).then((ok) => ok && setEditing(false));

  // For each photo: GPS from the file's EXIF if present, otherwise ask the phone for its position once.
  const addPhotos = async (files) => {
    if (!files.length) return;
    setBusy('photos');
    setError('');
    setInfo('');
    let device;
    let latest = null;
    let located = 0;
    try {
      for (const file of files) {
        const exif = await readExif(file);
        let loc = exif.lat !== undefined ? { lat: exif.lat, lng: exif.lng, source: 'exif' } : null;
        if (!loc) {
          if (device === undefined) device = await currentPosition();
          if (device) loc = { ...device, source: 'device' };
        }
        if (loc) located++;
        const upload = await compressImage(file);
        const form = new FormData();
        form.append('photo', upload, upload.name || 'photo.jpg');
        if (loc) {
          form.append('lat', loc.lat);
          form.append('lng', loc.lng);
          form.append('location_source', loc.source);
          if (loc.accuracy) form.append('accuracy', loc.accuracy);
        }
        if (exif.takenAt) form.append('taken_at', exif.takenAt);
        if (caption.trim()) form.append('caption', caption.trim());
        latest = await api(`/inspections/${insp.id}/photos`, { method: 'POST', form });
      }
      if (latest) onChanged(latest);
      setCaption('');
      setInfo(`${files.length} photo(s) added${located < files.length ? `, ${files.length - located} without a location. Allow location access or use the phone camera to geo-tag photos.` : '.'}`);
    } catch (e) {
      if (latest) onChanged(latest);
      setError(e.message);
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const complete = () =>
    run('complete', () => api(`/inspections/${insp.id}/complete`, { method: 'POST', body: { findings, recommendation } }));
  const setCampus = (p) => run('campus', () => api(`/inspection-photos/${p.id}/campus`, { method: 'POST' }));

  return (
    <section className="card inspection">
      <div className="card-head">
        <h2>Site inspection</h2>
        {insp ? (
          <span className={`pill ${insp.status === 'COMPLETED' ? (insp.recommendation === 'SATISFACTORY' ? 'pill-ok' : 'pill-bad') : 'pill-info'}`}>
            {insp.status === 'COMPLETED' ? (insp.recommendation === 'SATISFACTORY' ? 'Satisfactory' : 'Deficient') : 'Scheduled'}
          </span>
        ) : (
          site.required && <span className="pill pill-warn">Required before approval</span>
        )}
      </div>

      {!insp && !canAct && (
        <p className="muted small">
          {app.category_label} applications need an expert committee site visit before a decision. AICTE will schedule it during the review.
        </p>
      )}

      {(!insp || editing) && canAct && (
        <div className="form-grid">
          <label className="field">
            <span>Visit date</span>
            <input id="insp-date" className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="field span-2">
            <span>Committee members</span>
            <input id="insp-committee" className="input" value={committee} onChange={(e) => setCommittee(e.target.value)} placeholder="e.g. Prof. A (Chair), Dr. B (AICTE nominee), Er. C (PWD)" />
          </label>
          <div className="span-2 head-actions">
            <button className="btn btn-primary btn-sm" disabled={busy === 'schedule'} onClick={schedule}>{insp ? 'Save new date' : 'Schedule visit'}</button>
            {editing && <button className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>Cancel</button>}
          </div>
        </div>
      )}

      {insp && !editing && (
        <dl className="facts">
          <div><dt>{insp.status === 'COMPLETED' ? 'Visited' : 'Visit date'}</dt><dd>{fmtDate(insp.scheduled_for)}</dd></div>
          <div><dt>Committee</dt><dd>{insp.committee}</dd></div>
          {insp.status === 'COMPLETED' && <div className="span-2"><dt>Findings</dt><dd className="findings">{insp.findings}</dd></div>}
        </dl>
      )}
      {insp?.status === 'SCHEDULED' && canAct && !editing && (
        <button className="link-btn small" onClick={() => setEditing(true)}>Change date or committee</button>
      )}

      {insp && (
        <>
          <div className="card-head">
            <h3 className="mini-head">Geo-tagged photos ({insp.photos.length})</h3>
            {insp.off_campus > 0 && <span className="chip chip-bad">{insp.off_campus} away from campus</span>}
          </div>
          {!site.campus?.lat && staff && (
            <p className="muted small">The campus location isn't on file yet. Pick a trusted on-site photo and choose "Use as campus location".</p>
          )}
          {insp.photos.length > 0 ? (
            <div className="photo-grid">
              {insp.photos.map((p) => (
                <PhotoCard key={p.id} p={p} canSetCampus={canAct && !site.campus?.lat} onSetCampus={setCampus} />
              ))}
            </div>
          ) : (
            <p className="muted small">No photos yet. During the visit, take photos with the phone camera; each one is checked against the campus location (within {km(site.radius_m)}).</p>
          )}
        </>
      )}

      {insp?.status === 'SCHEDULED' && canAct && (
        <div className="inspection-actions">
          <div className="photo-add">
            <input id="photo-caption" className="input input-sm" placeholder="Caption (optional), e.g. Library" value={caption} onChange={(e) => setCaption(e.target.value)} />
            <input ref={fileRef} type="file" accept="image/*" capture="environment" multiple hidden onChange={(e) => addPhotos([...e.target.files])} />
            <button className="btn btn-sm btn-ghost" disabled={Boolean(busy)} onClick={() => fileRef.current.click()}>
              <Icon name="plus" size={16} /> {busy === 'photos' ? 'Uploading…' : 'Add site photos'}
            </button>
          </div>
          <label className="field">
            <span>Committee findings</span>
            <textarea id="insp-findings" className="input" rows={3} value={findings} onChange={(e) => setFindings(e.target.value)} placeholder="What the committee verified on site, and any shortfalls" />
          </label>
          <div className="segmented recommend" role="radiogroup" aria-label="Recommendation">
            <button role="radio" aria-checked={recommendation === 'SATISFACTORY'} className={recommendation === 'SATISFACTORY' ? 'active' : ''} onClick={() => setRecommendation('SATISFACTORY')}>Satisfactory</button>
            <button role="radio" aria-checked={recommendation === 'DEFICIENT'} className={recommendation === 'DEFICIENT' ? 'active' : ''} onClick={() => setRecommendation('DEFICIENT')}>Deficient</button>
          </div>
          <button className="btn btn-primary btn-sm" disabled={Boolean(busy) || !recommendation} onClick={complete}>
            {busy === 'complete' ? 'Saving…' : 'Complete inspection'}
          </button>
        </div>
      )}

      {insp?.status === 'COMPLETED' && (
        <p className="muted small">Completed {fmtDateTime(insp.completed_at)}{insp.completed_by_name ? ` by ${insp.completed_by_name}` : ''}.</p>
      )}
      {info && <div className="alert alert-ok">{info}</div>}
      {error && <div className="alert alert-bad">{error}</div>}
    </section>
  );
}
