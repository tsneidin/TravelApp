/**
 * Keep paired date/datetime inputs valid and make an empty end picker open
 * around the selected start rather than an unrelated month.
 */
export function endForStart(start: string, end: string): string {
  if (!start) return end;
  return !end || end < start ? start : end;
}

/** Trip dates are calendar dates, not instants to shift into the viewer's timezone. */
export function formatTripDate(value: string, options?: Intl.DateTimeFormatOptions): string {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  return new Date(year, month - 1, day, 12).toLocaleDateString(undefined, options);
}
