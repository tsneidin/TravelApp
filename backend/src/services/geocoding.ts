export interface GeocodedPlace {
  name: string;
  address: string;
  lat: number;
  lng: number;
  category: string;
  country?: string;
}

interface CacheEntry {
  data: GeocodedPlace[];
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_CACHE_ENTRIES = 500;

export function classifyCategory(osmKey?: string, osmValue?: string): string {
  const key = (osmKey || '').toLowerCase();
  const val = (osmValue || '').toLowerCase();

  // City / Town / Village / Region / Place
  if (['place', 'boundary'].includes(key) ||
      ['city', 'town', 'village', 'hamlet', 'suburb', 'neighbourhood', 'locality', 'municipality', 'administrative'].includes(val)) {
    return 'City';
  }

  // Restaurant / Food
  if (['restaurant', 'cafe', 'fast_food', 'bar', 'pub', 'food_court', 'bistro', 'bakery', 'ice_cream'].includes(val)) {
    return 'Restaurant';
  }
  // Accommodation
  if (['hotel', 'motel', 'hostel', 'guest_house', 'apartment', 'resort', 'chalet', 'camp_site', 'caravan_site'].includes(val)) {
    return 'Accommodation';
  }
  // Transport
  if (['aeroway', 'railway', 'bus_station', 'station', 'ferry_terminal', 'subway_entrance'].includes(key) ||
      ['airport', 'station', 'subway', 'terminal', 'bus_station', 'train_station'].includes(val)) {
    return 'Transport';
  }
  // Shopping
  if (key === 'shop' || ['mall', 'supermarket', 'department_store', 'marketplace', 'boutique'].includes(val)) {
    return 'Shopping';
  }
  // Activity
  if (['theme_park', 'water_park', 'zoo', 'aquarium', 'stadium', 'sports_centre', 'cinema', 'theatre'].includes(val)) {
    return 'Activity';
  }
  // Sightseeing (default for tourism, historic, leisure, places)
  if (['tourism', 'historic'].includes(key) ||
      ['museum', 'attraction', 'viewpoint', 'monument', 'memorial', 'castle', 'ruins', 'artwork', 'park', 'church', 'cathedral', 'temple', 'shrine'].includes(val)) {
    return 'Sightseeing';
  }

  return 'Sightseeing';
}

async function fetchWithTimeout(url: string, headers: Record<string, string> = {}, timeoutMs = 4000): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    name?: string;
    street?: string;
    housenumber?: string;
    city?: string;
    town?: string;
    village?: string;
    county?: string;
    state?: string;
    country?: string;
    type?: string;
    osm_key?: string;
    osm_value?: string;
  };
}

async function searchViaPhoton(query: string, biasLat?: number, biasLng?: number, limit = 6): Promise<GeocodedPlace[]> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  if (biasLat != null && biasLng != null) {
    params.set('lat', String(biasLat));
    params.set('lon', String(biasLng));
  }
  const url = `https://photon.komoot.io/api/?${params.toString()}`;
  const data = (await fetchWithTimeout(url)) as { features?: PhotonFeature[] };

  const places: GeocodedPlace[] = [];
  for (const feat of data.features ?? []) {
    const props = feat.properties;
    const [lon, lat] = feat.geometry?.coordinates ?? [];
    if (lat == null || lon == null) continue;

    const name = props.name || props.street || query;
    const isCityOrPlace = ['place', 'boundary'].includes(props.osm_key || '') ||
      ['city', 'town', 'village', 'hamlet', 'suburb', 'neighbourhood', 'locality', 'municipality', 'administrative'].includes(props.osm_value || '') ||
      ['city', 'town', 'village', 'locality'].includes(props.type || '');

    const street = props.housenumber && props.street ? `${props.housenumber} ${props.street}` : (props.street || '');
    const city = props.city || props.town || props.village || (isCityOrPlace ? name : '');
    const county = props.county || '';
    const state = props.state || '';
    const country = props.country || '';

    const parts: string[] = [];
    if (street) parts.push(street);
    if (city && !parts.includes(city)) parts.push(city);
    if (county && county !== city && !parts.includes(county)) parts.push(county);
    if (state && !parts.includes(state)) parts.push(state);
    if (country && !parts.includes(country)) parts.push(country);

    // If it's a specific named place not yet in parts, prepend it
    if (name && !parts.includes(name)) {
      parts.unshift(name);
    }

    const address = parts.length > 0 ? parts.join(', ') : name;

    places.push({
      name,
      address,
      lat: Number(lat.toFixed(6)),
      lng: Number(lon.toFixed(6)),
      category: classifyCategory(props.osm_key, props.osm_value),
      country: country || undefined,
    });
  }
  return places;
}

interface NominatimResult {
  name?: string;
  display_name?: string;
  class?: string;
  type?: string;
  lat?: string;
  lon?: string;
  address?: {
    country?: string;
    city?: string;
    town?: string;
  };
}

async function searchViaNominatim(query: string, limit = 6): Promise<GeocodedPlace[]> {
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    addressdetails: '1',
    limit: String(limit),
  });
  const url = `https://nominatim.openstreetmap.org/search?${params.toString()}`;
  const data = (await fetchWithTimeout(url, {
    'User-Agent': 'TravelApp/1.0 (travel-planner)',
    Accept: 'application/json',
  })) as NominatimResult[];

  return (data || []).map((item) => {
    const name = item.name || (item.display_name ? item.display_name.split(',')[0] : query);
    return {
      name: name.trim(),
      address: item.display_name || name,
      lat: Number(Number(item.lat).toFixed(6)),
      lng: Number(Number(item.lon).toFixed(6)),
      category: classifyCategory(item.class, item.type),
      country: item.address?.country,
    };
  });
}

export async function searchPlaces(
  query: string,
  options?: { biasLat?: number; biasLng?: number; limit?: number },
): Promise<GeocodedPlace[]> {
  const q = query.trim();
  if (!q) return [];

  // If query is direct lat, lng coordinates
  const coordMatch = q.match(/^(-?\d+(\.\d+)?)\s*,\s*(-?\d+(\.\d+)?)$/);
  if (coordMatch) {
    const lat = Number(Number(coordMatch[1]).toFixed(6));
    const lng = Number(Number(coordMatch[3]).toFixed(6));
    if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      return [{
        name: `${lat}, ${lng}`,
        address: `${lat}, ${lng}`,
        lat,
        lng,
        category: 'Sightseeing',
      }];
    }
  }

  const biasLat = options?.biasLat;
  const biasLng = options?.biasLng;
  const limit = options?.limit ?? 6;

  const cacheKey = `${q.toLowerCase()}|${biasLat?.toFixed(2) ?? ''}|${biasLng?.toFixed(2) ?? ''}|${limit}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  let results: GeocodedPlace[] = [];

  // Try Photon first
  try {
    results = await searchViaPhoton(q, biasLat, biasLng, limit);
  } catch (err) {
    console.warn('[geocoding] Photon search failed, falling back to Nominatim:', (err as Error).message);
  }

  // If Photon returned nothing or failed, try Nominatim
  if (results.length === 0) {
    try {
      results = await searchViaNominatim(q, limit);
    } catch (err) {
      console.error('[geocoding] Nominatim search also failed:', (err as Error).message);
    }
  }

  // Prioritize city/administrative boundaries when query matches
  results.sort((a, b) => {
    const aIsCity = a.category === 'City';
    const bIsCity = b.category === 'City';
    const qLower = q.toLowerCase();
    const aExact = a.name.toLowerCase() === qLower || a.address.toLowerCase().startsWith(qLower);
    const bExact = b.name.toLowerCase() === qLower || b.address.toLowerCase().startsWith(qLower);

    if (aIsCity && aExact && (!bIsCity || !bExact)) return -1;
    if (bIsCity && bExact && (!aIsCity || !aExact)) return 1;
    if (aIsCity && !bIsCity) return -1;
    if (bIsCity && !aIsCity) return 1;
    return 0;
  });

  // Cache results if we found any
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
  cache.set(cacheKey, { data: results, expiresAt: Date.now() + CACHE_TTL_MS });

  return results;
}
