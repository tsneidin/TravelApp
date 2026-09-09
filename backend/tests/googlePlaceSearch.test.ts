import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchGooglePlaces } from '../src/services/googlePlaceSearch.js';

afterEach(() => vi.unstubAllGlobals());

describe('Google place search', () => {
  it('uses text search with a location bias and preserves Google result order', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ places: [
      { displayName: { text: 'Cafe Kyoto' }, formattedAddress: 'Kyoto, Japan', location: { latitude: 35, longitude: 135 }, primaryType: 'cafe', websiteUri: 'https://example.test' },
      { displayName: { text: 'Kyoto' }, location: { latitude: 35.1, longitude: 135.1 }, primaryType: 'locality' },
      { displayName: { text: 'Missing coordinates' } },
    ] }) });
    vi.stubGlobal('fetch', fetchMock);
    const results = await searchGooglePlaces('test-key', 'coffee in Kyoto', { biasLat: 35, biasLng: 135, limit: 6 });
    expect(results.map((p) => p.name)).toEqual(['Cafe Kyoto', 'Kyoto']);
    expect(results[0]).toMatchObject({ category: 'Restaurant', website: 'https://example.test', lat: 35 });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ textQuery: 'coffee in Kyoto', pageSize: 6, locationBias: { circle: { center: { latitude: 35, longitude: 135 } } } });
  });

  it('reports provider failure instead of presenting it as no matches', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
    await expect(searchGooglePlaces('test-key', 'cafe', {})).rejects.toThrow('Google place search is unavailable');
  });
});
