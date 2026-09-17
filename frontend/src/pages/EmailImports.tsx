import { useTimeFormat, formatDateTime, formatLocalDateTime } from '../lib/time';
import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Check, X, Trash2, Inbox } from 'lucide-react';
import { apiGet, apiPost, apiDelete } from '../lib/api';
import type { EmailImport, Trip, ImportStatus } from '../lib/types';
import { Spinner } from '../components/Spinner';
import { Modal, ConfirmModal } from '../components/Modal';
import { EmailConnectionSettings } from '../components/EmailConnectionSettings';
import type { EmailConnectionStatus } from '../components/EmailConnectionSettings';

const STATUSES: (ImportStatus | '')[] = ['', 'pending', 'parsed', 'needs_review', 'imported', 'ignored'];

const STATUS_BADGE: Record<ImportStatus, string> = {
  pending: 'badge',
  parsed: 'badge accent',
  needs_review: 'badge warn',
  imported: 'badge ok',
  ignored: 'badge',
  failed: 'badge danger',
};

const STATUS_LABEL: Record<ImportStatus, string> = {
  pending: 'Review needed',
  parsed: 'Ready to review',
  needs_review: 'Check details',
  imported: 'Added to trip',
  ignored: 'Ignored',
  failed: 'Failed',
};

export function EmailImports() {
  const timeFormat = useTimeFormat();
  const [status, setStatus] = useState<EmailConnectionStatus | null>(null);
  const [showConnection, setShowConnection] = useState(false);
  const [imports, setImports] = useState<EmailImport[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [filter, setFilter] = useState<ImportStatus | ''>('');
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<EmailImport | null>(null);
  const [selTrip, setSelTrip] = useState('');
  const [newTripName, setNewTripName] = useState('');
  const [newTripDestination, setNewTripDestination] = useState('');
  const [reparsing, setReparsing] = useState(false);
  const [reparseResult, setReparseResult] = useState('');
  const [reparsedId, setReparsedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [deletingImportId, setDeletingImportId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [s, i, t] = await Promise.all([
      apiGet<EmailConnectionStatus>('/email/status'),
      apiGet<{ imports: EmailImport[] }>(`/email/imports${filter ? `?status=${filter}` : ''}`),
      apiGet<{ trips: Trip[] }>('/trips'),
    ]);
    setStatus(s);
    setImports(i.imports);
    setTrips(t.trips);
    if (!selTrip) setSelTrip(t.trips[0]?.id || '__new__');
  }, [filter, selTrip]);

  useEffect(() => {
    setLoading(true);
    load().catch((error) => setMsg((error as Error).message)).finally(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    const refresh = () => void load().catch((error) => setMsg((error as Error).message));
    window.addEventListener('travelapp:email-config-changed', refresh);
    return () => window.removeEventListener('travelapp:email-config-changed', refresh);
  }, [load]);

  const poll = async () => {
    setBusy(true);
    setMsg('');
    try {
      const r = await apiPost<{
        processed: number;
        imported: number;
        unreadOnly: boolean;
        skipped: { recipientMismatch: number; alreadyImported: number; senderFiltered: number };
      }>('/email/poll');
      setMsg(`Checked ${r.processed} ${r.unreadOnly ? 'unread' : ''} messages: ${r.imported} captured for review, ${r.skipped.recipientMismatch} wrong address, ${r.skipped.alreadyImported} already captured, ${r.skipped.senderFiltered} blocked by sender filter.`);
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const openDetail = async (id: string) => {
    try {
      const r = await apiGet<{ item: EmailImport }>(`/email/imports/${id}`);
      setDetail(r.item);
      setMsg('');
      setReparseResult('');
      setReparsedId(null);
      setNewTripName(`${r.item.parsedPayload?.candidates?.[0]?.title || r.item.parsedPayload?.title || r.item.subject} trip`.slice(0, 120));
      setNewTripDestination('');
    } catch (error) {
      setMsg((error as Error).message);
    }
  };

  const assign = async () => {
    if (!detail || !selTrip || (selTrip === '__new__' && !newTripName.trim())) return;
    setBusy(true);
    try {
      const result = await apiPost<{ bookings: unknown[]; skipped: number; tripId: string; trip?: { name: string } | null; itineraryEntries: number; budgetEntries: number; emailDocuments: number }>(`/email/imports/${detail.id}/assign`, selTrip === '__new__'
        ? { newTrip: { name: newTripName.trim(), destination: newTripDestination.trim() } }
        : { tripId: selTrip });
      setMsg(`${result.trip ? `Created ${result.trip.name}. ` : ''}${result.bookings.length} booking${result.bookings.length === 1 ? '' : 's'} added, ${result.itineraryEntries} itinerary item${result.itineraryEntries === 1 ? '' : 's'}, ${result.budgetEntries} budget item${result.budgetEntries === 1 ? '' : 's'}, and ${result.emailDocuments} email document${result.emailDocuments === 1 ? '' : 's'} attached${result.skipped ? `; ${result.skipped} existing booking${result.skipped === 1 ? '' : 's'} matched` : ''}.`);
      setDetail(null);
      setSelTrip(result.tripId);
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const ignore = async (id: string) => {
    await apiPost(`/email/imports/${id}/ignore`, {});
    await load();
  };

  const reparse = async (id: string) => {
    setReparsing(true);
    setReparseResult('Reparsing email…');
    try {
      const result = await apiPost<{ item: EmailImport; parser: string; reservations: number; changed: boolean }>(`/email/imports/${id}/reparse`, {});
      setDetail(result.item);
      setReparsedId(id);
      setReparseResult(`${result.parser}: ${result.reservations} reservation${result.reservations === 1 ? '' : 's'} found. ${result.item.error || (result.changed ? 'The extracted details changed.' : 'The extracted details are unchanged.')}${result.item.status === 'imported' ? ' The saved booking has not been changed.' : ''}`);
      await load();
    } catch (error) {
      setReparseResult(`Reparse failed: ${(error as Error).message}`);
    } finally {
      setReparsing(false);
    }
  };

  const applyDates = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      const result = await apiPost<{ updated: number }>(`/email/imports/${detail.id}/apply-dates`, {});
      setMsg(`Updated dates on ${result.updated} existing booking${result.updated === 1 ? '' : 's'}.`);
      setDetail(null);
      await load();
    } catch (error) {
      setReparseResult(`Could not update booking dates: ${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const remove = (id: string) => {
    setDeletingImportId(id);
  };

  if (loading) return <div className="app-shell"><Spinner label="Loading imports…" /></div>;
  if (!status) return null;

  return (
    <div className="app-shell">
      <div className="page-head">
        <div>
          <h1 className="page-title">Email inbox</h1>
          <p className="page-sub">Review your booking emails before adding anything to a trip.</p>
        </div>
        <div className="row">
          <button className="btn" onClick={() => setShowConnection((value) => !value)}>{showConnection ? 'Hide settings' : 'Gmail settings'}</button>
          <button className="btn primary" onClick={() => void poll()} disabled={busy || !status.enabled || !status.configured}>
            <RefreshCw size={16} className={busy ? 'spin' : ''} /> {busy ? 'Checking…' : 'Check now'}
          </button>
        </div>
      </div>

      {msg && <div className="small mt mb" style={{ color: 'var(--accent)', fontWeight: 700 }}>{msg}</div>}
      {status.lastError && <div className="small danger mb" role="alert">Last mailbox check failed: {status.lastError}</div>}

      {(!status.configured || showConnection) && <EmailConnectionSettings />}

      <div className="kpis">
        <div className="kpi">
          <div className="k-label">Monitor</div>
          <div className="k-value">{status.enabled && status.configured ? 'On' : 'Off'}</div>
          <div className="k-sub">{status.recipient || 'Connect Gmail above'} · {status.folder} · {status.unseenOnly ? 'unread only' : 'all mail'} · every {status.pollMinutes} min</div>
        </div>
        <div className="kpi good">
          <div className="k-label">Last 24h</div>
          <div className="k-value">{status.recent24h}</div>
          <div className="k-sub">emails captured for review</div>
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
              {s === '' ? 'All' : STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      </div>

      {imports.length === 0 ? (
        <div className="empty-state">
          <div className="big"><Inbox size={20} style={{ verticalAlign: -4 }} /> Nothing here</div>
          <p>{status.configured ? `Send booking confirmations to ${status.recipient}. New mail appears here after the next check.` : 'Connect your Gmail account above to capture booking confirmations.'}</p>
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
                  <td><span className={STATUS_BADGE[im.status]}>{STATUS_LABEL[im.status]}</span></td>
                  <td style={{ textAlign: 'left', maxWidth: 320 }}>
                    <button className="link" style={{ textAlign: 'left' }} onClick={() => void openDetail(im.id)}>
                      {im.subject}
                    </button>
                  </td>
                  <td className="small muted" style={{ textAlign: 'left' }}>{im.from}</td>
                  <td>{im.type || '—'}</td>
                  <td>{formatDateTime(im.createdAt, timeFormat)}</td>
                  <td>
                    <div className="row" style={{ gap: 4 }}>
                      {im.status !== 'ignored' && im.status !== 'imported' && (
                        <button className="btn sm ghost" onClick={() => void ignore(im.id)} title="Ignore"><X size={13} /></button>
                      )}
                      {im.status !== 'imported' && (
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
        <Modal title="Review booking email" onClose={() => setDetail(null)} wide>
          <div className="row between mb">
            <span className="badge">{STATUS_LABEL[detail.status]}</span>
            <span className="small muted">from {detail.from}</span>
          </div>
          <div className="mb">
            <b>{detail.subject}</b>
          </div>
          {reparseResult && <p className="small" role="status">{reparseResult}</p>}
          {detail.error && !reparseResult && <p className="small" role="alert">{detail.error}</p>}

          {detail.parsedPayload?.candidates?.length ? (
            <div className="card mb">
              <div className="small muted" style={{ textTransform: 'uppercase', letterSpacing: '.07em', fontWeight: 700, marginBottom: 8 }}>
                {detail.parsedPayload.source === 'email-evidence' ? 'Receipt details' : detail.parsedPayload.source === 'llm' ? 'AI extraction' : 'KItinerary'} found {detail.parsedPayload.candidates.length} reservation{detail.parsedPayload.candidates.length === 1 ? '' : 's'}
              </div>
              {detail.parsedPayload.candidates.map((candidate, index) => (
                <div className="small" key={`${candidate.reference || candidate.title}-${index}`} style={{ padding: '8px 0', borderTop: index ? '1px solid var(--border)' : undefined }}>
                  <div><b>{candidate.title}</b> {candidate.cancelled && <span className="badge warn">Cancellation</span>}</div>
                  <div>{candidate.type} · {candidate.reference || 'No reference'}</div>
                  {candidate.startAt && <div>Check-in/start: {formatLocalDateTime(candidate.details?.localStartAt || candidate.startAt, timeFormat)}</div>}
                  {candidate.endAt && <div>Check-out/end: {formatLocalDateTime(candidate.details?.localEndAt || candidate.endAt, timeFormat)}</div>}
                  {candidate.price !== undefined && candidate.currency && <div>{candidate.currency} {candidate.price.toFixed(2)}</div>}
                </div>
              ))}
            </div>
          ) : detail.parsedPayload && (
            <div className="card mb">
              <div className="small muted" style={{ textTransform: 'uppercase', letterSpacing: '.07em', fontWeight: 700, marginBottom: 8 }}>
                {detail.parsedPayload.source === 'fallback' ? 'TravelApp fallback' : 'Parsed'} ({detail.type})
              </div>
              <div className="small">
                <div><b>Title:</b> {detail.parsedPayload.title ?? '—'}</div>
                <div><b>Provider:</b> {detail.parsedPayload.provider ?? '—'}</div>
                <div><b>Reference:</b> {detail.parsedPayload.reference ?? '—'}</div>
                <div><b>Check-in/start:</b> {detail.parsedPayload.startAt ? formatLocalDateTime(detail.parsedPayload.details?.localStartAt || detail.parsedPayload.startAt, timeFormat) : '—'}</div>
                <div><b>Check-out/end:</b> {detail.parsedPayload.endAt ? formatLocalDateTime(detail.parsedPayload.details?.localEndAt || detail.parsedPayload.endAt, timeFormat) : '—'}</div>
                <div><b>Confidence:</b> {detail.parsedPayload.confidence ?? 0}</div>
              </div>
            </div>
          )}

          {!detail.trip && detail.status !== 'ignored' && <div className="field small">
            <label htmlFor="email-trip">Add to trip</label>
            <select id="email-trip" value={selTrip} onChange={(e) => setSelTrip(e.target.value)}>
              {trips.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              <option value="__new__">Create a new trip</option>
            </select>
            {selTrip === '__new__' && <div className="grid grid-2 mt">
              <div className="field"><label htmlFor="email-new-trip-name">Trip name</label><input id="email-new-trip-name" value={newTripName} onChange={(event) => setNewTripName(event.target.value)} maxLength={120} required /></div>
              <div className="field"><label htmlFor="email-new-trip-destination">Destination</label><input id="email-new-trip-destination" value={newTripDestination} onChange={(event) => setNewTripDestination(event.target.value)} maxLength={200} placeholder="Optional" /></div>
            </div>}
          </div>}

          <div className="modal-actions">
            <button className="btn" onClick={() => setDetail(null)}>Close</button>
            {detail.status !== 'ignored' && <button className="btn" onClick={() => void reparse(detail.id)} disabled={reparsing || busy}>{reparsing ? 'Reparsing…' : 'Reparse email'}</button>}
            {detail.trip ? (
              <>
                <span className="muted small" style={{ alignSelf: 'center' }}>Assigned to {detail.trip.name}</span>
                {detail.status === 'imported' && reparsedId === detail.id && !detail.error && (detail.parsedPayload?.startAt || detail.parsedPayload?.endAt || detail.parsedPayload?.candidates?.some((candidate) => candidate.startAt || candidate.endAt)) && <button className="btn primary" onClick={() => void applyDates()} disabled={busy || reparsing}>Apply dates to booking</button>}
              </>
            ) : detail.status !== 'ignored' ? (
              <button className="btn primary" onClick={() => void assign()} disabled={busy || reparsing || !selTrip || (selTrip === '__new__' && !newTripName.trim()) || !detail.parsedPayload || Boolean(detail.error) || Boolean(detail.parsedPayload?.candidates?.some((candidate) => candidate.cancelled))}>
                <Check size={14} /> Add booking, itinerary, and budget
              </button>
            ) : null}
          </div>

          <details className="mt" style={{ marginTop: 16 }}>
            <summary className="small" style={{ cursor: 'pointer', color: 'var(--muted)' }}>Show raw text</summary>
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11, opacity: 0.8, maxHeight: 260, overflow: 'auto', margin: '8px 0 0' }}>
              {detail.bodyText}
            </pre>
          </details>
        </Modal>
      )}

      {deletingImportId && (
        <ConfirmModal
          title="Delete import"
          message="Delete this import?"
          confirmLabel="Delete"
          danger
          onConfirm={async () => {
            await apiDelete(`/email/imports/${deletingImportId}`);
            setDeletingImportId(null);
            await load();
          }}
          onCancel={() => setDeletingImportId(null)}
        />
      )}
    </div>
  );
}
