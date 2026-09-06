import { Avatar } from './Avatar';
import type { AuditUser } from '../lib/types';

function formatRelativeTime(dateStr?: string | null): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

interface AuditBadgeProps {
  createdBy?: AuditUser | null;
  updatedBy?: AuditUser | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  compact?: boolean;
  className?: string;
}

export function AuditBadge({
  createdBy,
  updatedBy,
  createdAt,
  updatedAt,
  compact = true,
  className = '',
}: AuditBadgeProps) {
  if (!createdBy && !updatedBy && !createdAt) {
    return null;
  }

  const primaryUser = createdBy || updatedBy;
  const isEdited = !!updatedBy && updatedBy.id !== createdBy?.id;
  const timeStr = formatRelativeTime(isEdited ? updatedAt || createdAt : createdAt);

  if (compact) {
    return (
      <span
        className={`audit-tag ${className}`}
        title={`${createdBy ? `Created by ${createdBy.name}` : ''}${
          updatedBy && updatedBy.id !== createdBy?.id ? ` • Updated by ${updatedBy.name}` : ''
        }${createdAt ? ` on ${new Date(createdAt).toLocaleString()}` : ''}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          fontSize: '0.72rem',
          color: 'var(--muted)',
          lineHeight: 1,
          opacity: 0.85,
        }}
      >
        {primaryUser && <Avatar user={primaryUser} size={16} />}
        <span>
          {primaryUser ? primaryUser.name : 'Added'}{' '}
          {timeStr && <span style={{ opacity: 0.75 }}>• {timeStr}</span>}
        </span>
      </span>
    );
  }

  return (
    <div
      className={`audit-block ${className}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: '0.78rem',
        color: 'var(--muted)',
        marginTop: 6,
        paddingTop: 6,
        borderTop: '1px solid var(--line)',
      }}
    >
      {createdBy && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Avatar user={createdBy} size={18} />
          <span>
            Added by <strong>{createdBy.name}</strong> {timeStr && `• ${timeStr}`}
          </span>
        </div>
      )}
      {updatedBy && updatedBy.id !== createdBy?.id && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
          <Avatar user={updatedBy} size={18} />
          <span>
            Edited by <strong>{updatedBy.name}</strong>
          </span>
        </div>
      )}
    </div>
  );
}
