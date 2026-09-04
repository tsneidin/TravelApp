import { config } from '../config.js';

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
}

interface SearxngResult {
  title?: string;
  url?: string;
  content?: string;
  thumbnail?: string;
  img_src?: string;
  thumbnail_src?: string;
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

  if (isLocalDiscovery(q)) {
    try {
      return await fromNominatim(q, count);
    } catch (e) {
      console.error('[suggest] OpenStreetMap fallback failed:', e);
      return [];
    }
  }

  try {
    return await fromWikipedia(q, count);
  } catch (e) {
    console.error('[suggest] Wikipedia fallback failed:', e);
    return [];
  }
}