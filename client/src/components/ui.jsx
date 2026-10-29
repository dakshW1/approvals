import { useCallback, useEffect, useState } from 'react';

// An approval seal: ring with a tick. The tick carries the accent.
export function LogoMark({ size = 26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="10.5" fill="none" stroke="currentColor" strokeWidth="2.2" />
      <path d="M16 2.5v3M16 26.5v3M2.5 16h3M26.5 16h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.45" />
      <path d="M11.5 16.3l3.2 3.2 5.8-6.6" fill="none" stroke="#8FCBA8" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="logo">
      <LogoMark size={30} />
      <span className="logo-name">AICTE Approvals</span>
    </span>
  );
}

const ICON_PATHS = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  plus: 'M12 5v14M5 12h14',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  audit: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 13h6M9 17h6',
  bell: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  check: 'M20 6 9 17l-5-5',
  alert: 'M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10zM9 12l2 2 4-4',
  folder: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z',
  building: 'M3 21h18M5 21V7l7-4 7 4v14M9 21v-4h6v4M9 10h.01M15 10h.01M9 14h.01M15 14h.01',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
  chart: 'M3 3v18h18M7 15l4-4 3 3 5-6',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42',
  moon: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z',
  monitor: 'M3 4h18v12H3zM8 20h8M12 16v4',
  sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M12 18v-6M9 15l3 3 3-3',
  x: 'M18 6 6 18M6 6l12 12',
  mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM22 6l-10 7L2 6',
};

// Theme: "system" follows the device; "light" / "dark" are stored per browser.
const THEME_KEY = 'aicte_theme';
const readTheme = () => {
  try {
    return localStorage.getItem(THEME_KEY) || 'system';
  } catch {
    return 'system';
  }
};
export function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}
export function ThemeToggle({ className = '' }) {
  const [theme, setTheme] = useState(readTheme);
  const choose = (t) => {
    setTheme(t);
    applyTheme(t);
    try {
      if (t === 'system') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, t);
    } catch {
      /* storage unavailable: the choice lasts for this visit */
    }
  };
  const options = [
    ['system', 'monitor', 'Match device'],
    ['light', 'sun', 'Light'],
    ['dark', 'moon', 'Dark'],
  ];
  return (
    <div className={`theme-switch ${className}`} role="group" aria-label="Theme">
      {options.map(([t, icon, label]) => (
        <button key={t} type="button" aria-pressed={theme === t} title={label} aria-label={label} onClick={() => choose(t)}>
          <Icon name={icon} size={16} />
        </button>
      ))}
    </div>
  );
}

export function Modal({ title, onClose, children, footer }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn icon-btn-sm" onClick={onClose} aria-label="Close"><Icon name="x" size={18} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
export function Icon({ name, size = 20, stroke = 1.9 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

export const STATUS_META = {
  DRAFT: { label: 'Draft', tone: 'draft' },
  SUBMITTED: { label: 'Submitted', tone: 'neutral' },
  UNDER_REVIEW: { label: 'Under Review', tone: 'info' },
  ACTION_REQUIRED: { label: 'Action Required', tone: 'warn' },
  APPROVED: { label: 'Approved', tone: 'ok' },
  REJECTED: { label: 'Rejected', tone: 'bad' },
};

export const ROLE_LABEL = { ADMIN: 'Administrator', OFFICER: 'Scrutiny Officer', COLLEGE: 'Institution' };

export function useLoad(fn, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const load = useCallback(() => {
    setState((s) => ({ ...s, loading: true }));
    return fn()
      .then((data) => setState({ data, error: null, loading: false }))
      .catch((error) => setState({ data: null, error, loading: false }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    load();
  }, [load]);
  return { ...state, reload: load, setData: (data) => setState({ data, error: null, loading: false }) };
}

export function StatusBadge({ status }) {
  const m = STATUS_META[status] || { label: status, tone: 'neutral' };
  return <span className={`pill pill-${m.tone}`}>{m.label}</span>;
}

export function DueChip({ app }) {
  if (app.is_draft) return <span className="muted">Not submitted</span>;
  if (!app.is_open) return <span className="muted">Closed</span>;
  const d = app.days_left;
  if (d < 0) return <span className="chip chip-bad">Overdue {-d}d</span>;
  if (d === 0) return <span className="chip chip-warn">Due today</span>;
  if (d <= 3) return <span className="chip chip-warn">{d}d left</span>;
  return <span className="chip">{d}d left</span>;
}

export function scoreTone(score) {
  return score >= 85 ? 'ok' : score >= 65 ? 'warn' : 'bad';
}

export function ScoreBar({ score }) {
  return (
    <div className="scorebar" title={`Compliance ${score}%`}>
      <div className="scorebar-track">
        <div className={`scorebar-fill tone-${scoreTone(score)}`} style={{ width: `${score}%` }} />
      </div>
      <span className="scorebar-num">{score}%</span>
    </div>
  );
}

export function ScoreRing({ score, size = 96 }) {
  const r = 40;
  const c = 2 * Math.PI * r;
  return (
    <svg className={`ring tone-${scoreTone(score)}`} width={size} height={size} viewBox="0 0 100 100" role="img" aria-label={`Compliance score ${score}%`}>
      <circle cx="50" cy="50" r={r} className="ring-track" fill="none" strokeWidth="10" />
      <circle
        cx="50" cy="50" r={r} className="ring-fill" fill="none" strokeWidth="10" strokeLinecap="round"
        strokeDasharray={`${(score / 100) * c} ${c}`} transform="rotate(-90 50 50)"
      />
      <text x="50" y="50" textAnchor="middle" dominantBaseline="central" className="ring-text">{score}%</text>
    </svg>
  );
}

const CHECK_ICON = { pass: '✓', warn: '!', fail: '✕' };
export function CheckList({ checks }) {
  return (
    <ul className="checks">
      {checks.map((c) => (
        <li key={c.key} className={`check check-${c.status}`}>
          <span className="check-icon" aria-hidden="true">{CHECK_ICON[c.status]}</span>
          <div>
            <div className="check-label">{c.label}</div>
            <div className="check-detail">{c.detail}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
export const fmtDateTime = (iso) =>
  iso ? new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-';
export function timeAgo(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return d < 30 ? `${d} d ago` : fmtDate(iso);
}

export function Loading() {
  return <div className="loading">Loading…</div>;
}

export function ErrorBox({ error }) {
  if (!error) return null;
  return <div className="alert alert-bad">{error.message || String(error)}</div>;
}
