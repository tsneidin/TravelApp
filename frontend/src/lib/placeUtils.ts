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

function cleanCityToken(tok: string): string | null {
  if (!tok) return null;
  let c = tok.trim();

  // Strip trailing country if attached
  c = c.replace(/,\s*(?:Italy|Italia|USA|United States|France|Spain|Germany|UK|Japan)$/i, '');
  // Strip leading postal codes (e.g. "84091 Battipaglia SA", "73100 Lecce", "75001 Paris")
  c = c.replace(/^(?:[A-Z]{1,2}-)?\d{4,6}\s+/, '');
  // Strip trailing postal codes (e.g. "Chicago 60613", "IL 60613")
  c = c.replace(/\s+\d{5}(?:-\d{4})?$/, '');
  // Strip province codes in parentheses: "(BA)", "(BR)", "(LE)", "(TA)", etc.
  c = c.replace(/\s*\([A-Za-z]{2}\)$/, '');
  // Strip trailing 2-letter state / province codes (e.g. "Battipaglia SA" -> "Battipaglia", "Chicago IL" -> "Chicago")
  c = c.replace(/\s+[A-Z]{2}$/, '');
  // Strip leading numbers or street remnants e.g. "1060 W Addison"
  c = c.replace(/^\d+[\s\w]*\s+/, '');

  c = c.trim();

  // Ignore 2-letter state/country codes or purely numeric tokens
  if (/^[A-Za-z]{2}$/.test(c) || /^\d+$/.test(c)) return null;

  // Blacklist hotel, lodging and venue words so business names are never treated as cities
  if (
    /\b(hotel|albergo|resort|hostel|inn|motel|tenuta|masseria|relais|chalet|palace|villa|b&b|bed & breakfast|restaurant|ristorante|bar|cafe|pizzeria|trattoria|shop|store|museum|park)\b/i.test(
      c,
    )
  ) {
    return null;
  }

  if (c.length >= 2 && c.length <= 45) {
    return c;
  }
  return null;
}

function isStreetToken(t: string): boolean {
  return /^(?:via|viale|corso|piazza|piazzale|strada|contrada|vicolo|largo|rue|calle|street|st|ave|avenue|blvd|rd|road|\d+)\b/i.test(
    t.trim(),
  );
}

/**
 * Extracts a clean city name from a formatted address, location string, or place title.
 * Returns null if the string represents a hotel name or cannot be safely parsed to a city.
 */
export function extractCityFromLocation(raw?: string | null): string | null {
  if (!raw) return null;
  let s = raw.trim();
  if (!s) return null;

  // Ignore raw coordinates e.g. "40.853, 14.268"
  if (/^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(s)) return null;

  // If contains flight / transit arrow "A -> B" or "A → B", take the destination
  if (/→|->/.test(s)) {
    const parts = s.split(/→|->/);
    s = parts[parts.length - 1].trim();
  }

  // Remove airport / station suffixes
  s = s.replace(/\s*\([A-Z]{3}\)/g, '');
  s = s.replace(/\s+(?:International\s+)?Airport\b/gi, '');
  s = s.replace(/\s+(?:Central\s+)?Station\b/gi, '');
  s = s.replace(/\s+Terminal\b/gi, '');

  // Strip carrier prefixes and action words
  s = s.replace(/^Operated\s+by[^\n]*\n+/i, '');
  s = s.replace(/^Operated\s+by\s+(?:Envoy\s+Air|SkyWest|American\s+Eagle|[A-Za-z\s]+?)\s+(?=[A-Z][a-z]+)/i, '');
  s = s.replace(/^(?:Arrive|Arrival|Depart|Departure|From|To|At|In)\s+/i, '');
  s = s.replace(/^[A-Za-z]\s+/i, ''); // stray single letter OCR artifact

  const tokens = s.split(',').map((t) => t.trim()).filter(Boolean);

  if (tokens.length >= 2) {
    if (tokens.length === 2) {
      if (isStreetToken(tokens[0])) {
        const city2 = cleanCityToken(tokens[1]);
        if (city2) return city2;
      } else {
        const city1 = cleanCityToken(tokens[0]);
        if (city1) return city1;
        const city2 = cleanCityToken(tokens[1]);
        if (city2) return city2;
      }
    } else {
      // 3+ tokens, e.g. ["Via Umberto I", "12", "73100 Lecce"] or ["Via Spineta", "84091 Battipaglia SA", "Italy"]
      const lastIdx = /^(?:italy|italia|usa|united states|spain|france|germany|uk|japan)$/i.test(tokens[tokens.length - 1])
        ? tokens.length - 2
        : tokens.length - 1;

      for (let i = lastIdx; i >= 0; i--) {
        if (isStreetToken(tokens[i])) continue;
        if (/^\d+$/.test(tokens[i])) continue;
        const city = cleanCityToken(tokens[i]);
        if (city) return city;
      }

      const fallback = cleanCityToken(tokens[lastIdx]);
      if (fallback) return fallback;
    }
  }

  if (tokens.length === 1) {
    return cleanCityToken(tokens[0]);
  }

  return null;
}

/**
 * Resolves the location of an itinerary day following the priority cascade:
 * 1. Day's explicit location field
 * 2. Day's lodging / accommodation location (extracted city preferred)
 * 3. Day's last activity location (extracted city preferred)
 * 4. Carried forward from previous day
 * 5. Trip destination
 */
export function resolveDayLocation(
  dayIndex: number,
  sortedDays: Day[],
  tripDestination?: string | null,
): ResolvedDayLocation {
  if (dayIndex < 0 || dayIndex >= sortedDays.length) {
    const destCity = extractCityFromLocation(tripDestination) || tripDestination?.trim();
    return destCity
      ? { name: destCity, address: tripDestination?.trim(), source: 'trip_destination' }
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
    const locAddress = primaryLodging.address?.trim();
    // Prefer extracted city name so the day location doesn't display hotel names
    const extractedCity =
      extractCityFromLocation(locAddress) ||
      extractCityFromLocation(locName);

    const displayName = extractedCity || locAddress || locName;

    return {
      name: displayName,
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
    const actAddress = lastActivity.address?.trim();
    const extractedCity =
      extractCityFromLocation(actAddress) ||
      extractCityFromLocation(actName);

    const displayName = extractedCity || actAddress || actName;

    return {
      name: displayName,
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
    const destCity = extractCityFromLocation(tripDestination) || tripDestination.trim();
    return {
      name: destCity,
      address: tripDestination.trim(),
      source: 'trip_destination',
    };
  }

  return { name: '', source: 'none' };
}

