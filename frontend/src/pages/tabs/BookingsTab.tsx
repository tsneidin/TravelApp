import { useState, useRef } from 'react';
import {
  Plus,
  Trash2,
  FileText,
  StickyNote,
  Pencil,
  Hotel,
  Plane,
  Car,
  Compass,
  Paperclip,
  UploadCloud,
  X,
  Eye,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Check,
} from 'lucide-react';
import { apiPost, apiPatch, apiDelete, uploadAiDocument } from '../../lib/api';
import { endForStart } from '../../lib/dateRange';
import type { Trip, Booking, BookingType, BookingAttachment } from '../../lib/types';
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
  notes: string[];
  attachments: BookingAttachment[];
  sourceRaw: string;
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

function formatFileSize(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

function bookingNotes(booking: Booking): string[] {
  const value = booking.details && typeof booking.details === 'object'
    ? (booking.details as Record<string, unknown>).notes
    : undefined;
  return Array.isArray(value) ? value.filter((note): note is string => typeof note === 'string') : [];
}

function bookingAttachments(booking: Booking): BookingAttachment[] {
  const value = booking.details && typeof booking.details === 'object'
    ? (booking.details as Record<string, unknown>).attachments
    : undefined;
  return Array.isArray(value) ? value.filter((att): att is BookingAttachment => typeof att === 'object' && att !== null) : [];
}

const hasRaw = (b: Booking) =>
  typeof b.details === 'object' && b.details != null && typeof (b.details as Record<string, unknown>).sourceRaw === 'string' && Boolean((b.details as Record<string, unknown>).sourceRaw);

const rawText = (b: Booking) => (hasRaw(b) ? ((b.details as Record<string, unknown>).sourceRaw as string) : '');

export function BookingsTab({ trip, reload }: { trip: Trip; reload: () => Promise<void> }) {
  const bookings = trip.bookings ?? [];
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [open, setOpen] = useState(false);
  const [editingBooking, setEditingBooking] = useState<Booking | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const [showPasteArea, setShowPasteArea] = useState(false);
  const [autoFillSuccess, setAutoFillSuccess] = useState(false);

  const [rawBooking, setRawBooking] = useState<Booking | null>(null);
  const [viewingNotesBooking, setViewingNotesBooking] = useState<Booking | null>(null);
  const [viewingAttachmentsBooking, setViewingAttachmentsBooking] = useState<Booking | null>(null);
  const [previewDoc, setPreviewDoc] = useState<BookingAttachment | null>(null);
  const [deletingBooking, setDeletingBooking] = useState<Booking | null>(null);

  const [newNote, setNewNote] = useState('');
  const [form, setForm] = useState<BookingForm>({
    type: 'hotel',
    title: '',
    provider: '',
    reference: '',
    startAt: '',
    endAt: '',
    notes: [],
    attachments: [],
    sourceRaw: '',
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
      notes: [],
      attachments: [],
      sourceRaw: '',
    });
    setNewNote('');
    setShowPasteArea(false);
    setAutoFillSuccess(false);
    setOpen(true);
  };

  const openEdit = (b: Booking) => {
    setEditingBooking(b);
    const existingNotes = bookingNotes(b);
    const existingAttachments = bookingAttachments(b);
    const existingRaw = rawText(b);
    setForm({
      type: b.type,
      title: b.title,
      provider: b.provider || '',
      reference: b.reference || '',
      startAt: toDatetimeLocal(b.startAt),
      endAt: toDatetimeLocal(b.endAt),
      notes: [...existingNotes],
      attachments: [...existingAttachments],
      sourceRaw: existingRaw,
    });
    setNewNote('');
    setShowPasteArea(Boolean(existingRaw));
    setAutoFillSuccess(false);
    setOpen(true);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingDoc(true);
    try {
      const res = await uploadAiDocument(trip.id, file);
      if (res && res.document) {
        const doc = res.document;
        const newAtt: BookingAttachment = {
          filename: doc.filename,
          fileType: doc.fileType,
          size: doc.size,
          text: doc.text,
          summary: doc.summary,
        };
        setForm((prev) => ({
          ...prev,
          attachments: [...prev.attachments, newAtt],
          sourceRaw: prev.sourceRaw || doc.text || '',
        }));
        if (!showPasteArea && doc.text) {
          setShowPasteArea(true);
        }
      }
    } catch (err) {
      console.error('Failed to upload document', err);
      alert('Failed to upload document. Please try again.');
    } finally {
      setUploadingDoc(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleAddNote = () => {
    if (!newNote.trim()) return;
    setForm((prev) => ({
      ...prev,
      notes: [...prev.notes, newNote.trim()],
    }));
    setNewNote('');
  };

  const handleRemoveNote = (idx: number) => {
    setForm((prev) => ({
      ...prev,
      notes: prev.notes.filter((_, i) => i !== idx),
    }));
  };

  const handleUpdateNote = (idx: number, val: string) => {
    setForm((prev) => ({
      ...prev,
      notes: prev.notes.map((n, i) => (i === idx ? val : n)),
    }));
  };

  const handleRemoveAttachment = (idx: number) => {
    setForm((prev) => ({
      ...prev,
      attachments: prev.attachments.filter((_, i) => i !== idx),
    }));
  };

  const tryAutoFillFromText = () => {
    const text = form.sourceRaw;
    if (!text) return;
    let found = false;

    // Check confirmation/reference
    const refMatch = text.match(
      /(?:confirmation|booking\s*(?:ref|reference|code|number|#)?|reservation\s*(?:code|number|#)?|record\s*locator|itinerary\s*#?)\s*[:#]?\s*([A-Z0-9-]{5,15})/i
    );
    let newRef = form.reference;
    if (!newRef && refMatch?.[1]) {
      newRef = refMatch[1].trim();
      found = true;
    }

    // Check common providers
    const providers = [
      'Marriott', 'Hilton', 'Hyatt', 'IHG', 'Airbnb', 'Booking.com', 'Expedia',
      'Delta', 'United', 'American Airlines', 'Southwest', 'Air France', 'British Airways',
      'Hertz', 'Avis', 'Enterprise', 'Budget', 'National', 'Sixt', 'Viator', 'GetYourGuide'
    ];
    let newProvider = form.provider;
    if (!newProvider) {
      for (const p of providers) {
        if (new RegExp(`\\b${p}\\b`, 'i').test(text)) {
          newProvider = p;
          found = true;
          break;
        }
      }
    }

    if (found) {
      setForm((prev) => ({
        ...prev,
        reference: newRef,
        provider: newProvider,
      }));
      setAutoFillSuccess(true);
      setTimeout(() => setAutoFillSuccess(false), 2500);
    }
  };

  const save = async () => {
    if (!form.title) return;
    setBusy(true);
    try {
      const existingDetails =
        editingBooking?.details && typeof editingBooking.details === 'object'
          ? editingBooking.details
          : {};
      const finalNotes = form.notes.map((n) => n.trim()).filter(Boolean);
      if (newNote.trim()) {
        finalNotes.push(newNote.trim());
      }
      const details = {
        ...existingDetails,
        notes: finalNotes,
        attachments: form.attachments,
        sourceRaw: form.sourceRaw.trim() ? form.sourceRaw.trim() : undefined,
      };

      if (editingBooking) {
        await apiPatch(`/trips/${trip.id}/bookings/${editingBooking.id}`, {
          type: form.type,
          title: form.title,
          provider: form.provider,
          reference: form.reference,
          startAt: form.startAt ? new Date(form.startAt).toISOString() : null,
          endAt: form.endAt ? new Date(form.endAt).toISOString() : null,
          details,
        });
      } else {
        await apiPost(`/trips/${trip.id}/bookings`, {
          type: form.type,
          title: form.title,
          provider: form.provider,
          reference: form.reference,
          startAt: form.startAt ? new Date(form.startAt).toISOString() : undefined,
          endAt: form.endAt ? new Date(form.endAt).toISOString() : undefined,
          details,
        });
      }
      setOpen(false);
      setEditingBooking(null);
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const remove = (b: Booking) => {
    setDeletingBooking(b);
  };

  const typeConfig = TYPES.find((x) => x.value === form.type) ?? TYPES[0];

  return (
    <div>
      <div className="row space-between" style={{ marginBottom: 16, alignItems: 'center' }}>
        <h2 className="panel-title" style={{ margin: 0 }}>Bookings & Reservations</h2>
        <button className="btn sm primary" onClick={openAdd}>
          <Plus size={14} /> Add booking
        </button>
      </div>

      {bookings.length === 0 ? (
        <div className="empty-state">
          <div className="big">No bookings yet</div>
          <p>Add reservations manually, attach confirmation documents, or paste email confirmations.</p>
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
                <th>Notes & Docs</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((b) => {
                const bNotes = bookingNotes(b);
                const bAtts = bookingAttachments(b);
                const isRaw = hasRaw(b);
                return (
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
                        title="Click to edit reservation, notes, or attachments"
                      >
                        {b.title}
                      </div>
                      {(b.createdBy || b.updatedBy) && (
                        <div style={{ marginTop: 4 }}>
                          <AuditBadge
                            createdBy={b.createdBy}
                            createdAt={b.createdAt}
                            updatedBy={b.updatedBy}
                            updatedAt={b.updatedAt}
                          />
                        </div>
                      )}
                    </td>
                    <td>{b.provider || '—'}</td>
                    <td>
                      {b.reference ? (
                        <span className="badge" style={{ fontWeight: 700 }}>
                          {b.reference}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td style={{ fontSize: '0.84rem' }}>{formatBookingDateTime(b.startAt)}</td>
                    <td style={{ fontSize: '0.84rem' }}>{formatBookingDateTime(b.endAt)}</td>
                    <td>
                      <div className="row" style={{ gap: 6, justifyContent: 'center' }}>
                        {bNotes.length > 0 ? (
                          <button
                            type="button"
                            className="badge"
                            style={{ cursor: 'pointer', border: 'none', display: 'inline-flex', alignItems: 'center', gap: 3 }}
                            onClick={() => setViewingNotesBooking(b)}
                            title="View notes"
                          >
                            <StickyNote size={12} /> {bNotes.length}
                          </button>
                        ) : null}
                        {bAtts.length > 0 ? (
                          <button
                            type="button"
                            className="badge"
                            style={{ cursor: 'pointer', border: 'none', display: 'inline-flex', alignItems: 'center', gap: 3 }}
                            onClick={() => setViewingAttachmentsBooking(b)}
                            title="View attachments"
                          >
                            <Paperclip size={12} /> {bAtts.length}
                          </button>
                        ) : null}
                        {isRaw ? (
                          <button
                            type="button"
                            className="btn sm ghost"
                            style={{ padding: '2px 5px' }}
                            title="View raw source text"
                            onClick={() => setRawBooking(b)}
                          >
                            <FileText size={12} />
                          </button>
                        ) : null}
                        {bNotes.length === 0 && bAtts.length === 0 && !isRaw && '—'}
                      </div>
                    </td>
                    <td>
                      <div className="row" style={{ gap: 4, justifyContent: 'flex-end' }}>
                        <button
                          className="btn sm ghost"
                          title="Edit booking details, notes & attachments"
                          onClick={() => openEdit(b)}
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          className="btn sm ghost danger"
                          title="Delete booking"
                          onClick={() => remove(b)}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <Modal
          title={editingBooking ? `Edit ${typeConfig.label}` : 'Add Booking'}
          onClose={() => setOpen(false)}
          wide
        >
          <div className="field small">
            <label>Booking Type</label>
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as BookingType })}
            >
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
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

          {/* Consolidated Section: Booking Notes */}
          <div style={{ marginTop: 18, borderTop: '1px solid var(--line)', paddingTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <label style={{ margin: 0, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                <StickyNote size={14} style={{ color: 'var(--accent)' }} />
                Booking Notes ({form.notes.length})
              </label>
            </div>

            {form.notes.length > 0 && (
              <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
                {form.notes.map((note, index) => (
                  <div key={index} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                    <textarea
                      rows={2}
                      value={note}
                      aria-label={`Booking note ${index + 1}`}
                      onChange={(e) => handleUpdateNote(index, e.target.value)}
                      style={{ flex: 1, fontSize: '0.86rem', resize: 'vertical' }}
                      placeholder="Note content…"
                    />
                    <button
                      type="button"
                      className="btn sm ghost danger"
                      title="Delete note"
                      onClick={() => handleRemoveNote(index)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <textarea
                rows={2}
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                placeholder="Add a booking note, reminder, room preference, baggage info…"
                style={{ flex: 1, fontSize: '0.86rem', resize: 'vertical' }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    handleAddNote();
                  }
                }}
              />
              <button
                type="button"
                className="btn sm"
                onClick={handleAddNote}
                disabled={!newNote.trim()}
              >
                <Plus size={13} /> Add note
              </button>
            </div>
          </div>

          {/* Consolidated Section: Attach Documents */}
          <div style={{ marginTop: 18, borderTop: '1px solid var(--line)', paddingTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <label style={{ margin: 0, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Paperclip size={14} style={{ color: 'var(--accent)' }} />
                Attach Documents ({form.attachments.length})
              </label>
              <div>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  accept=".pdf,.txt,.html,.eml,.msg,.docx,image/*"
                  style={{ display: 'none' }}
                />
                <button
                  type="button"
                  className="btn sm ghost"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadingDoc}
                >
                  <UploadCloud size={14} />
                  {uploadingDoc ? 'Uploading & parsing…' : 'Attach file'}
                </button>
              </div>
            </div>

            {form.attachments.length === 0 ? (
              <div style={{ fontSize: '0.82rem', color: 'var(--muted)', fontStyle: 'italic', padding: '4px 0' }}>
                No documents attached yet. You can attach PDFs, confirmation documents, or image tickets.
              </div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {form.attachments.map((att, idx) => (
                  <div
                    key={idx}
                    className="badge"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '6px 10px',
                      fontSize: '0.82rem',
                    }}
                  >
                    <Paperclip size={13} style={{ color: 'var(--accent)' }} />
                    <span
                      style={{
                        fontWeight: 600,
                        maxWidth: 180,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={att.filename}
                    >
                      {att.filename}
                    </span>
                    {att.size ? <span className="muted">({formatFileSize(att.size)})</span> : null}
                    {(att.text || att.summary) && (
                      <button
                        type="button"
                        className="btn xs ghost"
                        style={{ padding: '2px 6px' }}
                        onClick={() => setPreviewDoc(att)}
                        title="Preview extracted text"
                      >
                        <Eye size={12} /> View
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn xs ghost danger"
                      style={{ padding: '2px 4px' }}
                      onClick={() => handleRemoveAttachment(idx)}
                      title="Remove attachment"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Consolidated Section: Paste Confirmation / Document Text */}
          <div style={{ marginTop: 18, borderTop: '1px solid var(--line)', paddingTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <button
                type="button"
                className="btn sm ghost"
                style={{ padding: 0, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text)' }}
                onClick={() => setShowPasteArea(!showPasteArea)}
              >
                <FileText size={14} style={{ color: 'var(--accent)' }} />
                Paste confirmation text or email body
                {showPasteArea ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                {form.sourceRaw ? (
                  <span className="badge" style={{ fontSize: '0.75rem', fontWeight: 'normal' }}>
                    {form.sourceRaw.length} chars
                  </span>
                ) : null}
              </button>
              {showPasteArea && form.sourceRaw.trim() && (
                <button
                  type="button"
                  className="btn sm ghost"
                  onClick={tryAutoFillFromText}
                  title="Attempt to extract confirmation number and provider"
                >
                  {autoFillSuccess ? (
                    <>
                      <Check size={13} style={{ color: '#10b981' }} /> Filled!
                    </>
                  ) : (
                    <>
                      <Sparkles size={13} style={{ color: '#facc15' }} /> Auto-fill fields
                    </>
                  )}
                </button>
              )}
            </div>

            {showPasteArea && (
              <div style={{ marginTop: 10 }}>
                <textarea
                  rows={6}
                  value={form.sourceRaw}
                  onChange={(e) => setForm({ ...form, sourceRaw: e.target.value })}
                  placeholder="Paste confirmation email, reservation details, receipt or ticket text here…"
                  style={{
                    width: '100%',
                    fontFamily: 'ui-monospace, Consolas, monospace',
                    fontSize: '0.82rem',
                    lineHeight: 1.45,
                    resize: 'vertical',
                  }}
                />
                <div className="small muted" style={{ marginTop: 4 }}>
                  Raw text will be saved with this booking and can be viewed or used for itinerary insights anytime.
                </div>
              </div>
            )}
          </div>

          <div className="modal-actions" style={{ marginTop: 20 }}>
            <button className="btn primary" onClick={save} disabled={busy || !form.title}>
              {busy ? 'Saving…' : editingBooking ? 'Save Changes' : 'Add Booking'}
            </button>
            <button className="btn" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </Modal>
      )}

      {viewingNotesBooking && (
        <Modal
          title={`Notes — ${viewingNotesBooking.title}`}
          onClose={() => setViewingNotesBooking(null)}
          wide
        >
          {bookingNotes(viewingNotesBooking).length === 0 ? (
            <div className="empty-state">No notes for this booking.</div>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {bookingNotes(viewingNotesBooking).map((note, i) => (
                <div
                  key={i}
                  style={{
                    background: 'rgba(255,255,255,0.04)',
                    padding: '10px 14px',
                    borderRadius: 8,
                    border: '1px solid var(--line)',
                    whiteSpace: 'pre-wrap',
                    fontSize: '0.9rem',
                  }}
                >
                  {note}
                </div>
              ))}
            </div>
          )}
          <div className="modal-actions" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button
              className="btn"
              onClick={() => {
                const b = viewingNotesBooking;
                setViewingNotesBooking(null);
                openEdit(b);
              }}
            >
              <Pencil size={13} /> Edit Notes & Booking
            </button>
            <button className="btn primary" onClick={() => setViewingNotesBooking(null)}>
              Close
            </button>
          </div>
        </Modal>
      )}

      {viewingAttachmentsBooking && (
        <Modal
          title={`Attachments — ${viewingAttachmentsBooking.title}`}
          onClose={() => setViewingAttachmentsBooking(null)}
          wide
        >
          {bookingAttachments(viewingAttachmentsBooking).length === 0 ? (
            <div className="empty-state">No attachments for this booking.</div>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {bookingAttachments(viewingAttachmentsBooking).map((att, i) => (
                <div
                  key={i}
                  style={{
                    background: 'rgba(255,255,255,0.04)',
                    padding: '12px 14px',
                    borderRadius: 8,
                    border: '1px solid var(--line)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
                      <Paperclip size={15} style={{ color: 'var(--accent)' }} />
                      {att.filename}
                      {att.size ? (
                        <span className="muted" style={{ fontWeight: 'normal', fontSize: '0.8rem' }}>
                          ({formatFileSize(att.size)})
                        </span>
                      ) : null}
                    </div>
                    {(att.text || att.summary) && (
                      <button className="btn sm ghost" onClick={() => setPreviewDoc(att)}>
                        <Eye size={13} /> View parsed text
                      </button>
                    )}
                  </div>
                  {att.summary && (
                    <div style={{ fontSize: '0.85rem', color: 'var(--muted)', marginTop: 4 }}>
                      <strong>Summary:</strong> {att.summary}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="modal-actions" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button
              className="btn"
              onClick={() => {
                const b = viewingAttachmentsBooking;
                setViewingAttachmentsBooking(null);
                openEdit(b);
              }}
            >
              <Pencil size={13} /> Edit Attachments & Booking
            </button>
            <button className="btn primary" onClick={() => setViewingAttachmentsBooking(null)}>
              Close
            </button>
          </div>
        </Modal>
      )}

      {previewDoc && (
        <Modal title={`Document Preview — ${previewDoc.filename}`} onClose={() => setPreviewDoc(null)} wide>
          <div className="small muted mb" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <span>Type: {previewDoc.fileType || 'document'}</span>
            {previewDoc.size ? <span>Size: {formatFileSize(previewDoc.size)}</span> : null}
          </div>
          {previewDoc.summary && (
            <div
              style={{
                marginBottom: 14,
                padding: 12,
                borderRadius: 8,
                background: 'rgba(99, 102, 241, 0.1)',
                border: '1px solid var(--accent)',
              }}
            >
              <strong style={{ display: 'block', marginBottom: 4 }}>AI Summary:</strong>
              <div style={{ fontSize: '0.88rem', lineHeight: 1.45 }}>{previewDoc.summary}</div>
            </div>
          )}
          {previewDoc.text ? (
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
              {previewDoc.text}
            </pre>
          ) : (
            <div className="muted" style={{ fontStyle: 'italic', padding: 20, textAlign: 'center' }}>
              No text extracted.
            </div>
          )}
          <div className="modal-actions">
            <button className="btn primary" onClick={() => setPreviewDoc(null)}>
              Close
            </button>
          </div>
        </Modal>
      )}

      {rawBooking && (
        <Modal title={`Raw source — ${rawBooking.title}`} onClose={() => setRawBooking(null)} wide>
          <div className="small muted mb">
            {rawBooking.type} · {rawBooking.provider || '—'}{' '}
            {rawBooking.reference ? `· ref ${rawBooking.reference}` : ''}
          </div>
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
            <button className="btn primary" onClick={() => setRawBooking(null)}>
              Close
            </button>
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