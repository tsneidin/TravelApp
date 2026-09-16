export interface TimelinePosition {
  left: number;
  width: number;
  start: number;
  end: number;
}

/** Read the wall-clock portion used throughout itinerary time display. */
export function minutesOfDay(value?: string | null): number | undefined {
  const match = value?.match(/(?:T|^)(\d{1,2}):(\d{2})(?:\s*([AP]M))?/i);
  if (!match) return undefined;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (minute > 59 || hour > 23) return undefined;
  if (match[3]) {
    if (hour < 1 || hour > 12) return undefined;
    hour = hour % 12 + (match[3].toUpperCase() === 'PM' ? 12 : 0);
  }
  return hour * 60 + minute;
}

export function timelinePosition(
  startDay: number,
  endDay: number,
  columnWidth: number,
  startTime: string | null | undefined,
  endTime: string | null | undefined,
  options: { defaultStart?: number; defaultEnd?: number; defaultDuration?: number; minWidth?: number } = {},
): TimelinePosition {
  const startMinute = minutesOfDay(startTime) ?? options.defaultStart ?? 0;
  const endMinute = minutesOfDay(endTime) ?? options.defaultEnd ?? (startMinute + (options.defaultDuration ?? 90));
  const start = (startDay + startMinute / 1440) * columnWidth;
  let end = (endDay + endMinute / 1440) * columnWidth;
  if (end <= start) end += columnWidth;
  const minWidth = options.minWidth ?? 24;
  return { left: start, width: Math.max(minWidth, end - start), start, end };
}
