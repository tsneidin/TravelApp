import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Check, X, Trash2, Inbox } from 'lucide-react';
import { apiGet, apiPost, apiDelete } from '../lib/api';
import type { EmailImport, Trip, ImportStatus } from '../lib/types';
import { Spinner } from '../components/Spinner';
import { Modal } from '../components/Modal';

const STATUSES: (ImportStatus | '')[] = ['', 'pending', 'parsed', 'needs_review', 'imported', 'ignored'];

const STATUS_BADGE: Record<ImportStatus, string> = {
  pending: 'badge',
  parsed: 'badge accent',
  needs_review: 'badge warn',
  imported: 'badge ok',
  ignored: 'badge',
  failed: 'badge danger',
};

interface EmailStatus {
  enabled: boolean;
  host: string;
  user: string;
  pollMinutes: number;
  recent24h: number;
  byStatus: { status: string; count: number }[];
}

export function EmailImports() {
  const [status, setStatus] = useState<EmailStatus | null>(null);
  const [imports, setImports] = useState<EmailImport[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [filter, setFilter] = useState<ImportStatus | ''>('');
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<EmailImport | null>(null);
  const [selTrip, setSelTrip] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    const [s, i, t] = await Promise.all([
      apiGet<EmailStatus>('/email/status'),
      apiGet<{ imports: EmailImport[] }>(`/email/imports${filter ? `?status=${filter}` : ''}`),
      apiGet<{ trips: Trip[] }>('/trips'),
    ]);
    setStatus(s);
    setImports(i.imports);
    setTrips(t.trips);
    if (!selTrip && t.trips.length) setSelTrip(t.trips[0].id);
  }, [filter, selTrip]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const poll = async () => {
    setBusy(true);
    setMsg('');
    try {
      const r = await apiPost<{ processed: number; imported: number }>('/email/poll');
      setMsg(`Poll complete: ${r.processed} processed, ${r.imported} imported.`);
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const openDetail = async (id: string) => {
    const r = await apiGet<{ item: EmailImport }>(`/email/imports/${id}`);
    setDetail(r.item);
    setMsg('');
  };

  const assign = async () => {
    if (!detail || !selTrip) return;
    setBusy(true);
    try {
      await apiPost(`/email/imports/${detail.id}/assign`, { tripId: selTrip });
      setMsg('Imported as booking.');
      setDetail(null);
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const ignore = async (id: string) => {
    await apiPost(`/email/imports/${id}/ignore`, { tripId: selTrip || undefined });
    await load();
  };

  const reparse = async (id: string) => {
    await apiPost(`/email/imports/${id}/reparse`, {});
    await load();
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this import?')) return;
    await apiDelete(`/email/imports/${id}`);
    await load();
  };

  if (loading) return <div className="app-shell"><Spinner label="Loading imports…" /></div>;
  if (!status) return null;

  return (
    <div className="app-shell">
      <div className="page-head">
        <div>
          <h1 className="page-title">Email imports</h1>
          <p className="page-sub">Monitor the inbox, parse confirmations, and file them into trips.</p>
        </div>
        <button className="btn primary" onClick={() => void poll()} disabled={busy}>
          <RefreshCw size={16} className={busy ? 'spin' : ''} /> {busy ? 'Checking…' : 'Check now'}
        </button>
      </div>

      {msg && <div className="small mt mb" style={{ color: 'var(--accent)', fontWeight: 700 }}>{msg}</div>}

      <div className="kpis">
        <div className="kpi">
          <div className="k-label">Monitor</div>
          <div className="k-value">{status.enabled ? 'On' : 'Off'}</div>
          <div className="k-sub">{status.user ? status.user : 'IMAP user not configured'} · every {status.pollMinutes} min</div>
        </div>
        <div className="kpi good">
          <div className="k-label">Last 24h</div>
          <div className="k-value">{status.recent24h}</div>
          <div className="k-sub">email imports received</div>
        </div>
        {status.byStatus?.map((b) => (
          <div className="kpi" key={b.status}>
            <div className="k-label">{b.status}</div>
            <div className="k-value" style={{ color: b.status === 'needs_review' ? 'var(--warn)' : b.status === 'imported' ? 'var(--ok)' : undefined }}>{b.count}</div>
            <div className="k-sub">messages</div>
          </div>
        ))}
      </div>

      <div className="row mb">
        <div className="seg" style={{ maxWidth: 620 }}>
          {STATUSES.map((s) => (
            <button key={s || 'all'} className={filter === s ? 'active' : ''} onClick={() => setFilter(s)}>
              {s === '' ? 'All' : s}
            </button>
          ))}
        </div>
      </div>

      {imports.length === 0 ? (
        <div className="empty-state">
          <div className="big"><Inbox size={20} style={{ verticalAlign: -4 }} /> Nothing here</div>
          <p>Forward booking confirmation emails to the monitored inbox. New mail appears here after the next poll.</p>
        </div>
      ) : (
        <div className="panel table-wrap">
          <table>
            <thead>
              <tr>
                <th>Status</th><th>Subject</th><th>From</th><th>Type</th><th>Received</th><th></th>
              </tr>
            </thead>
            <tbody>
              {imports.map((im) => (
                <tr key={im.id}>
                  <td><span className={STATUS_BADGE[im.status]}>{im.status}</span></td>
                  <td style={{ textAlign: 'left', maxWidth: 320 }}>
                    <button className="link" style={{ textAlign: 'left' }} onClick={() => void openDetail(im.id)}>
                      {im.subject}
                    </button>
                  </td>
                  <td className="small muted" style={{ textAlign: 'left' }}>{im.from}</td>
                  <td>{im.type || '—'}</td>
                  <td>{new Date(im.createdAt).toLocaleString()}</td>
                  <td>
                    <div className="row" style={{ gap: 4 }}>
                      {im.status !== 'imported' && (
                        <button className="btn sm ghost" onClick={() => void ignore(im.id)} title="Ignore"><X size={13} /></button>
                      )}
                      {im.status !== 'ignored' && (
                        <button className="btn sm ghost danger" onClick={() => void remove(im.id)} title="Delete"><Trash2 size={13} /></button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {detail && (
        <Modal title="Imported email" onClose={() => setDetail(null)} wide>
          <div className="row between mb">
            <span className="badge">{detail.status}</span>
            <span className="small muted">from {detail.from}</span>
          </div>
          <div className="mb">
            <b>{detail.subject}</b>
          </div>

          {detail.parsedPayload && (
            <div className="card mb">
              <div className="small muted" style={{ textTransform: 'uppercase', letterSpacing: '.07em', fontWeight: 700, marginBottom: 8 }}>
                Parsed ({detail.type})
              </div>
              <div className="small">
                <div><b>Title:</b> {detail.parsedPayload.title ?? '—'}</div>
                <div><b>Provider:</b> {detail.parsedPayload.provider ?? '—'}</div>
                <div><b>Reference:</b> {detail.parsedPayload.reference ?? '—'}</div>
                <div><b>Date:</b> {detail.parsedPayload.startAt ? new Date(detail.parsedPayload.startAt).toLocaleString() : '—'}</div>
                <div><b>Confidence:</b> {detail.parsedPayload.confidence ?? 0}</div>
              </div>
            </div>
          )}

          <div className="field small">
            <label>Import into trip</label>
            <select value={selTrip} onChange={(e) => setSelTrip(e.target.value)}>
              {trips.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>

          <div className="modal-actions">
            <button className="btn" onClick={() => void reparse(detail.id)}>Reparse</button>
            {detail.trip ? (
              <span className="muted small" style={{ alignSelf: 'center' }}>Assigned to {detail.trip.name}</span>
            ) : (
              <button className="btn primary" onClick={() => void assign()} disabled={busy || !selTrip}>
                <Check size={14} /> Import as booking
              </button>
            )}
          </div>

          <details className="mt" style={{ marginTop: 16 }}>
            <summary className="small" style={{ cursor: 'pointer', color: 'var(--muted)' }}>Show raw text</summary>
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11, opacity: 0.8, maxHeight: 260, overflow: 'auto', margin: '8px 0 0' }}>
              {detail.bodyText}
            </pre>
          </details>
        </Modal>
      )}
    </div>
  );
}