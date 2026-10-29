import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { supabase } from '../supabase.js';
import { Icon, Logo, ThemeToggle } from '../components/ui.jsx';

const DEMO = [
  { email: 'college@aicte.demo', role: 'Institution', who: 'Shri Venkatesh Institute of Technology, Pune', icon: 'building' },
  { email: 'officer@aicte.demo', role: 'Scrutiny Officer', who: 'Rajiv Menon, Assistant Director (West)', icon: 'user' },
  { email: 'admin@aicte.demo', role: 'Administrator', who: 'Director, Approval Bureau', icon: 'shield' },
];
const DEMO_PASSWORD = 'demo123';
const STAGES = ['Submitted', 'Under Review', 'Action Required', 'Decision'];

const EMPTY_REG = { name: '', email: '', password: '', institution_name: '', aicte_code: '', type: 'Engineering', city: '', state: '', region: 'North' };

function SignIn({ setMode }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const signIn = async (e, creds) => {
    e?.preventDefault();
    setBusy(true);
    setError('');
    const { error: err } = await supabase.auth.signInWithPassword(creds || { email: email.trim(), password });
    if (err) {
      // Registered but never entered the code: send a fresh one and go to the code screen.
      if (/not confirmed/i.test(err.message)) {
        await supabase.auth.resend({ type: 'signup', email: email.trim() });
        setMode('verify', email.trim());
        return;
      }
      setError(err.message === 'Invalid login credentials' ? 'Email or password is incorrect.' : err.message);
      setBusy(false);
      return;
    }
    api('/auth/signed-in', { method: 'POST' }).catch(() => {});
  };

  return (
    <form className="card login-card" onSubmit={signIn}>
      <div>
        <h2>Sign in</h2>
        <p className="muted small">Use your portal account, or pick a demo role below.</p>
      </div>
      <label className="field">
        <span>Email</span>
        <input id="login-email" className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@institution.edu.in" required />
      </label>
      <label className="field">
        <span className="field-row">
          Password
          <button type="button" className="link-btn" onClick={() => setMode('forgot')}>Forgot password?</button>
        </span>
        <input id="login-password" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </label>
      {error && <div className="alert alert-bad">{error}</div>}
      <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      <p className="small muted center">
        New institution? <button type="button" className="link-btn" onClick={() => setMode('register')}>Register for an account</button>
      </p>

      <div className="demo-head">Demo accounts <span className="muted">· password {DEMO_PASSWORD}</span></div>
      <div className="demo-list">
        {DEMO.map((d) => (
          <button type="button" key={d.email} className="demo-btn" disabled={busy} onClick={() => signIn(null, { email: d.email, password: DEMO_PASSWORD })}>
            <span className="demo-ico"><Icon name={d.icon} size={18} /></span>
            <span className="demo-text">
              <span className="demo-role">{d.role}</span>
              <span className="demo-who">{d.who}</span>
            </span>
            <span className="demo-arrow" aria-hidden="true">→</span>
          </button>
        ))}
      </div>
    </form>
  );
}

// Supabase emails a one-time code (the {{ .Token }} in the email template). Entering it signs the user in.
function CodeForm({ email, type, title, intro, onBack, resend }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(60);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const { error: err } = await supabase.auth.verifyOtp({ email, token: code.trim(), type });
    if (err) {
      setError(/expired|invalid/i.test(err.message) ? 'That code is wrong or has expired. Check the latest email, or send a new code.' : err.message);
      setBusy(false);
    }
    // On success Supabase signs the user in and the app moves on by itself.
  };

  const again = async () => {
    setError('');
    setInfo('');
    const { error: err } = await resend();
    if (err) setError(err.message);
    else {
      setInfo('A new code is on its way.');
      setCooldown(60);
    }
  };

  return (
    <form className="card login-card" onSubmit={submit}>
      <div>
        <h2>{title}</h2>
        <p className="muted small">{intro} <strong>{email}</strong>.</p>
      </div>
      <label className="field">
        <span>Verification code</span>
        <input
          id="otp-code"
          className="input otp-input"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6,10}"
          maxLength={10}
          placeholder="••••••"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          autoFocus
          required
        />
      </label>
      {error && <div className="alert alert-bad">{error}</div>}
      {info && <div className="alert alert-ok">{info}</div>}
      <button className="btn btn-primary btn-block" disabled={busy || code.length < 6}>{busy ? 'Checking…' : 'Verify code'}</button>
      <p className="small muted center">
        Didn't get it?{' '}
        <button type="button" className="link-btn" disabled={cooldown > 0} onClick={again}>
          {cooldown > 0 ? `Resend in ${cooldown}s` : 'Send a new code'}
        </button>
        {' · '}
        <button type="button" className="link-btn" onClick={onBack}>Back to sign in</button>
      </p>
    </form>
  );
}

function Register({ setMode }) {
  const [f, setF] = useState(EMPTY_REG);
  const [options, setOptions] = useState({ types: ['Engineering', 'Management', 'Pharmacy', 'Polytechnic'], regions: ['North', 'South', 'East', 'West', 'Central'] });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  useEffect(() => {
    api('/public/options', { auth: false }).then(setOptions).catch(() => {});
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (f.password.length < 8) return setError('Use a password of at least 8 characters.');
    setBusy(true);
    try {
      if (f.aicte_code.trim()) {
        const { available } = await api(`/public/institution-code?code=${encodeURIComponent(f.aicte_code.trim())}`, { auth: false });
        if (!available) throw new Error('An institution with this AICTE ID is already registered. Sign in instead, or contact the administrator.');
      }
      const { email, password, ...meta } = f;
      const { data, error: err } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { emailRedirectTo: window.location.origin, data: { signup: 'institution', ...meta } },
      });
      if (err) throw err;
      // With email confirmation on, Supabase returns no session until the emailed code is entered.
      if (!data.session) setMode('verify', email.trim());
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <form className="card login-card login-card-wide" onSubmit={submit}>
      <div>
        <h2>Register your institution</h2>
        <p className="muted small">Creates a principal's account for submitting AICTE approval applications. Officer accounts are issued by AICTE.</p>
      </div>
      <div className="form-grid">
        <label className="field span-2">
          <span>Institution name</span>
          <input id="reg-inst" className="input" value={f.institution_name} onChange={set('institution_name')} required />
        </label>
        <label className="field">
          <span>Institution type</span>
          <select id="reg-type" className="input" value={f.type} onChange={set('type')}>
            {options.types.map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        <label className="field">
          <span>AICTE ID <span className="muted">(if you have one)</span></span>
          <input id="reg-code" className="input" value={f.aicte_code} onChange={set('aicte_code')} placeholder="1-12345678" />
        </label>
        <label className="field">
          <span>City</span>
          <input id="reg-city" className="input" value={f.city} onChange={set('city')} required />
        </label>
        <label className="field">
          <span>State</span>
          <input id="reg-state" className="input" value={f.state} onChange={set('state')} required />
        </label>
        <label className="field span-2">
          <span>AICTE region</span>
          <select id="reg-region" className="input" value={f.region} onChange={set('region')}>
            {options.regions.map((r) => <option key={r}>{r}</option>)}
          </select>
        </label>
        <label className="field span-2">
          <span>Principal's name</span>
          <input id="reg-name" className="input" value={f.name} onChange={set('name')} autoComplete="name" required />
        </label>
        <label className="field">
          <span>Official email</span>
          <input id="reg-email" className="input" type="email" value={f.email} onChange={set('email')} autoComplete="email" required />
        </label>
        <label className="field">
          <span>Password</span>
          <input id="reg-password" className="input" type="password" value={f.password} onChange={set('password')} autoComplete="new-password" minLength={8} required />
        </label>
      </div>
      {error && <div className="alert alert-bad">{error}</div>}
      <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</button>
      <p className="small muted center">
        Already registered? <button type="button" className="link-btn" onClick={() => setMode('signin')}>Sign in</button>
      </p>
    </form>
  );
}

const sendResetCode = (email) =>
  supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` });

function Forgot({ setMode }) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const { error: err } = await sendResetCode(email.trim());
    setBusy(false);
    if (err) setError(err.message);
    else setMode('reset-code', email.trim());
  };

  return (
    <form className="card login-card" onSubmit={submit}>
      <div>
        <h2>Reset password</h2>
        <p className="muted small">Enter your account email and we'll send you a code to set a new password.</p>
      </div>
      <label className="field">
        <span>Email</span>
        <input id="forgot-email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      {error && <div className="alert alert-bad">{error}</div>}
      <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Sending…' : 'Send code'}</button>
      <p className="small muted center">
        <button type="button" className="link-btn" onClick={() => setMode('signin')}>Back to sign in</button>
      </p>
    </form>
  );
}

export default function Login() {
  const [state, setState] = useState({ mode: 'signin', email: '' });
  const mode = state.mode;
  const setMode = (m, email = state.email) => setState({ mode: m, email });

  return (
    <div className="login">
      <section className="login-hero">
        <div className="grain" aria-hidden="true" />
        <Logo />
        <h1 className="login-title">
          Approvals, tracked <span className="serif">on time.</span>
        </h1>
        <p className="login-lede">
          One place for institutions, scrutiny officers and the AICTE approval bureau. Applications are routed to the right
          officer automatically, checked against norms, and watched for deadlines and expiring certificates.
        </p>
        <ol className="login-stages">
          {STAGES.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <ul className="login-points">
          <li><strong>Rule-based assignment</strong>by category, officer role, region and workload</li>
          <li><strong>Compliance score</strong>from documents, faculty ratio, land and built-up norms</li>
          <li><strong>Live alerts & escalation</strong>for deadlines, missing documents and expiring NOCs</li>
          <li><strong>Audit trail</strong>of every assignment, review and status change</li>
        </ul>
      </section>

      <section className="login-panel">
        <ThemeToggle className="login-theme" />
        {mode === 'signin' && <SignIn setMode={setMode} />}
        {mode === 'register' && <Register setMode={setMode} />}
        {mode === 'forgot' && <Forgot setMode={setMode} />}
        {mode === 'verify' && (
          <CodeForm
            key="verify"
            email={state.email}
            type="signup"
            title="Verify your email"
            intro="Enter the code we emailed to"
            onBack={() => setMode('signin')}
            resend={() => supabase.auth.resend({ type: 'signup', email: state.email })}
          />
        )}
        {mode === 'reset-code' && (
          <CodeForm
            key="reset"
            email={state.email}
            type="recovery"
            title="Enter reset code"
            intro="If an account exists, we emailed a code to"
            onBack={() => setMode('signin')}
            resend={() => sendResetCode(state.email)}
          />
        )}
        <p className="login-note">Smart India Hackathon prototype. Sample institutions and records are fictional.</p>
      </section>
    </div>
  );
}
