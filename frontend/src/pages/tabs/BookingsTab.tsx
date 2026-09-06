import { useState } from 'react';
import { Plus, Trash2, FileText, StickyNote, Pencil, Hotel, Plane, Car, Compass } from 'lucide-react';
import { apiPost, apiPatch, apiDelete } from '../../lib/api';
import { endForStart } from '../../lib/dateRange';
import type { Trip, Booking, BookingType } from '../../lib/types';
import { Modal, ConfirmModal } from '../../components/Modal';
import { AuditBadge } from '../../components/AuditBadge';

const TYPES: { value: BookingType; label: string; hint: string; startLabel: string; endLabel: string }[] = [
  { value: 'hotel', label: 'Hotel / Stay', hint: 'Hotel, resort, villa, Airbnb', startLabel: 'Check-in Date & Time', endLabel: 'Check-out Date & Time' },
  { value: 'flight', label: 'Flight', hint: 'Airline, flight number, route', startLabel: 'Departure Date & Time', endLabel: 'Arrival Date & Time' },
  { value: 'car', label: 'Car / Transport', hint: 'Rental company, pickup details', startLabel: 'Pick-up Date & Time', endLabel: 'Drop-off Date & Time' },
  { value: 'activity', label: 'Activity / Tour', hint: 'Tour, tickets, admissions', startLabel: 'Start Date & Time', endLabel: 'End Date & Time' },
];

interface BookingForm {
  type: BookingType;
  title: string;
  provider: string;
  reference: string;
  startAt: string;
  endAt: string;
}

function toDatetimeLocal(val?: string | null): string {
  if (!val) return '';
  const d = new Date(val);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  return `${y}-${m}-${day}T${hours}:${minutes}`;
}

function formatBookingDateTime(val?: string | null): string {
  if (!val) return '—';
  const d = new Date(val);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getBookingTypeIcon(t: BookingType) {
  switch (t) {
    case 'hotel':
      return <Hotel size={13} style={{ color: 'var(--accent)', marginRight: 4 }} />;
    case 'flight':
      return <Plane size={13} style={{ color: '#818cf8', marginRight: 4 }} />;
    case 'car':
      return <Car size={13} style={{ color: '#facc15', marginRight: 4 }} />;
    default:
      return <Compass size={13} style={{ color: '#10b981', marginRight: 4 }} />;
  }
}

export function BookingsTab({ trip, reload }: { trip: Trip; reload: () => Promise<void> }) {
  const bookings = trip.bookings ?? [];
  const [open, setOpen] = useState(false);
  const [editingBooking, setEditingBooking] = useState<Booking | null>(null);
  const [busy, setBusy] = useState(false);
  const [rawBooking, setRawBooking] = useState<Booking | null>(null);
  const [noteBooking, setNoteBooking] = useState<Booking | null>(null);
  const [deletingBooking, setDeletingBooking] = useState<Booking | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [newNote, setNewNote] = useState('');
  const [form, setForm] = useState<BookingForm>({
    type: 'hotel',
    title: '',
    provider: '',
    reference: '',
    startAt: '',
    endAt: '',
  });

  const openAdd = () => {
    setEditingBooking(null);
    setForm({
      type: 'hotel',
      title: '',
      provider: '',
      reference: '',
      startAt: '',
      endAt: '',
    });
    setOpen(true);
  };

  const openEdit = (b: Booking) => {
    setEditingBooking(b);
    setForm({
      type: b.type,
      title: b.title,
      provider: b.provider || '',
      reference: b.reference || '',
      startAt: toDatetimeLocal(b.startAt),
      endAt: toDatetimeLocal(b.endAt),
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.title) return;
    setBusy(true);
    try {
      if (editingBooking) {
        await apiPatch(`/trips/${trip.id}/bookings/${editingBooking.id}`, {
          ...form,
          startAt: form.startAt ? new Date(form.startAt).toISOString() : null,
          endAt: form.endAt ? new Date(form.endAt).toISOString() : null,
        });
      } else {
        await apiPost(`/trips/${trip.id}/bookings`, {
          ...form,
          startAt: form.startAt ? new Date(form.startAt).toISOString() : undefined,
          endAt: form.endAt ? new Date(form.endAt).toISOString() : undefined,
        });
      }
      setOpen(false);
      setEditingBooking(null);
      setForm({ type: 'hotel', title: '', provider: '', reference: '', startAt: '', endAt: '' });
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const remove = (b: Booking) => {
    setDeletingBooking(b);
  };

  const bookingNotes = (booking: Booking): string[] => {
    const value = booking.details && typeof booking.details === 'object'
      ? (booking.details as Record<string, unknown>).notes
      : undefined;
    return Array.isArray(value) ? value.filter((note): note is string => typeof note === 'string') : [];
  };

  const openNotes = (booking: Booking) => {
    setNoteBooking(booking);
    setNotes(bookingNotes(booking));
    setNewNote('');
  };

  const saveNotes = async () => {
    if (!noteBooking) return;
    setBusy(true);
    try {
      const existing = noteBooking.details && typeof noteBooking.details === 'object'
        ? noteBooking.details
        : {};
      const finalNotes = [...notes, ...(newNote.trim() ? [newNote.trim()] : [])]
        .map((note) => note.trim())
        .filter(Boolean);
      await apiPatch(`/trips/${trip.id}/bookings/${noteBooking.id}`, {
        details: { ...existing, notes: finalNotes },
      });
      setNoteBooking(null);
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const typeConfig = TYPES.find((x) => x.value === form.type) ?? TYPES[0];

  const hasRaw = (b: Booking) =>
    typeof b.details === 'object' && b.details != null && typeof b.details.sourceRaw === 'string';

  const rawText = (b: Booking) => (hasRaw(b) ? (b.details as Record<string, unknown>).sourceRaw as string : '');

  return (
    <div>
      <div className="row between">
        <h2 className="panel-title">Bookings & Reservations</h2>
        <button className="btn sm primary" onClick={openAdd}><Plus size={14} /> Add booking</button>
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
                <th>Type</th>
                <th>Title</th>
                <th>Provider</th>
                <th>Confirmation #</th>
                <th>Starts / Check-in</th>
                <th>Ends / Check-out</th>
                <th>Notes</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((b) => (
                <tr key={b.id}>
                  <td>
                    <span className="badge" style={{ display: 'inline-flex', alignItems: 'center' }}>
                      {getBookingTypeIcon(b.type)}
                      {TYPES.find((x) => x.value === b.type)?.label ?? b.type}
                    </span>
                  </td>
                  <td style={{ textAlign: 'left' }}>
                    <div
                      style={{ fontWeight: 600, cursor: 'pointer', color: 'var(--text)' }}
                      onClick={() => openEdit(b)}
                      title="Click to edit reservation"
                    >
                      {b.title}
                    </div>
                    {(b.createdBy || b.updatedBy) && (
                      <div style={{ marginTop: 4 }}>
                        <AuditBadge createdBy={b.createdBy} createdAt={b.createdAt} updatedBy={b.updatedBy} updatedAt={b.updatedAt} />
                      </div>
                    )}
                  </td>
                  <td>{b.provider || '—'}</td>
                  <td>
                    {b.reference ? (
                      <span className="badge" style={{ fontWeight: 700 }}>{b.reference}</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td style={{ fontSize: '0.84rem' }}>{formatBookingDateTime(b.startAt)}</td>
                  <td style={{ fontSize: '0.84rem' }}>{formatBookingDateTime(b.endAt)}</td>
                  <td>{bookingNotes(b).length || '—'}</td>
                  <td>
                    <div className="row" style={{ gap: 4 }}>
                      <button className="btn sm ghost" title="Edit booking details" onClick={() => openEdit(b)}>
                        <Pencil size={13} />
                      </button>
                      <button className="btn sm ghost" title="Add or edit booking notes" onClick={() => openNotes(b)}>
                        <StickyNote size={13} /> {bookingNotes(b).length || ''}
                      </button>
                      {hasRaw(b) && (
                        <button className="btn sm ghost" title="View raw source text" onClick={() => setRawBooking(b)}>
                          <FileText size={13} />
                        </button>
                      )}
                      <button className="btn sm ghost danger" title="Delete booking" onClick={() => remove(b)}><Trash2 size={13} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <Modal title={editingBooking ? `Edit ${typeConfig.label}` : 'Add Booking'} onClose={() => setOpen(false)}>
          <div className="field small">
            <label>Booking Type</label>
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as BookingType })}
            >
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Title / Property Name</label>
            <input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder={typeConfig.hint}
              autoFocus
            />
          </div>
          <div className="grid grid-2">
            <div className="field">
              <label>Provider / Company / Host</label>
              <input
                value={form.provider}
                onChange={(e) => setForm({ ...form, provider: e.target.value })}
                placeholder="e.g. Marriott, Airbnb, Delta"
              />
            </div>
            <div className="field">
              <label>Confirmation # / Reference</label>
              <input
                value={form.reference}
                onChange={(e) => setForm({ ...form, reference: e.target.value })}
                placeholder="e.g. ABC123"
              />
            </div>
          </div>
          <div className="grid grid-2">
            <div className="field">
              <label>{typeConfig.startLabel}</label>
              <input
                type="datetime-local"
                value={form.startAt}
                onChange={(e) => {
                  const startAt = e.target.value;
                  setForm({ ...form, startAt, endAt: endForStart(startAt, form.endAt) });
                }}
              />
            </div>
            <div className="field">
              <label>{typeConfig.endLabel}</label>
              <input
                type="datetime-local"
                min={form.startAt || undefined}
                value={form.endAt}
                onChange={(e) => setForm({ ...form, endAt: e.target.value })}
              />
            </div>
          </div>
          <div className="modal-actions">
            <button className="btn primary" onClick={save} disabled={busy || !form.title}>
              {busy ? 'Saving…' : editingBooking ? 'Save Changes' : 'Add Booking'}
            </button>
            <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </Modal>
      )}

      {noteBooking && (
        <Modal title={`Notes — ${noteBooking.title}`} onClose={() => setNoteBooking(null)} wide>
          <div style={{ display: 'grid', gap: 10 }}>
            {notes.map((note, index) => (
              <div className="row" key={index} style={{ alignItems: 'flex-start' }}>
                <textarea
                  rows={3}
                  value={note}
                  aria-label={`Booking note ${index + 1}`}
                  onChange={(event) => setNotes((current) => current.map((item, i) => i === index ? event.target.value : item))}
                />
                <button className="btn sm ghost danger" title="Delete note" onClick={() => setNotes((current) => current.filter((_, i) => i !== index))}>
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
            <div className="field">
              <label>Add another note</label>
              <textarea rows={3} value={newNote} onChange={(event) => setNewNote(event.target.value)} placeholder="Reservation detail, reminder, special request…" />
            </div>
          </div>
          <div className="modal-actions">
            <button className="btn primary" onClick={() => void saveNotes()} disabled={busy}>Save notes</button>
            <button className="btn" onClick={() => setNoteBooking(null)}>Cancel</button>
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
            <button className="btn primary" onClick={() => setRawBooking(null)}>Close</button>
          </div>
        </Modal>
      )}

      {deletingBooking && (
        <ConfirmModal
          title="Remove booking"
          message={`Remove booking "${deletingBooking.title}"?`}
          confirmLabel="Delete"
          danger
          onConfirm={async () => {
            await apiDelete(`/trips/${trip.id}/bookings/${deletingBooking.id}`);
            setDeletingBooking(null);
            await reload();
          }}
          onCancel={() => setDeletingBooking(null)}
        />
      )}
    </div>
  );
}