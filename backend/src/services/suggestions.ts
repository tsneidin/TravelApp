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
      if (r.length) return r;
    } catch (e) {
      console.warn('[suggest] SearXNG unavailable, using Wikipedia fallback:', (e as Error).message);
    }
  }
  try {
    return await fromWikipedia(q, count);
  } catch (e) {
    console.error('[suggest] Wikipedia fallback failed:', e);
    return [];
  }
}