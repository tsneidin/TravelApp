import { useId, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useDialog } from '../lib/useDialog';

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const titleId = useId();
  const dialogRef = useDialog(true, onClose);
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`modal ${wide ? 'modal-wide' : ''}`}
        style={wide ? { maxWidth: 720 } : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-mobile-handle" />
        <div className="modal-header-row">
          <h3 id={titleId} style={{ margin: 0 }}>{title}</h3>
          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close modal"
          >
            <X size={18} />
          </button>
        </div>
        <div className="modal-body-content">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmModal({
  title = 'Confirm',
  message,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  danger = true,
  onConfirm,
  onCancel,
}: {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const cancel = () => { if (!pending) onCancel(); };
  const confirm = async () => {
    if (pending) return;
    setPending(true);
    setError('');
    try {
      await onConfirm();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to complete this action. Please try again.');
    } finally {
      setPending(false);
    }
  };
  return (
    <Modal title={title} onClose={cancel}>
      <p style={{ margin: '6px 0 18px', lineHeight: 1.5, color: 'var(--text)', fontSize: '0.92rem' }}>
        {message}
      </p>
      {error && <p role="alert" className="danger">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="btn" onClick={cancel} disabled={pending}>
          {cancelLabel}
        </button>
        <button
          type="button"
          className={`btn ${danger ? 'danger' : 'primary'}`}
          onClick={() => void confirm()}
          disabled={pending}
        >
          {pending ? 'Working…' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
