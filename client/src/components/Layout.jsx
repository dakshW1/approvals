import { useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../App.jsx';
import { api } from '../api.js';
import { supabase } from '../supabase.js';
import { Icon, LogoMark, ROLE_LABEL, ThemeToggle, timeAgo } from './ui.jsx';

function NotificationBell() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ items: [], unread: 0 });
  const [live, setLive] = useState(false);
  const [ping, setPing] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();

  const load = () => api('/notifications').then(setData).catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [location.pathname]);

  // Supabase Realtime pushes new alerts the moment they are written; polling stays as a fallback.
  useEffect(() => {
    if (!supabase) return undefined;
    const channel = supabase
      .channel(`notifications-${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` }, (payload) => {
        load();
        window.dispatchEvent(new CustomEvent('portal:notification', { detail: payload.new }));
        setPing(true);
        setTimeout(() => setPing(false), 1600);
      })
      .subscribe((status) => setLive(status === 'SUBSCRIBED'));
    return () => {
      supabase.removeChannel(channel);
    };
  }, [user.id]);
  useEffect(() => {
    const close = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const openItem = async (n) => {
    if (!n.is_read) await api(`/notifications/${n.id}/read`, { method: 'POST' }).catch(() => {});
    setOpen(false);
    load();
    if (n.application_id) navigate(`/applications/${n.application_id}`);
  };
  const readAll = async () => {
    await api('/notifications/read-all', { method: 'POST' });
    load();
  };

  return (
    <div className="bell" ref={ref}>
      <button className={`icon-btn ${ping ? 'is-ping' : ''}`} onClick={() => setOpen((o) => !o)} aria-label={`Notifications, ${data.unread} unread`}>
        <Icon name="bell" />
        {data.unread > 0 && <span className="bell-count">{data.unread > 99 ? '99+' : data.unread}</span>}
      </button>
      {open && (
        <div className="dropdown">
          <div className="dropdown-head">
            <strong>
              Alerts {live && <span className="live-tag" title="Updates arrive instantly via Supabase Realtime">Live</span>}
            </strong>
            {data.unread > 0 && (
              <button className="link-btn" onClick={readAll}>Mark all read</button>
            )}
          </div>
          <div className="dropdown-body">
            {data.items.length === 0 && <div className="empty">You're all caught up.</div>}
            {data.items.map((n) => (
              <button key={n.id} className={`notif sev-${n.severity} ${n.is_read ? 'is-read' : ''}`} onClick={() => openItem(n)}>
                <span className="notif-dot" />
                <span className="notif-body">
                  <span className="notif-msg">{n.message}</span>
                  <span className="notif-meta">{n.type.replace(/_/g, ' ').toLowerCase()} · {timeAgo(n.created_at)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Layout({ children }) {
  const { user, signOut } = useAuth();
  const nav = [
    { to: '/', label: 'Dashboard', short: 'Home', icon: 'home', end: true },
    { to: '/applications', label: user.role === 'COLLEGE' ? 'My applications' : 'Applications', short: 'Apps', icon: 'list', end: true },
    user.role === 'COLLEGE' && { to: '/applications/new', label: 'New application', short: 'New', icon: 'plus' },
    user.role !== 'COLLEGE' && { to: '/analytics', label: 'Analytics', short: 'Stats', icon: 'chart' },
    user.role === 'ADMIN' && { to: '/users', label: 'Users & officers', short: 'Users', icon: 'users' },
    user.role === 'ADMIN' && { to: '/rules', label: 'Rules & norms', short: 'Rules', icon: 'sliders' },
    user.role === 'ADMIN' && { to: '/audit', label: 'Audit trail & reports', short: 'Audit', icon: 'audit' },
  ].filter(Boolean);
  const initial = user.name.replace(/^(Dr\.|Principal,)\s*/, '').charAt(0);
  const context = user.institution
    ? user.institution.name
    : user.role === 'ADMIN'
      ? 'Approval Bureau · All regions'
      : `${user.designation} · ${user.region} region`;

  return (
    <div className="shell">
      <nav className="rail" aria-label="Main">
        <NavLink to="/" className="rail-logo" aria-label="AICTE Approvals home">
          <LogoMark />
        </NavLink>
        {nav.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `rail-link ${isActive ? 'active' : ''}`} aria-label={n.label}>
            <Icon name={n.icon} size={21} />
            <span className="rail-tip">{n.label}</span>
          </NavLink>
        ))}
        <div className="rail-spacer" />
        <button className="rail-link" onClick={signOut} aria-label="Sign out">
          <Icon name="logout" />
          <span className="rail-tip">Sign out</span>
        </button>
        <div className="rail-avatar" title={user.name}>{initial}</div>
      </nav>

      <div className="main">
        <header className="topbar">
          <div className="topbar-ctx">
            <span className="ctx-pill">
              <span className="ctx-badge">{ROLE_LABEL[user.role]}</span>
              <span className="ctx-name">{context}</span>
            </span>
          </div>
          <div className="topbar-right">
            <ThemeToggle />
            <NotificationBell />
          </div>
        </header>
        <main className="content">{children}</main>
      </div>

      <nav className="bottom-nav" aria-label="Main">
        {nav.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'active' : '')}>
            <span className="bn-ico"><Icon name={n.icon} size={19} /></span>
            {n.short}
          </NavLink>
        ))}
        <button onClick={signOut}>
          <span className="bn-ico"><Icon name="logout" size={19} /></span>
          Sign out
        </button>
      </nav>
    </div>
  );
}
