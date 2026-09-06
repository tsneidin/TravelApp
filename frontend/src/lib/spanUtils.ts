import type { Day, Place } from './types';

const SPAN_TAG_REGEX = /\[spanId:([a-zA-Z0-9_-]+)\]/g;

export function generateSpanId(): string {
  return `span_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export function extractSpanId(item?: { notes?: string | null; sourceText?: string | null } | null): string | null {
  if (!item) return null;
  const inNotes = item.notes?.match(/\[spanId:([a-zA-Z0-9_-]+)\]/);
  if (inNotes && inNotes[1]) return inNotes[1];
  const inSource = item.sourceText?.match(/\[spanId:([a-zA-Z0-9_-]+)\]/);
  if (inSource && inSource[1]) return inSource[1];
  return null;
}

export function embedSpanId(text: string | null | undefined, spanId: string): string {
  const clean = stripSpanId(text);
  if (!clean) {
    return `[spanId:${spanId}]`;
  }
  return `${clean}\n[spanId:${spanId}]`;
}

export function stripSpanId(text?: string | null): string {
  if (!text) return '';
  return text.replace(SPAN_TAG_REGEX, '').trim();
}

/**
 * Normalizes location key for matching sibling places if spanId is not present.
 */
export function getPlaceMatchKey(place: Partial<Place>): string {
  const name = (place.name || '').trim().toLowerCase();
  const address = (place.address || '').trim().toLowerCase();
  const cat = (place.category || '').trim().toLowerCase();
  return `${name}:::${address || cat}`;
}

/**
 * Returns all places in the trip that belong to the same multi-day series/span as targetPlace.
 */
export function findSpannedPlaces(
  targetPlace: Place,
  allPlaces: Place[],
  days: Day[]
): Place[] {
  if (!targetPlace || !allPlaces || allPlaces.length === 0) return [targetPlace];

  const spanId = extractSpanId(targetPlace);
  if (spanId) {
    const matched = allPlaces.filter((p) => extractSpanId(p) === spanId);
    if (matched.length > 0) {
      return sortPlacesByDay(matched, days);
    }
  }

  // Fallback: match by key across consecutive days if created similarly
  const targetKey = getPlaceMatchKey(targetPlace);
  if (!targetKey || targetKey === ':::') return [targetPlace];

  const matched = allPlaces.filter((p) => getPlaceMatchKey(p) === targetKey && p.dayId != null);
  if (matched.length > 1) {
    return sortPlacesByDay(matched, days);
  }

  return [targetPlace];
}

/**
 * Helper to sort places according to day chronological order
 */
function sortPlacesByDay(places: Place[], days: Day[]): Place[] {
  const dayIndexMap = new Map<string, number>();
  const sortedDays = [...days].sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.sortOrder - b.sortOrder);
  sortedDays.forEach((d, idx) => dayIndexMap.set(d.id, idx));

  return [...places].sort((a, b) => {
    const dayA = a.dayId ? (dayIndexMap.get(a.dayId) ?? 9999) : 9999;
    const dayB = b.dayId ? (dayIndexMap.get(b.dayId) ?? 9999) : 9999;
    if (dayA !== dayB) return dayA - dayB;
    return a.sortOrder - b.sortOrder;
  });
}

/**
 * Given a starting day ID and spanDays count, returns the consecutive Day objects.
 */
export function getConsecutiveDays(startDayId: string, spanDays: number, days: Day[]): Day[] {
  if (!startDayId || startDayId === 'unassigned' || spanDays <= 1) {
    const found = days.find((d) => d.id === startDayId);
    return found ? [found] : [];
  }

  const sortedDays = [...days].sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.sortOrder - b.sortOrder);
  const startIndex = sortedDays.findIndex((d) => d.id === startDayId);
  if (startIndex === -1) {
    const found = days.find((d) => d.id === startDayId);
    return found ? [found] : [];
  }

  return sortedDays.slice(startIndex, startIndex + spanDays);
}
