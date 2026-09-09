import { useTimeFormat, formatDateTime } from '../../lib/time';
import { useState } from 'react';
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
  Eye,
} from 'lucide-react';
import { apiDelete } from '../../lib/api';
import type { Trip, Booking, BookingType, BookingAttachment } from '../../lib/types';
import { Modal, ConfirmModal } from '../../components/Modal';
import { AuditBadge } from '../../components/AuditBadge';
import {
  BookingModal,
  TYPES,
  bookingNotes,
  bookingAttachments,
  formatFileSize,
  rawBookingText,
} from '../../components/BookingModal';



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
  const timeFormat = useTimeFormat();
  const formatBookingDateTime = (value?: string | null) => value ? formatDateTime(value, timeFormat) : '—';
  const bookings = trip.bookings ?? [];
  const [open, setOpen] = useState(false);
  const [editingBooking, setEditingBooking] = useState<Booking | null>(null);

  const [rawBooking, setRawBooking] = useState<Booking | null>(null);
  const [viewingNotesBooking, setViewingNotesBooking] = useState<Booking | null>(null);
  const [viewingAttachmentsBooking, setViewingAttachmentsBooking] = useState<Booking | null>(null);
  const [previewDoc, setPreviewDoc] = useState<BookingAttachment | null>(null);
  const [deletingBooking, setDeletingBooking] = useState<Booking | null>(null);

  const openAdd = () => {
    setEditingBooking(null);
    setOpen(true);
  };

  const openEdit = (b: Booking) => {
    setEditingBooking(b);
    setOpen(true);
  };

  const remove = (b: Booking) => {
    setDeletingBooking(b);
  };

  const hasRaw = (b: Booking) => Boolean(rawBookingText(b));
  const rawText = (b: Booking) => rawBookingText(b);

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
        <BookingModal
          tripId={trip.id}
          booking={editingBooking}
          onClose={() => {
            setOpen(false);
            setEditingBooking(null);
          }}
          onSaved={async () => {
            setOpen(false);
            setEditingBooking(null);
            await reload();
          }}
        />
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