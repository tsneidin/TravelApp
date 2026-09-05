import { prisma } from '../db.js';

/**
 * Clean up OCR artifacts, stray words ("ARRIVE", "DEPART", "OPERATED BY ENVOY AIR", etc.),
 * and stray single letters from airport city names.
 */
export function cleanAirportCity(raw: string): string {
  if (!raw) return '';
  let s = raw.trim();

  // Strip "Operated by ..." line if separated by newline
  s = s.replace(/^Operated\s+by[^\n]*\n+/i, '');
  // Strip "Operated by [Carrier]" on same line before city
  s = s.replace(/^Operated\s+by\s+(?:Envoy\s+Air|SkyWest|American\s+Eagle|[A-Za-z\s]+?)\s+(?=[A-Z][a-z]+)/i, '');
  // Strip common airline names if they leaked into city
  s = s.replace(/^(?:American\s+Airlines|Envoy\s+Air|United|Delta|SkyWest|Lufthansa)\s+/i, '');
  // Strip words like Depart, Departure, Arrive, Arrival, From, To, At, In
  s = s.replace(/^(?:Depart(?:ure)?|Arriv(?:e|al)?|From|To|At|In)\s+/i, '');
  // Strip stray single uppercase/lowercase letter at the beginning (e.g. "E Chicago" from "ARRIVE Chicago")
  s = s.replace(/^[A-Za-z]\s+/i, '');
  // Strip leading non-letters
  s = s.replace(/^[^a-zA-Z]+/, '');
  // Strip trailing "Airport", etc.
  s = s.replace(/\s+(?:International\s+)?Airport\b/i, '');

  return s.trim();
}

/**
 * Returns a stable YYYY-MM-DD date key regardless of UTC or local time offset.
 */
export function toDayKey(d: Date | string): string {
  if (!d) return '';
  if (typeof d === 'string') return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

/**
 * Safely parse a date value to midday UTC Date object.
 */
export function toMiddayDate(val?: unknown): Date | undefined {
  if (!val) return undefined;
  if (val instanceof Date) {
    if (Number.isNaN(val.getTime())) return undefined;
    return new Date(Date.UTC(val.getUTCFullYear(), val.getUTCMonth(), val.getUTCDate(), 12, 0, 0));
  }
  const str = String(val).trim();
  if (!str) return undefined;
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (ymd) {
    return new Date(Date.UTC(parseInt(ymd[1], 10), parseInt(ymd[2], 10) - 1, parseInt(ymd[3], 10), 12, 0, 0));
  }
  const parsed = new Date(str);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate(), 12, 0, 0));
}

/**
 * Generate a continuous array of Date objects from startDate to endDate (inclusive).
 */
export function tripDates(startDate?: Date | null, endDate?: Date | null): Date[] {
  const start = toMiddayDate(startDate);
  const end = toMiddayDate(endDate);
  if (!start || !end || end < start) return [];

  const dates: Date[] = [];
  for (const cur = new Date(start); cur <= end; cur.setUTCDate(cur.getUTCDate() + 1)) {
    dates.push(new Date(cur));
  }
  return dates;
}

/**
 * Check if a day label is just a generic placeholder like "Day 1", "Day 2", "Day 24".
 */
export function isGenericDayLabel(label?: string | null): boolean {
  if (!label) return true;
  const trimmed = label.trim();
  if (!trimmed) return true;
  return /^day\s*\d+$/i.test(trimmed);
}

/**
 * Comprehensive reconciliation of a trip's itinerary days:
 * 1. Merges duplicate days sharing the same YYYY-MM-DD calendar date.
 * 2. Clears stale generic labels like "Day 2" so dynamic chronological sequence takes effect.
 * 3. Expands trip.startDate and trip.endDate to encompass all days and bookings.
 * 4. Fills all intermediate calendar day gaps (e.g. creating missing Wed, Oct 21).
 * 5. Re-sequences sortOrder (0, 1, 2, ...) matching chronological date order.
 */
export async function reconcileTripDays(tripId: string): Promise<{
  daysAdded: number;
  daysDeduplicated: number;
  labelsCleaned: number;
  rangeUpdated: boolean;
}> {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: {
      days: { orderBy: { date: 'asc' }, include: { places: true } },
      bookings: true,
    },
  });
  if (!trip) return { daysAdded: 0, daysDeduplicated: 0, labelsCleaned: 0, rangeUpdated: false };

  let daysAdded = 0;
  let daysDeduplicated = 0;
  let labelsCleaned = 0;
  let rangeUpdated = false;

  // 1. Deduplicate days sharing the same YYYY-MM-DD
  const daysByDate = new Map<string, typeof trip.days>();
  for (const day of trip.days) {
    const key = toDayKey(day.date);
    const list = daysByDate.get(key) ?? [];
    list.push(day);
    daysByDate.set(key, list);
  }

  for (const [, daysList] of daysByDate.entries()) {
    if (daysList.length > 1) {
      // Pick the primary day (prefer one with custom non-generic label, or most places, or first created)
      const primary = [...daysList].sort((a, b) => {
        const aCustom = !isGenericDayLabel(a.label);
        const bCustom = !isGenericDayLabel(b.label);
        if (aCustom && !bCustom) return -1;
        if (!aCustom && bCustom) return 1;
        if (b.places.length !== a.places.length) return b.places.length - a.places.length;
        return a.createdAt.getTime() - b.createdAt.getTime();
      })[0];

      const duplicates = daysList.filter((d) => d.id !== primary.id);
      for (const dup of duplicates) {
        if (dup.places.length > 0) {
          await prisma.place.updateMany({
            where: { dayId: dup.id },
            data: { dayId: primary.id },
          });
        }
        await prisma.day.delete({ where: { id: dup.id } });
        daysDeduplicated++;
      }
    }
  }

  // 2. Clean up generic "Day X" labels in existing days
  const currentDays = await prisma.day.findMany({
    where: { tripId },
    orderBy: { date: 'asc' },
  });

  for (const day of currentDays) {
    if (day.label && isGenericDayLabel(day.label)) {
      await prisma.day.update({
        where: { id: day.id },
        data: { label: null },
      });
      labelsCleaned++;
    }
  }

  // 3. Determine true bounding dates
  let minDate = trip.startDate ? toMiddayDate(trip.startDate) : undefined;
  let maxDate = trip.endDate ? toMiddayDate(trip.endDate) : undefined;

  for (const day of currentDays) {
    const d = toMiddayDate(day.date);
    if (d) {
      if (!minDate || d < minDate) minDate = d;
      if (!maxDate || d > maxDate) maxDate = d;
    }
  }

  for (const b of trip.bookings) {
    const s = toMiddayDate(b.startAt);
    const e = toMiddayDate(b.endAt);
    if (s) {
      if (!minDate || s < minDate) minDate = s;
      if (!maxDate || s > maxDate) maxDate = s;
    }
    if (e) {
      if (!minDate || e < minDate) minDate = e;
      if (!maxDate || e > maxDate) maxDate = e;
    }
  }

  // Update trip date bounds if expanded
  if (minDate && maxDate && minDate <= maxDate) {
    const tripStartKey = trip.startDate ? toDayKey(trip.startDate) : '';
    const tripEndKey = trip.endDate ? toDayKey(trip.endDate) : '';
    const newStartKey = toDayKey(minDate);
    const newEndKey = toDayKey(maxDate);

    if (tripStartKey !== newStartKey || tripEndKey !== newEndKey) {
      await prisma.trip.update({
        where: { id: tripId },
        data: { startDate: minDate, endDate: maxDate },
      });
      rangeUpdated = true;
    }

    // 4. Fill in all missing calendar dates
    const expectedDates = tripDates(minDate, maxDate);
    const refreshedDays = await prisma.day.findMany({ where: { tripId }, select: { id: true, date: true } });
    const existingDateKeys = new Set(refreshedDays.map((d) => toDayKey(d.date)));

    const missing = expectedDates.filter((d) => !existingDateKeys.has(toDayKey(d)));
    if (missing.length > 0) {
      await prisma.day.createMany({
        data: missing.map((date) => ({
          tripId,
          date,
          label: null,
          sortOrder: 0,
        })),
      });
      daysAdded += missing.length;
    }
  }

  // 5. Re-index sortOrder chronologically
  const allFinalDays = await prisma.day.findMany({
    where: { tripId },
    orderBy: { date: 'asc' },
  });

  for (let i = 0; i < allFinalDays.length; i++) {
    if (allFinalDays[i].sortOrder !== i) {
      await prisma.day.update({
        where: { id: allFinalDays[i].id },
        data: { sortOrder: i },
      });
    }
  }

  return { daysAdded, daysDeduplicated, labelsCleaned, rangeUpdated };
}
