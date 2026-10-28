import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabase.js';
import { Logo } from '../components/ui.jsx';

export default function ResetPassword({ session, onDone }) {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const finish = () => {
    onDone();
    navigate('/', { replace: true });
  };

  const submit = async (e) => {
    e.preventDefault();
    if (password.length < 8) return setError('Use a password of at least 8 characters.');
    if (password !== confirm) return setError('The two passwords do not match.');
    setBusy(true);
    setError('');
    const { error: err } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (err) setError(err.message);
    else finish();
  };

  return (
    <div className="notice-page">
      {session === undefined ? null : !session ? (
        <div className="card notice-card">
          <Logo />
          <h2>Reset link expired</h2>
          <p className="muted">This password reset link is no longer valid. Request a new one from the sign-in page.</p>
          <button className="btn btn-primary" onClick={finish}>Go to sign in</button>
        </div>
      ) : (
        <form className="card notice-card" onSubmit={submit}>
          <Logo />
          <h2>Set a new password</h2>
          <p className="muted small">For {session.user.email}</p>
          <label className="field">
            <span>New password</span>
            <input id="reset-password" className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </label>
          <label className="field">
            <span>Confirm new password</span>
            <input id="reset-confirm" className="input" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </label>
          {error && <div className="alert alert-bad">{error}</div>}
          <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button>
        </form>
      )}
    </div>
  );
}
