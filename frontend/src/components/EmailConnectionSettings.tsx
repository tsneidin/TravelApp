import { useEffect, useState, type FormEvent } from 'react';
import { apiDelete, apiGet, apiPatch } from '../lib/api';
import { ConfirmModal } from './Modal';

export interface EmailConnectionStatus {
  enabled: boolean;
  configured: boolean;
  username: string;
  recipient: string;
  folder: string;
  pollMinutes: number;
  logLevel: string;
  unseenOnly: boolean;
  allowlist: string;
  lastCheckedAt: string | null;
  lastError: string | null;
  recent24h: number;
  byStatus: { status: string; count: number }[];
}

export function EmailConnectionSettings() {
  const [status, setStatus] = useState<EmailConnectionStatus | null>(null);
  const [username, setUsername] = useState('');
  const [recipient, setRecipient] = useState('');
  const [appPassword, setAppPassword] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [unseenOnly, setUnseenOnly] = useState(true);
  const [pollMinutes, setPollMinutes] = useState(5);
  const [logLevel, setLogLevel] = useState('info');
  const [allowlist, setAllowlist] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  const load = async () => {
    const next = await apiGet<EmailConnectionStatus>('/email/status');
    setStatus(next);
    setUsername(next.username);
    setRecipient(next.recipient);
    setEnabled(next.enabled || !next.configured);
    setUnseenOnly(next.unseenOnly);
    setPollMinutes(next.pollMinutes);
    setLogLevel(next.logLevel);
    setAllowlist(next.allowlist);
  };

  useEffect(() => { void load().catch((error) => setMessage((error as Error).message)); }, []);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      const result = await apiPatch<{ claimed: number }>('/email/connection', {
        username, recipient, appPassword: appPassword || undefined,
        folder: 'INBOX', enabled, unseenOnly, pollMinutes, logLevel, allowlist,
      });
      setAppPassword('');
      await load();
      setMessage(result.claimed ? `Gmail connected. ${result.claimed} earlier email${result.claimed === 1 ? '' : 's'} moved into your review queue.` : 'Gmail connection saved.');
      window.dispatchEvent(new Event('travelapp:email-config-changed'));
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await apiDelete('/email/connection');
      setConfirmDisconnect(false);
      setAppPassword('');
      await load();
      setMessage('Gmail disconnected. Your captured emails remain in the review queue.');
      window.dispatchEvent(new Event('travelapp:email-config-changed'));
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!status) return <p className="small muted" role={message ? 'alert' : undefined}>{message || 'Loading email settings…'}</p>;

  return (
    <div className="card mb">
      <h3 style={{ margin: '0 0 6px' }}>Your Gmail connection</h3>
      <p className="small muted" style={{ marginTop: 0 }}>Only you can see and approve emails captured from this mailbox. Use a Gmail app password, not your normal account password.</p>
      {message && <p className="small" role="status" style={{ color: 'var(--accent)' }}>{message}</p>}
      {status.lastError && <p className="small danger" role="alert">Last check: {status.lastError}</p>}
      {status.lastCheckedAt && <p className="small muted">Last checked: {new Date(status.lastCheckedAt).toLocaleString()}</p>}
      <form onSubmit={(event) => void save(event)}>
        <div className="field mb-3">
          <label htmlFor="gmail-username">Gmail address</label>
          <input id="gmail-username" type="email" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="name@gmail.com" autoComplete="username" required />
        </div>
        <div className="field mb-3">
          <label htmlFor="gmail-recipient">Import address</label>
          <input id="gmail-recipient" type="email" value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="name+trips@gmail.com" required />
          <span className="small muted">Only mail addressed to this exact address enters your review queue.</span>
        </div>
        <div className="field mb-3">
          <label htmlFor="gmail-app-password">Gmail app password</label>
          <input id="gmail-app-password" type="password" value={appPassword} onChange={(event) => setAppPassword(event.target.value)} placeholder={status.configured ? 'Leave blank to keep the saved password' : 'Enter your 16-character app password'} autoComplete="new-password" required={!status.configured} />
          <span className="small muted">Encrypted on the server and never displayed again.</span>
        </div>
        <div className="row mb-3" style={{ gap: 18, flexWrap: 'wrap' }}>
          <label className="small"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> Check this mailbox</label>
          <label className="small"><input type="checkbox" checked={unseenOnly} onChange={(event) => setUnseenOnly(event.target.checked)} /> Unread mail only</label>
        </div>
        <div className="field mb-3">
          <label htmlFor="gmail-frequency">Check every</label>
          <select id="gmail-frequency" value={pollMinutes} onChange={(event) => setPollMinutes(Number(event.target.value))}>
            {[5, 10, 15, 30, 60].map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}
          </select>
        </div>
        <details className="mb-3">
          <summary className="small" style={{ cursor: 'pointer' }}>Advanced settings</summary>
          <div className="field mt">
            <label htmlFor="gmail-allowlist">Allowed senders</label>
            <input id="gmail-allowlist" value={allowlist} onChange={(event) => setAllowlist(event.target.value)} placeholder="Optional, comma-separated" />
            <span className="small muted">Leave empty to review mail from any sender.</span>
          </div>
          <div className="field mt">
            <label htmlFor="gmail-log-level">Log detail</label>
            <select id="gmail-log-level" value={logLevel} onChange={(event) => setLogLevel(event.target.value)}>
              <option value="info">Summary</option><option value="debug">Per-message details</option>
            </select>
          </div>
        </details>
        <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          {status.configured && <button type="button" className="btn ghost danger" onClick={() => setConfirmDisconnect(true)} disabled={busy}>Disconnect</button>}
          <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Connecting…' : 'Save Gmail connection'}</button>
        </div>
      </form>
      {confirmDisconnect && (
        <ConfirmModal title="Disconnect Gmail" message="Stop checking this mailbox? Captured emails will stay in your review queue." confirmLabel="Disconnect" danger onConfirm={() => void disconnect()} onCancel={() => setConfirmDisconnect(false)} />
      )}
    </div>
  );
}
