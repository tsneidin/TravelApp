import type { Day, Place } from './types';

/**
 * Normalizes a place name by stripping emojis and multi-day prefixes
 * (Check-in, Stay, Check-out, Pick-up, Drop-off, etc.) so repeated stays
 * or segments at the same location can be recognized.
 */
export function normalizePlaceLocationKey(place: Place): string {
  const cleanName = (place.name || '')
    .replace(/^(?:🏨|✈️|🚗|🎟️|🛬|🛫|🏠|📍|🚂|🚆|⛵|🚢|🍽️|☕)\s*/, '')
    .replace(/^(?:Check-in|Check-out|Stay|Pick-up|Drop-off|Arrival|Departure|Return)[:\s-]*/i, '')
    .trim()
    .toLowerCase();

  const isAccommodation =
    place.category?.toLowerCase() === 'accommodation' ||
    /hotel|apartment|airbnb|hostel|villa|resort|accommodation|lodging/i.test(place.name || '');

  const normAddress = (place.address || '').trim().toLowerCase();

  // If coordinates exist, round to ~100m precision (3 decimal places)
  const coordKey =
    place.lat != null && place.lng != null
      ? `${place.lat.toFixed(3)},${place.lng.toFixed(3)}`
      : '';

  // For accommodations: clean name (or clean name + address/coords) represents the single stay
  if (isAccommodation && cleanName.length >= 2) {
    return `stay:${cleanName}`;
  }

  // If address or coords exist with a matching clean name
  if (normAddress && cleanName.length >= 2) {
    return `loc:${cleanName}:${normAddress}`;
  }

  if (coordKey && cleanName.length >= 2) {
    return `coord:${cleanName}:${coordKey}`;
  }

  // Unique place by id if no shared name/location pattern
  return `place:${place.id}`;
}

/**
 * Computes trip-wide sequential stop numbers where multi-day itinerary items
 * at the same location (e.g. 🏨 Vesuvio Terrace Apartment across Days 1-4)
 * share the same stop number that corresponds to a single map pin.
 */
export function computePlaceStopNumberMap(
  days: Day[],
  orphanPlaces: Place[] = [],
): Map<string, number> {
  const map = new Map<string, number>();
  const keyToStopNumber = new Map<string, number>();
  let nextNumber = 1;

  const sortedDays = [...days].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime() || a.sortOrder - b.sortOrder,
  );

  const processPlace = (place: Place) => {
    const key = normalizePlaceLocationKey(place);
    if (keyToStopNumber.has(key)) {
      map.set(place.id, keyToStopNumber.get(key)!);
    } else {
      const assigned = nextNumber;
      nextNumber += 1;
      keyToStopNumber.set(key, assigned);
      map.set(place.id, assigned);
    }
  };

  for (const day of sortedDays) {
    for (const place of day.places || []) {
      processPlace(place);
    }
  }

  for (const place of orphanPlaces) {
    processPlace(place);
  }

  return map;
}
