/**
 * Keep paired date/datetime inputs valid and make an empty end picker open
 * around the selected start rather than an unrelated month.
 */
export function endForStart(start: string, end: string): string {
  if (!start) return end;
  return !end || end < start ? start : end;
}
