import { useRef, useState } from 'react';
import { Plus, Trash2, Image as ImageIcon, PenSquare, Pencil } from 'lucide-react';
import { apiPost, apiPatch, apiDelete, uploadPhotos } from '../../lib/api';
import type { Trip, JournalEntry, Photo } from '../../lib/types';
import { Modal, ConfirmModal } from '../../components/Modal';
import { AuditBadge } from '../../components/AuditBadge';

interface JournalForm {
  title: string;
  body: string;
  date: string;
}

export function PhotosJournalTab({ trip, reload }: { trip: Trip; reload: () => Promise<void> }) {
  const photos = trip.photos ?? [];
  const journal = trip.journal ?? [];
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [jOpen, setJOpen] = useState(false);
  const [editingJournalId, setEditingJournalId] = useState<string | null>(null);
  const [jForm, setJForm] = useState<JournalForm>({ title: '', body: '', date: '' });
  const [busy, setBusy] = useState(false);
  const [viewingPhoto, setViewingPhoto] = useState<Photo | null>(null);
  const [deletingPhotoId, setDeletingPhotoId] = useState<string | null>(null);
  const [deletingJournalId, setDeletingJournalId] = useState<string | null>(null);

  const photoUrl = (photo: Photo) => `/api/uploads/${encodeURIComponent(photo.filename)}`;

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      await uploadPhotos(trip.id, Array.from(files));
      await reload();
    } finally {
      setUploading(false);
    }
  };

  const removePhoto = (id: string) => {
    setDeletingPhotoId(id);
  };

  const openNewJournal = () => {
    setEditingJournalId(null);
    setJForm({ title: '', body: '', date: '' });
    setJOpen(true);
  };

  const openEditJournal = (entry: JournalEntry) => {
    setEditingJournalId(entry.id);
    setJForm({ title: entry.title, body: entry.body, date: entry.date ? entry.date.slice(0, 10) : '' });
    setJOpen(true);
  };

  const saveJournal = async () => {
    setBusy(true);
    try {
      const payload = { title: jForm.title, body: jForm.body, date: jForm.date || undefined };
      if (editingJournalId) {
        await apiPatch(`/trips/${trip.id}/journal/${editingJournalId}`, payload);
      } else {
        await apiPost(`/trips/${trip.id}/journal`, payload);
      }
      setJOpen(false);
      setJForm({ title: '', body: '', date: '' });
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const removeJournal = (id: string) => {
    setDeletingJournalId(id);
  };

  return (
    <div className="grid">
      <div>
        <div className="row between">
          <h2 className="panel-title">Photos</h2>
          <button className="btn sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? 'Uploading…' : <><Plus size={14} /> Upload photos</>}
          </button>
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => void onFiles(e.target.files)} />
        </div>
        {photos.length === 0 ? (
          <div className="empty-state">
            <div className="big"><ImageIcon size={20} style={{ verticalAlign: -4 }} /> No photos yet</div>
            <p>Add photos of places and moments from the trip.</p>
          </div>
        ) : (
          <div className="grid grid-3">
            {photos.map((p) => (
              <div key={p.id} className="card" style={{ padding: 8, position: 'relative' }}>
                <button
                  type="button"
                  onClick={() => setViewingPhoto(p)}
                  title="View full screen"
                  style={{ display: 'block', width: '100%', padding: 0, border: 0, background: 'transparent', cursor: 'zoom-in' }}
                >
                  <img
                    src={photoUrl(p)}
                    alt={p.caption || 'trip photo'}
                    loading="lazy"
                    style={{ display: 'block', width: '100%', height: 160, objectFit: 'cover', borderRadius: 10 }}
                  />
                </button>
                <div className="row between mt" style={{ gap: 6 }}>
                  <span className="small muted grow" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.caption || 'No caption'}
                  </span>
                  <button className="btn sm ghost danger" onClick={() => removePhoto(p.id)}><Trash2 size={13} /></button>
                </div>
                {(p.createdBy || p.updatedBy) && (
                  <div style={{ marginTop: 6, paddingTop: 4, borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end' }}>
                    <AuditBadge createdBy={p.createdBy} createdAt={p.createdAt} updatedBy={p.updatedBy} updatedAt={p.updatedAt} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="row between">
          <h2 className="panel-title">Journal</h2>
          <button className="btn sm" onClick={openNewJournal}>
            <PenSquare size={14} /> Write entry
          </button>
        </div>
        {journal.length === 0 ? (
          <div className="empty-state">
            <div className="big">No journal entries</div>
            <p>Capture the stories behind the trip, day by day.</p>
          </div>
        ) : (
          journal.map((j: JournalEntry) => (
            <div className="panel mb" key={j.id}>
              <div className="row between">
                <h3 style={{ margin: 0, fontSize: '1rem' }}>{j.title}</h3>
                <div className="row">
                  <button className="btn sm ghost" title="Edit journal entry" onClick={() => openEditJournal(j)}><Pencil size={13} /></button>
                  <button className="btn sm ghost danger" onClick={() => removeJournal(j.id)}><Trash2 size={13} /></button>
                </div>
              </div>
              <div className="small muted mb">{j.date ? new Date(j.date).toLocaleDateString() : ''}</div>
              <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6, fontSize: '0.92rem' }}>{j.body}</div>
              {(j.createdBy || j.updatedBy) && (
                <div style={{ marginTop: 10, paddingTop: 6, borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end' }}>
                  <AuditBadge createdBy={j.createdBy} createdAt={j.createdAt} updatedBy={j.updatedBy} updatedAt={j.updatedAt} />
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {viewingPhoto && (
        <div className="photo-lightbox" role="dialog" aria-modal="true" aria-label={viewingPhoto.caption || 'Trip photo'}>
          <button type="button" className="photo-lightbox-backdrop" aria-label="Close photo" onClick={() => setViewingPhoto(null)} />
          <div className="photo-lightbox-content">
            <img src={photoUrl(viewingPhoto)} alt={viewingPhoto.caption || 'trip photo'} />
            <div className="photo-lightbox-actions">
              <span className="grow">{viewingPhoto.caption || 'Trip photo'}</span>
              <a className="btn" href={photoUrl(viewingPhoto)} target="_blank" rel="noreferrer">Open original</a>
              <button type="button" className="btn primary" onClick={() => setViewingPhoto(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {jOpen && (
        <Modal title={editingJournalId ? "Edit journal entry" : "New journal entry"} onClose={() => setJOpen(false)}>
          <div className="field">
            <label>Title</label>
            <input value={jForm.title} onChange={(e) => setJForm({ ...jForm, title: e.target.value })} placeholder="Day 2: Shibuya scramble" autoFocus />
          </div>
          <div className="field">
            <label>Date</label>
            <input type="date" value={jForm.date} onChange={(e) => setJForm({ ...jForm, date: e.target.value })} />
          </div>
          <div className="field">
            <label>Entry</label>
            <textarea rows={6} value={jForm.body} onChange={(e) => setJForm({ ...jForm, body: e.target.value })} placeholder="What happened today…" />
          </div>
          <div className="modal-actions">
            <button className="btn primary" onClick={saveJournal} disabled={busy || !jForm.title}>Save</button>
            <button className="btn" onClick={() => setJOpen(false)}>Cancel</button>
          </div>
        </Modal>
      )}

      {deletingPhotoId && (
        <ConfirmModal
          title="Delete photo"
          message="Delete this photo?"
          confirmLabel="Delete"
          danger
          onConfirm={async () => {
            await apiDelete(`/trips/${trip.id}/photos/${deletingPhotoId}`);
            setDeletingPhotoId(null);
            await reload();
          }}
          onCancel={() => setDeletingPhotoId(null)}
        />
      )}

      {deletingJournalId && (
        <ConfirmModal
          title="Delete journal entry"
          message="Delete this journal entry?"
          confirmLabel="Delete"
          danger
          onConfirm={async () => {
            await apiDelete(`/trips/${trip.id}/journal/${deletingJournalId}`);
            setDeletingJournalId(null);
            await reload();
          }}
          onCancel={() => setDeletingJournalId(null)}
        />
      )}
    </div>
  );
}