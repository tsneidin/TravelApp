import { Router } from 'express';
import { asyncHandler, badRequest } from '../lib/errors.js';
import { getUser } from '../middleware/auth.js';
import { searchPlaces } from '../services/geocoding.js';
import { config } from '../config.js';

export const placesRouter = Router();

function isGoogleMapsHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'maps.app.goo.gl'
    || host === 'goo.gl'
    || host === 'google.com'
    || host === 'www.google.com'
    || host === 'maps.google.com';
}


interface GooglePlaceResult {
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  websiteUri?: string;
  googleMapsUri?: string;
  primaryType?: string;
}

function googleCategory(primaryType?: string): string {
  const type = primaryType || '';
  if (/restaurant|cafe|bar|bakery|meal/.test(type)) return 'Restaurant';
  if (/lodging|hotel|hostel|campground/.test(type)) return 'Accommodation';
  if (/airport|train|bus|transit|car_rental|ferry/.test(type)) return 'Transport';
  if (/store|shop|market/.test(type)) return 'Shopping';
  if (/amusement|aquarium|zoo|stadium|theater/.test(type)) return 'Activity';
  return 'Sightseeing';
}

function mapDetails(rawUrl: string) {
  const parsed = new URL(rawUrl);
  const decodedPath = decodeURIComponent(parsed.pathname.replace(/\+/g, ' '));
  const nameMatch = decodedPath.match(/\/maps\/place\/([^/]+)/i);
  const atMatch = rawUrl.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  const dataMatch = rawUrl.match(/!3d(-?\d+(?:\.\d+)?).*?!4d(-?\d+(?:\.\d+)?)/);
  const query = parsed.searchParams.get('query') || parsed.searchParams.get('q') || '';
  return {
    name: nameMatch?.[1]?.trim() || query.replace(/^place_id:/, '').trim(),
    lat: Number(atMatch?.[1] ?? dataMatch?.[1]),
    lng: Number(atMatch?.[2] ?? dataMatch?.[2]),
  };
}

placesRouter.get(
  '/search',
  asyncHandler(async (req, res) => {
    getUser(req);
    const query = String(req.query.q || '').trim();
    if (!query) throw badRequest('Query parameter q is required');

    const biasLat = req.query.biasLat != null && req.query.biasLat !== '' ? Number(req.query.biasLat) : undefined;
    const biasLng = req.query.biasLng != null && req.query.biasLng !== '' ? Number(req.query.biasLng) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : 6;

    const places = await searchPlaces(query, { biasLat, biasLng, limit });
    res.json({ places });
  }),
);

placesRouter.get(
  '/resolve-map-url',
  asyncHandler(async (req, res) => {
    getUser(req);
    const originalUrl = String(req.query.url || '').trim();
    if (!originalUrl) throw badRequest('Query parameter url is required');

    let parsed: URL;
    try {
      parsed = new URL(originalUrl);
    } catch {
      throw badRequest('Enter a valid Google Maps URL');
    }
    if (parsed.protocol !== 'https:' || !isGoogleMapsHost(parsed.hostname)) {
      throw badRequest('Only Google Maps URLs are supported');
    }

    let resolvedUrl = originalUrl;
    if (parsed.hostname === 'maps.app.goo.gl' || parsed.hostname === 'goo.gl') {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch(originalUrl, {
          method: 'GET',
          redirect: 'follow',
          signal: controller.signal,
          headers: { 'User-Agent': 'TravelApp/1.0' },
        });
        resolvedUrl = response.url || originalUrl;
      } finally {
        clearTimeout(timer);
      }
    }

    const details = mapDetails(resolvedUrl);
    const hasCoords = Number.isFinite(details.lat) && Number.isFinite(details.lng);
    const lookup = details.name || (hasCoords ? `${details.lat}, ${details.lng}` : '');
    if (!lookup) throw badRequest('Could not identify a place in that Google Maps URL');

    let googlePlace: GooglePlaceResult | undefined;
    if (config.search.googlePlacesApiKey) {
      try {
        const body: Record<string, unknown> = { textQuery: lookup, maxResultCount: 1 };
        if (hasCoords) {
          body.locationBias = {
            circle: {
              center: { latitude: details.lat, longitude: details.lng },
              radius: 1000,
            },
          };
        }
        const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': config.search.googlePlacesApiKey,
            'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location,places.websiteUri,places.googleMapsUri,places.primaryType',
          },
          body: JSON.stringify(body),
        });
        if (response.ok) {
          const data = await response.json() as { places?: GooglePlaceResult[] };
          googlePlace = data.places?.[0];
        }
      } catch {
        // The existing geocoder below remains the fallback.
      }
    }

    const matches = googlePlace ? [] : await searchPlaces(lookup, {
      biasLat: hasCoords ? details.lat : undefined,
      biasLng: hasCoords ? details.lng : undefined,
      limit: 1,
    });
    const match = matches[0];
    const googleLat = googlePlace?.location?.latitude;
    const googleLng = googlePlace?.location?.longitude;
    if (!hasCoords && googleLat == null && googleLng == null && (match?.lat == null || match?.lng == null)) {
      throw badRequest('Could not resolve coordinates from that Google Maps URL');
    }
    res.json({
      place: {
        name: googlePlace?.displayName?.text || details.name || match?.name || 'Pinned location',
        address: googlePlace?.formattedAddress || match?.address || details.name || lookup,
        lat: hasCoords ? details.lat : (googleLat ?? match?.lat),
        lng: hasCoords ? details.lng : (googleLng ?? match?.lng),
        category: googlePlace ? googleCategory(googlePlace.primaryType) : (match?.category || 'Sightseeing'),
        country: match?.country,
        website: googlePlace?.websiteUri,
        mapUrl: googlePlace?.googleMapsUri || originalUrl,
      },
    });
  }),
);
