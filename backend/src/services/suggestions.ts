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
        console.warn('[suggest] Google Places unavailable:', (e as Error).message);
        debugLog('suggest', 'provider_failed', { provider: 'google_places', error: (e as Error).message });
      }
    }
    return [];
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
