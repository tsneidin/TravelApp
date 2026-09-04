import { useState } from 'react';
import { Plus, Trash2, FileText } from 'lucide-react';
import { apiPost, apiDelete } from '../../lib/api';
import type { Trip, Booking, BookingType } from '../../lib/types';
import { Modal } from '../../components/Modal';

const TYPES: { value: BookingType; label: string; hint: string }[] = [
  { value: 'flight', label: 'Flight', hint: 'Airline, flight number, times' },
  { value: 'hotel', label: 'Hotel / stay', hint: 'Property, check-in/out' },
  { value: 'car', label: 'Car / transport', hint: 'Rental company, pickup details' },
  { value: 'activity', label: 'Activity / tour', hint: 'Tour, tickets, admissions' },
];

interface BookingForm {
  type: BookingType;
  title: string;
  provider: string;
  reference: string;
  startAt: string;
  endAt: string;
}

export function BookingsTab({ trip, reload }: { trip: Trip; reload: () => Promise<void> }) {
  const bookings = trip.bookings ?? [];
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rawBooking, setRawBooking] = useState<Booking | null>(null);
  const [form, setForm] = useState<BookingForm>({ type: 'hotel', title: '', provider: '', reference: '', startAt: '', endAt: '' });

  const save = async () => {
    if (!form.title) return;
    setBusy(true);
    try {
      await apiPost(`/trips/${trip.id}/bookings`, {
        ...form,
        startAt: form.startAt || undefined,
        endAt: form.endAt || undefined,
      });
      setOpen(false);
      setForm({ type: 'hotel', title: '', provider: '', reference: '', startAt: '', endAt: '' });
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (b: Booking) => {
    if (!confirm(`Remove booking "${b.title}"?`)) return;
    await apiDelete(`/trips/${trip.id}/bookings/${b.id}`);
    await reload();
  };

  const typeLabel = (t: BookingType) => TYPES.find((x) => x.value === t)?.label ?? t;

  const hasRaw = (b: Booking) =>
    typeof b.details === 'object' && b.details != null && typeof b.details.sourceRaw === 'string';

  const rawText = (b: Booking) => (hasRaw(b) ? (b.details as Record<string, unknown>).sourceRaw as string : '');

  return (
    <div>
      <div className="row between">
        <h2 className="panel-title">Bookings</h2>
        <button className="btn sm" onClick={() => setOpen(true)}><Plus size={14} /> Add booking</button>
      </div>

      {bookings.length === 0 ? (
        <div className="empty-state">
          <div className="big">No bookings yet</div>
          <p>Add manually, or forward confirmation emails to the monitored inbox to import them.</p>
        </div>
      ) : (
        <div className="panel table-wrap">
          <table>
            <thead>
              <tr>
                <th>Type</th><th>Title</th><th>Provider</th><th>Reference</th><th>Starts</th><th></th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((b) => (
                <tr key={b.id}>
                  <td><span className="badge">{typeLabel(b.type)}</span></td>
                  <td style={{ textAlign: 'left' }}>{b.title}</td>
                  <td>{b.provider || '—'}</td>
                  <td>{b.reference || '—'}</td>
                  <td>{b.startAt ? new Date(b.startAt).toLocaleDateString() : '—'}</td>
                  <td>
                    <div className="row" style={{ gap: 4 }}>
                      {hasRaw(b) && (
                        <button className="btn sm ghost" title="View raw source text" onClick={() => setRawBooking(b)}>
                          <FileText size={13} />
                        </button>
                      )}
                      <button className="btn sm ghost danger" onClick={() => remove(b)}><Trash2 size={13} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <Modal title="Add booking" onClose={() => setOpen(false)}>
          <div className="field small">
            <label>Type</label>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as BookingType })}>
              {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Title</label>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={TYPES.find((t) => t.value === form.type)?.hint} autoFocus />
          </div>
          <div className="grid grid-2">
            <div className="field">
              <label>Provider / company</label>
              <input value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} placeholder="e.g. ANA" />
            </div>
            <div className="field">
              <label>Confirmation #</label>
              <input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="e.g. ABC123" />
            </div>
          </div>
          <div className="grid grid-2">
            <div className="field">
              <label>Starts</label>
              <input type="datetime-local" value={form.startAt} onChange={(e) => setForm({ ...form, startAt: e.target.value })} />
            </div>
            <div className="field">
              <label>Ends</label>
              <input type="datetime-local" value={form.endAt} onChange={(e) => setForm({ ...form, endAt: e.target.value })} />
            </div>
          </div>
          <div className="modal-actions">
            <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn primary" onClick={save} disabled={busy || !form.title}>Save</button>
          </div>
        </Modal>
      )}

      {rawBooking && (
        <Modal title={`Raw source — ${rawBooking.title}`} onClose={() => setRawBooking(null)} wide>
          <div className="small muted mb">{rawBooking.type} · {rawBooking.provider || '—'} {rawBooking.reference ? `· ref ${rawBooking.reference}` : ''}</div>
          <pre
            style={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontFamily: 'ui-monospace, Consolas, monospace',
              fontSize: 12,
              lineHeight: 1.55,
              background: 'rgba(11,18,32,.6)',
              border: '1px solid var(--line)',
              borderRadius: 8,
              padding: 12,
              maxHeight: 420,
              overflow: 'auto',
            }}
          >
            {rawText(rawBooking)}
          </pre>
          <div className="modal-actions">
            <button className="btn" onClick={() => setRawBooking(null)}>Close</button>
          </div>
        </Modal>
      )}
    </div>
  );
}