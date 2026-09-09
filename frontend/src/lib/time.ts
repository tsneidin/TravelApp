import { useAuth } from './auth';

export type TimeFormat = '12' | '24';

export function useTimeFormat(): TimeFormat {
  const { user } = useAuth();
  return user?.settings?.timeFormat === '24' ? '24' : '12';
}

export function formatClock(value: string, format: TimeFormat): string {
  const match = value.match(/(?:T|^)(\d{1,2}):(\d{2})(?:\s*([AP]M))?/i);
  if (!match) return value;
  let hour = Number(match[1]);
  if (match[3]) hour = hour % 12 + (match[3].toUpperCase() === 'PM' ? 12 : 0);
  return format === '24'
    ? `${String(hour).padStart(2, '0')}:${match[2]}`
    : `${hour % 12 || 12}:${match[2]} ${hour >= 12 ? 'PM' : 'AM'}`;
}

export function formatTimeRange(start?: string | null, end?: string | null, format: TimeFormat = '12'): string | null {
  if (!start) return null;
  const first = formatClock(start, format);
  const last = end ? formatClock(end, format) : null;
  return last && last !== first ? `${first} – ${last}` : first;
}

export function formatDateTime(value: string, format: TimeFormat): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: format === '24' ? 'h23' : 'h12',
  });
}
