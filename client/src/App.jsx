import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api, setToken } from './api.js';
import { supabase, supabaseConfigured } from './supabase.js';
import Layout from './components/Layout.jsx';
import { Loading, Logo } from './components/ui.jsx';
import Login from './pages/Login.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Applications from './pages/Applications.jsx';
import ApplicationDetail from './pages/ApplicationDetail.jsx';
import NewApplication from './pages/NewApplication.jsx';
import Users from './pages/Users.jsx';
import Rules from './pages/Rules.jsx';
import AuditReports from './pages/AuditReports.jsx';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

function Notice({ title, children, action }) {
  return (
    <div className="notice-page">
      <div className="card notice-card">
        <Logo />
        <h2>{title}</h2>
        <div className="muted">{children}</div>
        {action}
      </div>
    </div>
  );
}

export default function App() {
  const location = useLocation();
  const [session, setSession] = useState(undefined);
  const [recovery, setRecovery] = useState(false);
  const [user, setUser] = useState(null);
  const [meta, setMeta] = useState(null);
  const [profileError, setProfileError] = useState(null);

  useEffect(() => {
    if (!supabase) return undefined;
    supabase.auth.getSession().then(({ data }) => {
      setToken(data.session?.access_token ?? null);
      setSession(data.session);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setToken(s?.access_token ?? null);
      setSession(s);
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
    });
    const onLogout = () => supabase.auth.signOut();
    window.addEventListener('auth:logout', onLogout);
    return () => {
      sub.subscription.unsubscribe();
      window.removeEventListener('auth:logout', onLogout);
    };
  }, []);

  // Load the portal profile whenever a different account signs in.
  const authId = session?.user?.id;
  useEffect(() => {
    setProfileError(null);
    if (!authId) {
      setUser(null);
      setMeta(null);
      return;
    }
    let cancelled = false;
    api('/auth/me')
      .then((r) => !cancelled && setUser(r.user))
      .catch((e) => !cancelled && setProfileError(e));
    return () => {
      cancelled = true;
    };
  }, [authId]);

  useEffect(() => {
    if (user) api('/meta').then(setMeta).catch(() => {});
  }, [user]);

  const reloadMeta = useCallback(() => api('/meta').then(setMeta), []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
    setMeta(null);
  }, []);

  if (!supabaseConfigured)
    return (
      <Notice title="Supabase is not configured">
        Add <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> to the <code>.env</code> file, then run{' '}
        <code>npm run build</code> again.
      </Notice>
    );
  if (recovery || location.pathname === '/reset-password')
    return <ResetPassword session={session} onDone={() => setRecovery(false)} />;
  if (session === undefined) return <Loading />;
  if (!session) return <Login />;
  if (profileError)
    return (
      <Notice title={profileError.code === 'NO_PROFILE' ? 'No portal access yet' : 'Could not load your account'} action={<button className="btn btn-primary" onClick={signOut}>Sign out</button>}>
        {profileError.message}
      </Notice>
    );
  if (!user || !meta) return <Loading />;

  return (
    <AuthContext.Provider value={{ user, meta, signOut, reloadMeta }}>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/applications" element={<Applications />} />
          {user.role === 'COLLEGE' && <Route path="/applications/new" element={<NewApplication />} />}
          {user.role === 'COLLEGE' && <Route path="/applications/:id/edit" element={<NewApplication />} />}
          <Route path="/applications/:id" element={<ApplicationDetail />} />
          {user.role === 'ADMIN' && <Route path="/users" element={<Users />} />}
          {user.role === 'ADMIN' && <Route path="/rules" element={<Rules />} />}
          {user.role === 'ADMIN' && <Route path="/officers" element={<Navigate to="/users" replace />} />}
          {user.role === 'ADMIN' && <Route path="/audit" element={<AuditReports />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </AuthContext.Provider>
  );
}
