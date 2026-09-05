import { prisma } from '../db.js';
import type { Booking, Day, Place } from '@prisma/client';

export interface CalendarEvent {
  id: string;
  type: 'place' | 'booking';
  tripId: string;
  title: string;
  date: string; // YYYY-MM-DD
  startAt?: string;
  endAt?: string;
  sortOrder: number;
  placeId?: string;
  bookingType?: string;
  dayId?: string;
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Build a flat list of calendar events across all trips (or one trip). */
export async function buildEvents(opts: { userId?: string; tripId?: string } = {}): Promise<CalendarEvent[]> {
  const where = opts.tripId ? { id: opts.tripId } : { ownerId: opts.userId };
  const trips = await prisma.trip.findMany({
    where,
    include: { days: true, places: true, bookings: true },
  });

  const events: CalendarEvent[] = [];
  for (const trip of trips) {
    for (const place of trip.places) {
      if (!place.includeInCalendar) continue;
      events.push(
        placeEvent(trip.id, place, trip.days.find((d) => d.id === place.dayId)),
      );
    }
    for (const b of trip.bookings) {
      const bDate = b.startAt ? isoDate(b.startAt) : undefined;
      const matchingDay = bDate ? trip.days.find((d) => isoDate(d.date) === bDate) : undefined;
      events.push(bookingEvent(trip.id, b, matchingDay));
    }
  }
  events.sort((a, b) => (a.date === b.date ? a.sortOrder - b.sortOrder : a.date.localeCompare(b.date)));
  return events;
}

function placeEvent(tripId: string, place: Place, day: Day | undefined): CalendarEvent {
  return {
    id: `p-${place.id}`,
    type: 'place',
    tripId,
    title: place.name,
    date: day ? isoDate(day.date) : isoDate(new Date()),
    startAt: place.startTime?.toISOString(),
    endAt: place.endTime?.toISOString(),
    sortOrder: place.sortOrder,
    placeId: place.id,
    dayId: day?.id,
  };
}

function bookingEvent(tripId: string, b: Booking, day?: Day): CalendarEvent {
  return {
    id: `b-${b.id}`,
    type: 'booking',
    tripId,
    title: b.title,
    date: b.startAt ? isoDate(b.startAt) : isoDate(new Date()),
    startAt: b.startAt?.toISOString(),
    endAt: b.endAt?.toISOString(),
    sortOrder: 0,
    bookingType: b.type,
    dayId: day?.id,
  };
}

/** Generate an iCalendar (.ics) feed for all visible trips (or one trip). */
export async function buildIcs(opts: { userId?: string; tripId?: string }): Promise<string> {
  const events = await buildEvents(opts);
  const lines: string[] = [];
  lines.push('BEGIN:VCALENDAR');
  lines.push('VERSION:2.0');
  lines.push('PRODID:-//TravelApp//Travel//EN');
  lines.push('CALSCALE:GREGORIAN');

  for (const e of events) {
    if (!e.date) continue;
    const startIso = e.startAt ? toIsoUtc(new Date(e.startAt)) : `${e.date}T000000Z`;
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${e.id}@travelapp`);
    lines.push(`DTSTAMP:${toIsoUtc(new Date())}`);
    lines.push(`DTSTART:${startIso}`);
    if (e.endAt) lines.push(`DTEND:${toIsoUtc(new Date(e.endAt))}`);
    lines.push(`SUMMARY:${escapeIcs(e.title)}`);
    lines.push(`CATEGORIES:${e.type === 'place' ? 'Place' : (e.bookingType ?? 'Booking')}`);
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toIsoUtc(d: Date): string {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function escapeIcs(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}