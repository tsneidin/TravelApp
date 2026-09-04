import { config } from '../config.js';
import { debugLog } from '../lib/debug.js';

export interface Suggestion {
  title: string;
  url?: string;
  thumbnail?: string;
  summary?: string;
  lat?: number;
  lng?: number;
  dayId?: string;
  recommendedAt?: string;
  context?: string;
  mapUrl?: string;
  rating?: number;
  reviewCount?: number;
  openNow?: boolean;
}

interface GooglePlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  rating?: number;
  userRatingCount?: number;
  websiteUri?: string;
  googleMapsUri?: string;
  currentOpeningHours?: { openNow?: boolean; weekdayDescriptions?: string[] };
  regularOpeningHours?: { weekdayDescriptions?: string[] };
}

interface SearxngResult {
  title?: string;
  url?: string;
  content?: string;
  thumbnail?: string;
  img_src?: string;
  thumbnail_src?: string;
}

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat?: number; lon?: number };
  tags?: Record<string, string>;
}

interface NominatimResult {
  osm_type?: 'node' | 'way' | 'relation';
  osm_id?: number;
  lat?: string;
  lon?: string;
  display_name?: string;
  name?: string;
  type?: string;
  category?: string;
  extratags?: {
    website?: string;
    contact_website?: string;
    opening_hours?: string;
    cuisine?: string;
  };
}

interface WikiResult {
  title?: string;
  url?: string;
  thumbnail?: string;
  extract?: string;
}

async function fetchJson(url: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Query a SearXNG instance for web/image results with thumbnails. */
async function fromSearxng(query: string, count: number): Promise<Suggestion[]> {
  const base = config.search.searxngUrl.replace(/\/+$/, '');
  const url = `${base}/search?q=${encodeURIComponent(query)}&format=json&number_of_results=${count}`;
  const data = (await fetchJson(url, config.search.timeoutMs)) as { results?: SearxngResult[] };
  return (data.results ?? [])
    .slice(0, count)
    .filter((r) => r.title && r.url)
    .map((r) => ({
      title: r.title as string,
      url: r.url as string,
      thumbnail: r.thumbnail || r.thumbnail_src || r.img_src || undefined,
      summary: r.content ? String(r.content).slice(0, 220) : undefined,
    }));
}

function isLocalDiscovery(query: string): boolean {
  return /(restaurants?|pizza|coffee|cafes?|bars?|breakfast|lunch|dinner|food|shops?|shopping|hotels?|lodging|laundromat|pharmacy|grocer|market|music|shows?|events?|tours?|museums?|parks?|hikes?|beaches?|nearby|open around)/i.test(query);
}

function localSearchQuery(query: string): string {
  return query
    .replace(/\s+open around\s+.*$/i, '')
    .replace(/\s+highly rated reviews\s*$/i, '')
    .replace(/\b[A-Z]{3}\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function searchSubject(query: string): string {
  const match = /(pizza|restaurants?|coffee|cafes?|bars?|breakfast|lunch|dinner|food|shops?|hotels?|laundromat|pharmacy|grocer|market|museums?|parks?|beaches?)/i.exec(query);
  return match?.[1]?.toLowerCase() ?? 'places';
}

function anchorQuery(query: string): string {
  return localSearchQuery(query)
    .replace(/\b(pizza|restaurants?|coffee|cafes?|bars?|breakfast|lunch|dinner|food|shops?|shopping|hotels?|lodging|laundromat|pharmacy|grocer|market|music|shows?|events?|tours?|museums?|parks?|hikes?|beaches?|close|near|nearby|around|highly|rated|reviews?)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function geocodeAnchor(query: string): Promise<{ lat: number; lng: number; label: string } | null> {
  const url =
    'https://nominatim.openstreetmap.org/search?' +
    new URLSearchParams({ q: query, format: 'jsonv2', limit: '1' }).toString();
  const data = (await fetchJson(url, config.search.timeoutMs)) as NominatimResult[];
  const hit = data[0];
  const lat = Number(hit?.lat);
  const lng = Number(hit?.lon);
  return Number.isFinite(lat) && Number.isFinite(lng)
    ? { lat, lng, label: hit.display_name || query }
    : null;
}

/** Google Places Text Search (New). The API key stays server-side. */
async function fromGooglePlaces(query: string, count: number): Promise<Suggestion[]> {
  if (!config.search.googlePlacesApiKey) return [];
  const started = Date.now();
  debugLog('places', 'search_start', { query: localSearchQuery(query), count });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.search.timeoutMs);
  try {
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': config.search.googlePlacesApiKey,
        'X-Goog-FieldMask': [
          'places.id', 'places.displayName', 'places.formattedAddress', 'places.location',
          'places.rating', 'places.userRatingCount', 'places.websiteUri',
          'places.googleMapsUri', 'places.currentOpeningHours', 'places.regularOpeningHours',
        ].join(','),
      },
      body: JSON.stringify({
        textQuery: localSearchQuery(query),
        pageSize: Math.min(Math.max(count, 1), 20),
        rankPreference: 'RELEVANCE',
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Google Places HTTP ${res.status}: ${detail.slice(0, 180)}`);
    }
    const data = (await res.json()) as { places?: GooglePlace[] };
    debugLog('places', 'search_complete', { query: localSearchQuery(query), results: data.places?.length ?? 0, durationMs: Date.now() - started });
    return (data.places ?? []).flatMap((place) => {
      const title = place.displayName?.text?.trim();
      const lat = place.location?.latitude;
      const lng = place.location?.longitude;
      if (!title) return [];
      const rating = place.rating;
      const reviewCount = place.userRatingCount;
      const openNow = place.currentOpeningHours?.openNow;
      const ratingText = rating == null ? undefined
        : `${rating.toFixed(1)} ★${reviewCount != null ? ` (${reviewCount.toLocaleString()} reviews)` : ''}`;
      const openText = openNow == null ? undefined : openNow ? 'Open now' : 'Closed now';
      return [{
        title,
        url: place.websiteUri || place.googleMapsUri,
        mapUrl: place.googleMapsUri || (lat != null && lng != null
          ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
          : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(title)}`),
        summary: [ratingText, openText, place.formattedAddress].filter(Boolean).join(' · '),
        lat, lng, rating, reviewCount, openNow,
      }];
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Find many geographically relevant businesses around the requested location. */
async function fromOverpass(query: string, count: number): Promise<Suggestion[]> {
  const anchorText = anchorQuery(query);
  const anchor = await geocodeAnchor(anchorText);
  if (!anchor) return [];

  const subject = searchSubject(query);
  const amenity = /coffee|cafe|breakfast/.test(subject)
    ? 'cafe|restaurant'
    : /bar/.test(subject)
      ? 'bar|pub|restaurant'
      : /pizza|restaurant|lunch|dinner|food/.test(subject)
        ? 'restaurant|fast_food'
        : 'restaurant|cafe|fast_food|bar|pub';
  const radius = /airport/i.test(anchorText) ? 18000 : 10000;
  const q = `[out:json][timeout:20];(
    nwr(around:${radius},${anchor.lat},${anchor.lng})["amenity"~"^(${amenity})$"];
  );out center tags;`;
  const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(q)}`;
  const data = (await fetchJson(url, Math.max(config.search.timeoutMs, 25000))) as { elements?: OverpassElement[] };

  const mapped = (data.elements ?? []).flatMap((el) => {
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    const tags = el.tags ?? {};
    const title = tags.name || tags['name:en'];
    if (!title || lat == null || lng == null) return [];
    const cuisine = tags.cuisine ?? '';
    const pizzaRelevant = /pizza/i.test(title) || /pizza|italian/i.test(cuisine);
    const km = distanceKm(anchor.lat, anchor.lng, lat, lng);
    const osmUrl = `https://www.openstreetmap.org/${el.type}/${el.id}`;
    const website = tags.website || tags['contact:website'];
    const details = [
      `${km.toFixed(1)} km from ${anchorText}`,
      cuisine ? `Cuisine: ${cuisine}` : undefined,
      tags.opening_hours ? `Hours: ${tags.opening_hours}` : undefined,
      tags.addr_street ? `${tags.addr_housenumber ?? ''} ${tags.addr_street}`.trim() : undefined,
    ].filter(Boolean).join(' · ');
    return [{
      title,
      url: website || osmUrl,
      mapUrl: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
      summary: details,
      lat,
      lng,
      _distance: km,
      _pizzaRelevant: pizzaRelevant,
    }];
  });

  const sorted = mapped.sort((a, b) => {
    if (/pizza/i.test(subject) && a._pizzaRelevant !== b._pizzaRelevant) return a._pizzaRelevant ? -1 : 1;
    return a._distance - b._distance;
  });
  const seen = new Set<string>();
  return sorted
    .filter((item) => {
      const key = item.title.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return !/pizza/i.test(subject) || item._pizzaRelevant;
    })
    .slice(0, count)
    .map(({ _distance, _pizzaRelevant, ...item }) => item);
}

/** Local-place fallback using OpenStreetMap's Nominatim index. */
async function fromNominatim(query: string, count: number): Promise<Suggestion[]> {
  const clean = localSearchQuery(query);
  const url =
    'https://nominatim.openstreetmap.org/search?' +
    new URLSearchParams({
      q: clean,
      format: 'jsonv2',
      addressdetails: '1',
      extratags: '1',
      namedetails: '1',
      limit: String(Math.min(count * 2, 20)),
    }).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.search.timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'TravelApp/0.0.19 (self-hosted trip planner)',
      },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
    const data = (await res.json()) as NominatimResult[];
    const seen = new Set<string>();
    const out: Suggestion[] = [];
    for (const place of data) {
      const lat = Number(place.lat);
      const lng = Number(place.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const title = place.name || place.display_name?.split(',')[0]?.trim();
      if (!title || seen.has(title.toLowerCase())) continue;
      seen.add(title.toLowerCase());
      const osmUrl = place.osm_type && place.osm_id
        ? `https://www.openstreetmap.org/${place.osm_type}/${place.osm_id}`
        : `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}`;
      const website = place.extratags?.website || place.extratags?.contact_website;
      const details = [
        place.display_name,
        place.extratags?.cuisine ? `Cuisine: ${place.extratags.cuisine}` : undefined,
        place.extratags?.opening_hours ? `Hours: ${place.extratags.opening_hours}` : undefined,
      ].filter(Boolean).join(' · ');
      out.push({
        title,
        url: website || osmUrl,
        mapUrl: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
        summary: details || undefined,
        lat,
        lng,
      });
      if (out.length >= count) break;
    }
    return out;
  } finally {
    clearTimeout(timer);
  }
}

/** Fallback: Wikipedia search with page images + opening extract (no key). */
async function fromWikipedia(query: string, count: number): Promise<Suggestion[]> {
  const url =
    'https://en.wikipedia.org/w/api.php?' +
    new URLSearchParams({
      action: 'query',
      generator: 'search',
      gsrnamespace: '0',
      gsrlimit: String(count),
      gsrsearch: query,
      prop: 'pageimages|extracts',
      exchars: '220',
      explaintext: '1',
      piprop: 'thumbnail',
      pithumbsize: '400',
      format: 'json',
      origin: '*',
    }).toString();

  const data = (await fetchJson(url, config.search.timeoutMs)) as {
    query?: { pages?: Record<string, WikiResult & { pageid?: number; title?: string }> };
  };
  const pages = data.query?.pages ?? {};
  const out: Suggestion[] = [];
  for (const key of Object.keys(pages)) {
    const p = pages[key];
    if (!p?.title) continue;
    const pageurl = p.url ?? `https://en.wikipedia.org/wiki/${p.title.replace(/\s+/g, '_')}`;
    if (out.length >= count) break;
    out.push({
      title: p.title,
      url: pageurl,
      thumbnail: p.thumbnail ?? undefined,
      summary: p.extract?.trim() || undefined,
    });
  }
  return out;
}

/**
 * Return structured suggestions for a travel query. Tries the configured
 * SearXNG instance first (falls back cleanly if unreachable), then Wikipedia.
 */
export async function fetchSuggestions(query: string, count = 8): Promise<Suggestion[]> {
  const q = query.trim();
  if (!q) return [];
  debugLog('suggest', 'route', { query: q, count, local: isLocalDiscovery(q), googleConfigured: Boolean(config.search.googlePlacesApiKey) });
  if (isLocalDiscovery(q)) {
    if (config.search.googlePlacesApiKey) {
      try {
        const google = await fromGooglePlaces(q, count);
        if (google.length) {
          debugLog('suggest', 'provider_selected', { provider: 'google_places', results: google.length });
          return google;
        }
      } catch (e) {
        console.warn('[suggest] Google Places unavailable; using OpenStreetMap:', (e as Error).message);
        debugLog('suggest', 'provider_failed', { provider: 'google_places', error: (e as Error).message });
      }
    }
    try {
      const nearby = await fromOverpass(q, count);
      if (nearby.length) return nearby;
    } catch (e) {
      console.warn('[suggest] Overpass unavailable:', (e as Error).message);
    }
    try {
      return await fromNominatim(q, count);
    } catch (e) {
      console.error('[suggest] OpenStreetMap fallback failed:', e);
      return [];
    }
  }

  if (config.search.enabled) {
    try {
      const r = await fromSearxng(q, count);
      if (r.length) {
        return r.map((item) => ({
          ...item,
          mapUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(item.title)}`,
        }));
      }
    } catch (e) {
      console.warn('[suggest] SearXNG unavailable:', (e as Error).message);
    }
  }

  try {
    return await fromWikipedia(q, count);
  } catch (e) {
    console.error('[suggest] Wikipedia fallback failed:', e);
    return [];
  }
}