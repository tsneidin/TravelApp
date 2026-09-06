import { useRef, useState } from 'react';
import { Image as ImageIcon, Link as LinkIcon, Bold, List as ListIcon, Eye, EyeOff, Loader2 } from 'lucide-react';
import { Modal } from './Modal';
import { JournalContent } from './JournalContent';
import { uploadPhotos } from '../lib/api';
import type { Photo } from '../lib/types';

interface JournalEntryModalProps {
  tripId: string;
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: { title: string; body: string; date?: string }) => Promise<void>;
  initialData?: {
    id?: string;
    title: string;
    body: string;
    date?: string;
  };
  tripPhotos?: Photo[];
  onPhotosUploaded?: () => Promise<void>;
}

export function JournalEntryModal({
  tripId,
  isOpen,
  onClose,
  onSave,
  initialData,
  tripPhotos = [],
  onPhotosUploaded,
}: JournalEntryModalProps) {
  const [title, setTitle] = useState(initialData?.title || '');
  const [body, setBody] = useState(initialData?.body || '');
  const [date, setDate] = useState(initialData?.date ? initialData.date.slice(0, 10) : '');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showPhotoPicker, setShowPhotoPicker] = useState(false);
  const [linkDialog, setLinkDialog] = useState<{ open: boolean; text: string; url: string }>({
    open: false,
    text: '',
    url: '',
  });

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const insertTextAtCursor = (insertion: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      setBody((prev) => (prev ? `${prev}\n${insertion}` : insertion));
      return;
    }

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const prev = body;
    const next = prev.substring(0, start) + insertion + prev.substring(end);
    setBody(next);

    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + insertion.length, start + insertion.length);
    }, 10);
  };

  const handleFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const res = await uploadPhotos(tripId, Array.from(files));
      if (res.photos && res.photos.length > 0) {
        const imageMarkdown = res.photos
          .map((p) => `![Photo](${p.url})`)
          .join('\n');
        insertTextAtCursor(`\n${imageMarkdown}\n`);
      }
      if (onPhotosUploaded) await onPhotosUploaded();
    } catch (err) {
      console.error('Failed to upload photos for journal', err);
    } finally {
      setUploading(false);
    }
  };

  const handleInsertLink = () => {
    let url = linkDialog.url.trim();
    if (!url) return;
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `https://${url}`;
    }
    const text = linkDialog.text.trim() || url;
    insertTextAtCursor(`[${text}](${url})`);
    setLinkDialog({ open: false, text: '', url: '' });
  };

  const handleSave = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      await onSave({
        title: title.trim(),
        body: body.trim(),
        date: date || undefined,
      });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={initialData?.id ? 'Edit Journal Entry' : 'New Journal Entry'} onClose={onClose}>
      <div className="field" style={{ marginBottom: '0.6rem' }}>
        <label style={{ marginBottom: 4 }}>Title</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Exploring the Ancient Temples of Rome"
          autoFocus
        />
      </div>

      <div className="field small" style={{ marginBottom: '0.6rem' }}>
        <label style={{ marginBottom: 4 }}>Date (optional)</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      <div className="field" style={{ marginBottom: '0.6rem' }}>
        <div className="row between" style={{ alignItems: 'center', marginBottom: 6 }}>
          <label style={{ margin: 0 }}>Story & Notes</label>
          <div className="row" style={{ gap: 4 }}>
            <button
              type="button"
              className="btn xs ghost"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              title="Upload and insert photo"
            >
              {uploading ? <Loader2 size={12} className="spin" /> : <ImageIcon size={12} />}
              <span style={{ marginLeft: 3 }}>Add Photos</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => void handleFileUpload(e.target.files)}
            />

            {tripPhotos.length > 0 && (
              <button
                type="button"
                className="btn xs ghost"
                onClick={() => setShowPhotoPicker(!showPhotoPicker)}
                title="Pick from trip gallery"
              >
                <span>Gallery ({tripPhotos.length})</span>
              </button>
            )}

            <button
              type="button"
              className="btn xs ghost"
              onClick={() => setLinkDialog({ open: true, text: '', url: '' })}
              title="Insert website link"
            >
              <LinkIcon size={12} />
              <span style={{ marginLeft: 3 }}>Link</span>
            </button>

            <button
              type="button"
              className="btn xs ghost"
              onClick={() => insertTextAtCursor('**bold text**')}
              title="Insert bold text"
            >
              <Bold size={12} />
            </button>

            <button
              type="button"
              className="btn xs ghost"
              onClick={() => insertTextAtCursor('\n- ')}
              title="Insert bullet item"
            >
              <ListIcon size={12} />
            </button>

            <button
              type="button"
              className={`btn xs ${showPreview ? 'primary' : 'ghost'}`}
              onClick={() => setShowPreview(!showPreview)}
              title="Toggle preview"
            >
              {showPreview ? <EyeOff size={12} /> : <Eye size={12} />}
              <span style={{ marginLeft: 3 }}>{showPreview ? 'Edit' : 'Preview'}</span>
            </button>
          </div>
        </div>

        {/* Existing trip photo picker drawer */}
        {showPhotoPicker && tripPhotos.length > 0 && (
          <div
            style={{
              padding: '8px',
              background: 'var(--surface-hover)',
              borderRadius: '6px',
              border: '1px solid var(--border)',
              marginBottom: '8px',
              maxHeight: '140px',
              overflowY: 'auto',
            }}
          >
            <div className="small muted" style={{ marginBottom: 6 }}>
              Click any photo to insert into journal:
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {tripPhotos.map((photo) => (
                <img
                  key={photo.id}
                  src={`/api/uploads/${encodeURIComponent(photo.filename)}`}
                  alt={photo.caption || 'photo'}
                  style={{
                    width: '45px',
                    height: '45px',
                    objectFit: 'cover',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    border: '1px solid var(--border)',
                  }}
                  title={photo.caption || 'Insert photo'}
                  onClick={() => {
                    insertTextAtCursor(`\n![${photo.caption || 'Trip photo'}](/api/uploads/${encodeURIComponent(photo.filename)})\n`);
                    setShowPhotoPicker(false);
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {showPreview ? (
          <div
            style={{
              minHeight: '140px',
              padding: '10px 12px',
              background: 'var(--surface-hover)',
              borderRadius: '6px',
              border: '1px solid var(--border)',
              fontSize: '13px',
              lineHeight: 1.6,
            }}
          >
            {body.trim() ? (
              <JournalContent content={body} />
            ) : (
              <span className="muted">No content to preview yet.</span>
            )}
          </div>
        ) : (
          <textarea
            ref={textareaRef}
            rows={6}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Capture stories, memories, favorite moments, recommendations, and thoughts…"
          />
        )}
      </div>

      {/* Insert Link Mini Modal */}
      {linkDialog.open && (
        <div
          style={{
            padding: '10px',
            background: 'var(--surface-hover)',
            borderRadius: '6px',
            border: '1px solid var(--border)',
            marginBottom: '10px',
          }}
        >
          <div className="small bold mb" style={{ fontWeight: 600 }}>
            Insert Website Link
          </div>
          <div className="grid grid-2" style={{ gap: 8, marginBottom: 8 }}>
            <div>
              <label className="small muted" style={{ display: 'block', marginBottom: 2 }}>Link Text</label>
              <input
                value={linkDialog.text}
                onChange={(e) => setLinkDialog({ ...linkDialog, text: e.target.value })}
                placeholder="e.g. Official Guide"
                style={{ fontSize: '13px', padding: '4px 8px' }}
                autoFocus
              />
            </div>
            <div>
              <label className="small muted" style={{ display: 'block', marginBottom: 2 }}>URL</label>
              <input
                value={linkDialog.url}
                onChange={(e) => setLinkDialog({ ...linkDialog, url: e.target.value })}
                placeholder="https://example.com"
                style={{ fontSize: '13px', padding: '4px 8px' }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleInsertLink();
                  }
                }}
              />
            </div>
          </div>
          <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
            <button type="button" className="btn xs primary" onClick={handleInsertLink} disabled={!linkDialog.url.trim()}>
              Insert Link
            </button>
            <button type="button" className="btn xs" onClick={() => setLinkDialog({ open: false, text: '', url: '' })}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="modal-actions">
        <button
          type="button"
          className="btn primary"
          onClick={handleSave}
          disabled={busy || !title.trim() || uploading}
        >
          {busy ? 'Saving…' : 'Save Entry'}
        </button>
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
