import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plane } from 'lucide-react';
import { useAuth } from '../lib/auth';

export function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app-shell" style={{ maxWidth: 420, marginTop: 40 }}>
      <div className="panel">
        <div className="center mb">
          <Plane size={34} style={{ color: 'var(--accent)' }} />
          <h1 className="page-title" style={{ marginTop: 8 }}>
            TravelApp
          </h1>
          <p className="page-sub">Plan, map, budget and journal your trips.</p>
        </div>
        <form onSubmit={submit}>
          <div className="field">
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </div>
          <div className="field">
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          {error && (
            <div className="small danger mb" role="alert">
              {error}
            </div>
          )}
          <button className="btn primary" style={{ width: '100%' }} disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="small muted mt center">
          Need an account? <Link className="link" to="/register">Create one</Link>
        </p>
      </div>
    </div>
  );
}