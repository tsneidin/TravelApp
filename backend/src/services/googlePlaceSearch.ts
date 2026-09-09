import type { GeocodedPlace } from './geocoding.js';
import { HttpError } from '../lib/errors.js';

export async function searchGooglePlaces(apiKey: string, query: string, options: { biasLat?: number; biasLng?: number; limit?: number }): Promise<(GeocodedPlace & { website?: string })[]> {
  const body: Record<string, unknown> = { textQuery: query, pageSize: Math.max(1, Math.min(20, options.limit || 6)) };
  if (Number.isFinite(options.biasLat) && Number.isFinite(options.biasLng)) {
    body.locationBias = { circle: { center: { latitude: options.biasLat, longitude: options.biasLng }, radius: 50000 } };
  }
  const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST', signal: AbortSignal.timeout(6000),
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location,places.primaryType,places.websiteUri' },
    body: JSON.stringify(body),
  }).catch(() => { throw new HttpError(503, 'Google place search could not connect. Try again or enter a title manually.'); });
  if (!response.ok) throw new HttpError(503, 'Google place search is unavailable. Try again or enter a title manually.');
  const data = await response.json() as { places?: { displayName?: { text?: string }; formattedAddress?: string; location?: { latitude?: number; longitude?: number }; primaryType?: string; websiteUri?: string }[] };
  return (data.places || []).filter((p) => Number.isFinite(p.location?.latitude) && Number.isFinite(p.location?.longitude)).map((p) => {
    const type = p.primaryType || '';
    const category = /restaurant|cafe|bar|bakery|meal/.test(type) ? 'Restaurant'
      : /lodging|hotel|hostel|campground/.test(type) ? 'Accommodation'
      : /airport|train|bus|transit|car_rental|ferry/.test(type) ? 'Transport'
      : /store|shop|market/.test(type) ? 'Shopping'
      : /locality|administrative_area|country/.test(type) ? 'City' : 'Sightseeing';
    return { name: p.displayName?.text || p.formattedAddress || query, address: p.formattedAddress || '', lat: p.location!.latitude!, lng: p.location!.longitude!, category, website: p.websiteUri };
  });
}
