import type { Day, Place } from './types';

/**
 * Cleans emojis and prefixes (like Stay:, Check-in:, Check-out:) from place or stay titles.
 */
export function cleanPlaceOrStayTitle(title?: string | null): string {
  if (!title) return '';
  return title
    .replace(/^(?:🏨|🛏️|🛏|✈️|✈|🚆|🚗|🎟️|🎟|🏛️|🏛|🍽️|🍽|📝|📍|🏠)\s*/, '')
    .replace(/^(?:Check-in|Check-out|Stay|Departure|Arrival)[:\s-]*/i, '')
    .trim();
}

/**
 * Checks whether an item or place represents an accommodation / stay.
 */
export function isAccommodationItem(item?: {
  category?: string | null;
  name?: string | null;
  title?: string | null;
  type?: string | null;
} | null): boolean {
  if (!item) return false;
  if (item.type === 'hotel' || item.type === 'lodging') return true;
  const cat = (item.category || '').toLowerCase().trim();
  if (
    cat === 'accommodation' ||
    cat === 'hotel' ||
    cat === 'lodging' ||
    cat === 'stay' ||
    cat === 'resort' ||
    cat === 'b&b' ||
    cat === 'bnb' ||
    cat === 'hostel' ||
    cat === 'villa' ||
    cat === 'apartment' ||
    cat === 'airbnb' ||
    cat === 'motel' ||
    cat === 'inn' ||
    cat === 'guesthouse' ||
    cat === 'guest house'
  ) {
    return true;
  }
  const text = `${cat} ${item.name || ''} ${item.title || ''}`.toLowerCase();
  return /\b(hotel|albergo|lodging|accommodation|apartment|airbnb|hostel|resort|villa|inn\b|motel|b&b\b|bed & breakfast|bed and breakfast|guesthouse|guest house|cottage|ryokan|pension|suites)\b/i.test(
    text,
  );
}

/**
 * Checks whether an item or place represents transit / transportation.
 */
export function isTransitItem(item?: {
  category?: string | null;
  name?: string | null;
  title?: string | null;
  type?: string | null;
} | null): boolean {
  if (!item) return false;
  if (item.type === 'flight' || item.type === 'car' || item.type === 'transit') return true;
  const cat = (item.category || '').toLowerCase().trim();
  if (
    cat === 'transport' ||
    cat === 'transit' ||
    cat === 'flight' ||
    cat === 'train' ||
    cat === 'car' ||
    cat === 'ferry'
  ) {
    return true;
  }
  const text = `${cat} ${item.name || ''} ${item.title || ''}`.toLowerCase();
  return /flight|airline|american airlines|delta|united|lufthansa|ryanair|easyjet|air france|ita airways|british airways|train|frecciarossa|italo|eurostar|amtrak|flixbus|ferry|hydrofoil|car rental|rent-a-car/i.test(
    text,
  );
}

export function isAccommodation(place: Place): boolean {
  return isAccommodationItem(place);
}

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

  const isAccom = isAccommodationItem(place);
  const normAddress = (place.address || '').trim().toLowerCase();

  // If coordinates exist, round to ~100m precision (3 decimal places)
  const coordKey =
    place.lat != null && place.lng != null
      ? `${place.lat.toFixed(3)},${place.lng.toFixed(3)}`
      : '';

  // For accommodations: clean name (or clean name + address/coords) represents the single stay
  if (isAccom && cleanName.length >= 2) {
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

export function isNoteItem(place: Place): boolean {
  const cat = (place.category || '').toLowerCase().trim();
  return cat === 'note' || cat === 'notes';
}

export interface ResolvedDayLocation {
  name: string;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  source: 'explicit' | 'lodging' | 'last_activity' | 'carried_forward' | 'trip_destination' | 'none';
}

/**
 * Resolves the location of an itinerary day following the priority cascade:
 * 1. Day's explicit location field
 * 2. Day's lodging / accommodation location
 * 3. Day's last activity location
 * 4. Carried forward from previous day
 * 5. Trip destination
 */
export function resolveDayLocation(
  dayIndex: number,
  sortedDays: Day[],
  tripDestination?: string | null,
): ResolvedDayLocation {
  if (dayIndex < 0 || dayIndex >= sortedDays.length) {
    return tripDestination?.trim()
      ? { name: tripDestination.trim(), address: tripDestination.trim(), source: 'trip_destination' }
      : { name: '', source: 'none' };
  }

  const day = sortedDays[dayIndex];

  // 1. Explicit day location
  if (day.location && day.location.trim()) {
    return {
      name: day.location.trim(),
      address: day.location.trim(),
      lat: day.lat,
      lng: day.lng,
      source: 'explicit',
    };
  }

  // 2. Day's lodging location
  const places = day.places || [];
  const lodgingPlaces = places.filter(isAccommodationItem);
  if (lodgingPlaces.length > 0) {
    const primaryLodging = lodgingPlaces[0];
    const locName = cleanPlaceOrStayTitle(primaryLodging.name);
    const locAddress = primaryLodging.address?.trim() || locName;
    return {
      name: locAddress,
      address: primaryLodging.address,
      lat: primaryLodging.lat,
      lng: primaryLodging.lng,
      source: 'lodging',
    };
  }

  // 3. Day's last activity location
  const activityPlaces = places.filter(
    (p) =>
      !isNoteItem(p) &&
      (p.address?.trim() || p.name?.trim() || (p.lat != null && p.lng != null)),
  );
  if (activityPlaces.length > 0) {
    const lastActivity = activityPlaces[activityPlaces.length - 1];
    const actName = cleanPlaceOrStayTitle(lastActivity.name);
    const actAddress = lastActivity.address?.trim() || actName;
    return {
      name: actAddress,
      address: lastActivity.address,
      lat: lastActivity.lat,
      lng: lastActivity.lng,
      source: 'last_activity',
    };
  }

  // 4. Carried forward from previous day
  if (dayIndex > 0) {
    const prevResolved = resolveDayLocation(dayIndex - 1, sortedDays, tripDestination);
    if (prevResolved.source !== 'none' && prevResolved.name) {
      return {
        ...prevResolved,
        source: 'carried_forward',
      };
    }
  }

  // 5. Trip destination fallback
  if (tripDestination && tripDestination.trim()) {
    return {
      name: tripDestination.trim(),
      address: tripDestination.trim(),
      source: 'trip_destination',
    };
  }

  return { name: '', source: 'none' };
}

