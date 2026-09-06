import { User as UserIcon } from 'lucide-react';
import type { AuditUser } from '../lib/types';

export const PRESET_AVATARS = [
  { id: 'plane', emoji: '✈️', label: 'Airplane' },
  { id: 'globe', emoji: '🌍', label: 'Globe' },
  { id: 'camera', emoji: '📷', label: 'Camera' },
  { id: 'beach', emoji: '🏖️', label: 'Beach' },
  { id: 'backpack', emoji: '🎒', label: 'Backpack' },
  { id: 'mountain', emoji: '🏔️', label: 'Mountain' },
  { id: 'train', emoji: '🚆', label: 'Train' },
  { id: 'compass', emoji: '🧭', label: 'Compass' },
  { id: 'hotel', emoji: '🏨', label: 'Hotel' },
  { id: 'tent', emoji: '⛺', label: 'Camp' },
  { id: 'ship', emoji: '🛳️', label: 'Cruise' },
  { id: 'pizza', emoji: '🍕', label: 'Foodie' },
];

function getHashColor(str: string): string {
  const colors = [
    '#3b82f6', // blue
    '#10b981', // green
    '#8b5cf6', // purple
    '#f59e0b', // amber
    '#ec4899', // pink
    '#06b6d4', // cyan
    '#f97316', // orange
    '#14b8a6', // teal
    '#6366f1', // indigo
    '#e11d48', // rose
  ];
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  }
  return colors[hash % colors.length];
}

interface AvatarProps {
  user?: AuditUser | { name?: string; email?: string; avatarUrl?: string | null } | null;
  name?: string;
  avatarUrl?: string | null;
  size?: number | 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  showTooltip?: boolean;
}

export function Avatar({
  user,
  name: nameProp,
  avatarUrl: avatarUrlProp,
  size = 'md',
  className = '',
  showTooltip = false,
}: AvatarProps) {
  const name = nameProp || user?.name || user?.email || 'User';
  const avatarUrl = avatarUrlProp !== undefined ? avatarUrlProp : user?.avatarUrl;

  const sizePx =
    typeof size === 'number'
      ? size
      : size === 'sm'
      ? 22
      : size === 'lg'
      ? 38
      : size === 'xl'
      ? 56
      : 28;

  const fontSize = Math.max(10, Math.round(sizePx * 0.44));

  // Check if avatarUrl is a preset emoji token e.g. "preset:plane" or an actual emoji
  let isPresetEmoji = false;
  let emojiChar = '';
  if (avatarUrl) {
    if (avatarUrl.startsWith('preset:')) {
      const presetId = avatarUrl.replace('preset:', '');
      const found = PRESET_AVATARS.find((p) => p.id === presetId);
      if (found) {
        isPresetEmoji = true;
        emojiChar = found.emoji;
      }
    } else if (avatarUrl.length <= 4 && !avatarUrl.startsWith('/') && !avatarUrl.startsWith('http')) {
      isPresetEmoji = true;
      emojiChar = avatarUrl;
    }
  }

  const bgColor = getHashColor(name);

  return (
    <div
      className={`user-avatar-badge ${className}`}
      title={showTooltip ? name : undefined}
      style={{
        width: sizePx,
        height: sizePx,
        minWidth: sizePx,
        minHeight: sizePx,
        borderRadius: '50%',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize,
        fontWeight: 700,
        color: '#ffffff',
        backgroundColor: avatarUrl && !isPresetEmoji ? 'transparent' : bgColor,
        overflow: 'hidden',
        userSelect: 'none',
        border: '1.5px solid rgba(255,255,255,0.15)',
        boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
        flexShrink: 0,
        position: 'relative',
      }}
    >
      {avatarUrl && !isPresetEmoji ? (
        <img
          src={avatarUrl}
          alt={name}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
          onError={(e) => {
            // Fallback to initials if image fails to load
            (e.target as HTMLElement).style.display = 'none';
          }}
        />
      ) : isPresetEmoji ? (
        <span style={{ fontSize: Math.round(sizePx * 0.55), lineHeight: 1 }}>{emojiChar}</span>
      ) : name ? (
        name.charAt(0).toUpperCase()
      ) : (
        <UserIcon size={Math.round(sizePx * 0.5)} />
      )}
    </div>
  );
}
