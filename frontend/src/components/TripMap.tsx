import { useEffect, useMemo, useRef, useState } from 'react';
import type { GeocodedPlace, Place } from '../lib/types';

export interface PlaceWithStop extends Place { stopNumber?: number; }
type Coord = { lat: number; lng: number };

declare global {
  interface Window {
    google?: any;
    __travelGoogleMapsPromise?: Promise<any>;
  }
}

function loadGoogleMaps(): Promise<any> {
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (window.__travelGoogleMapsPromise) return window.__travelGoogleMapsPromise;
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  if (!key) return Promise.reject(new Error('VITE_GOOGLE_MAPS_API_KEY is not configured'));
  window.__travelGoogleMapsPromise = new Promise((resolve, reject) => {
    const callback = '__travelGoogleMapsReady';
    (window as any)[callback] = () => {
      delete (window as any)[callback];
      resolve(window.google.maps);
    };
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&libraries=places&callback=${callback}`;
    script.async = true;
    script.onerror = () => reject(new Error('Google Maps failed to load'));
    document.head.appendChild(script);
  });
  return window.__travelGoogleMapsPromise;
}

const geocodeCache = new Map<string, Coord>();

function categoryFromGoogleTypes(types: string[] = []): string {
  if (types.some((type) => ['restaurant', 'cafe', 'bar', 'bakery', 'meal_takeaway'].includes(type))) return 'Restaurant';
  if (types.some((type) => ['lodging', 'campground', 'rv_park'].includes(type))) return 'Accommodation';
  if (types.some((type) => ['airport', 'train_station', 'bus_station', 'transit_station', 'car_rental'].includes(type))) return 'Transport';
  if (types.some((type) => ['store', 'shopping_mall', 'supermarket'].includes(type))) return 'Shopping';
  if (types.some((type) => ['amusement_park', 'aquarium', 'zoo', 'movie_theater', 'stadium'].includes(type))) return 'Activity';
  return 'Sightseeing';
}

function isTransportation(place: PlaceWithStop): boolean {
  return /transport|flight|airport|train|rail|bus|coach|drive|driving|car rental|ferry|boat|transfer|taxi|rideshare/i.test(
    [place.category, place.name, place.notes].filter(Boolean).join(' '),
  );
}

function getGeocodeQueries(place: PlaceWithStop, destination?: string | null): string[] {
  const queries: string[] = [];
  const addr = place.address?.trim();
  if (addr) {
    queries.push(addr);
    if (destination && !addr.toLowerCase().includes(destination.toLowerCase())) {
      queries.push(`${addr}, ${destination}`);
    }
  }

  if (/→|->/.test(place.name)) {
    const originMatch = /:\s*([^→\-]+?)(?:\s*\([A-Z]{3}\))?\s*(?:→|->)/.exec(place.name) || /^([^→\-]+?)\s*(?:→|->)/.exec(place.name);
    if (originMatch?.[1]) {
      const originCity = originMatch[1].replace(/^[^\w]+/, '').trim();
      if (originCity) queries.push(`${originCity} Airport`);
    }
  }

  const cleanName = place.name.replace(/^[^\w]+/, '').trim();
  if (cleanName && !queries.includes(cleanName)) {
    queries.push(cleanName);
    if (destination && !cleanName.toLowerCase().includes(destination.toLowerCase())) {
      queries.push(`${cleanName}, ${destination}`);
    }
  }

  return queries;
}

export function TripMap({
  places,
  destination,
  fallbackLocation,
  focusPlaceId,
  activePlaceId,
  onPlaceClick,
  onMapClick,
  height = 480,
}: {
  places: PlaceWithStop[];
  destination?: string | null;
  fallbackLocation?: { coord?: Coord; address?: string; name?: string } | null;
  focusPlaceId?: string;
  activePlaceId?: string;
  onPlaceClick?: (placeId: string) => void;
  onMapClick?: (place: GeocodedPlace) => void;
  height?: number | string;
}) {
  const elementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const overlaysRef = useRef<any[]>([]);
  const markersMapRef = useRef<Map<string, { marker: any; coord: Coord; place: PlaceWithStop; infoContent: string }>>(new Map());
  const infoWindowRef = useRef<any>(null);
  const previewRef = useRef<any>(null);
  const mapClickRef = useRef(onMapClick);
  const [error, setError] = useState('');
  const targetId = activePlaceId || focusPlaceId;

  useEffect(() => { mapClickRef.current = onMapClick; }, [onMapClick]);

  const signature = useMemo(
    () => places.map((p) => [p.id, p.name, p.address, p.lat, p.lng, p.stopNumber].join(':')).join('|'),
    [places],
  );

  const fallbackSig = useMemo(
    () => fallbackLocation ? `${fallbackLocation.address || ''}:${fallbackLocation.coord?.lat ?? ''}:${fallbackLocation.coord?.lng ?? ''}` : '',
    [fallbackLocation],
  );

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps().then(async (maps) => {
      if (cancelled || !elementRef.current) return;
      if (!mapRef.current) {
        mapRef.current = new maps.Map(elementRef.current, {
          center: { lat: 20, lng: 0 },
          zoom: 2,
          mapTypeControl: true,
          streetViewControl: false,
        });

        mapRef.current.addListener('click', async (event: any) => {
          const callback = mapClickRef.current;
          if (!callback || !event.latLng) return;
          event.stop?.();
          const geocoder = new maps.Geocoder();

          const showPreview = (place: GeocodedPlace, position: any) => {
            previewRef.current?.close();
            const card = document.createElement('div');
            card.style.cssText = 'min-width:220px;max-width:300px;color:#111827;padding:2px';

            const title = document.createElement('strong');
            title.textContent = place.name;
            title.style.cssText = 'display:block;font-size:14px;margin-bottom:4px';
            card.appendChild(title);

            const address = document.createElement('div');
            address.textContent = place.address;
            address.style.cssText = 'font-size:12px;color:#4b5563;margin-bottom:10px';
            card.appendChild(address);

            const actions = document.createElement('div');
            actions.style.cssText = 'display:flex;gap:8px;align-items:center';

            const viewLink = document.createElement('a');
            viewLink.href = place.mapUrl || `https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}`;
            viewLink.target = '_blank';
            viewLink.rel = 'noreferrer';
            viewLink.textContent = 'View on Google Maps';
            viewLink.style.cssText = 'font-size:12px;color:#2563eb;text-decoration:none';
            actions.appendChild(viewLink);

            const addButton = document.createElement('button');
            addButton.type = 'button';
            addButton.textContent = 'Add to itinerary';
            addButton.style.cssText = 'margin-left:auto;border:0;border-radius:6px;background:#0891b2;color:white;padding:6px 9px;font-size:12px;cursor:pointer';
            addButton.addEventListener('click', () => {
              previewRef.current?.close();
              callback(place);
            });
            actions.appendChild(addButton);
            card.appendChild(actions);

            previewRef.current = new maps.InfoWindow({ content: card, position });
            previewRef.current.open({ map: mapRef.current });
          };

          try {
            if (event.placeId && maps.places?.PlacesService) {
              const service = new maps.places.PlacesService(mapRef.current);
              const details = await new Promise<any | null>((resolve) => {
                service.getDetails({
                  placeId: event.placeId,
                  fields: ['name', 'formatted_address', 'geometry', 'website', 'url', 'types'],
                }, (place: any, status: any) => {
                  resolve(status === maps.places.PlacesServiceStatus.OK ? place : null);
                });
              });
              if (details) {
                const point = details.geometry?.location ?? event.latLng;
                showPreview({
                  name: details.name || 'Pinned location',
                  address: details.formatted_address || details.name || 'Google Maps place',
                  lat: point.lat(),
                  lng: point.lng(),
                  category: categoryFromGoogleTypes(details.types),
                  placeId: event.placeId,
                  website: details.website || undefined,
                  mapUrl: details.url || `https://www.google.com/maps/search/?api=1&query=place_id:${encodeURIComponent(event.placeId)}`,
                }, point);
                return;
              }
            }

            const response = await geocoder.geocode({ location: event.latLng });
            const result = response.results?.[0];
            const point = result?.geometry?.location ?? event.latLng;
            const fallbackName = result?.formatted_address?.split(',')[0] || 'Pinned location';
            showPreview({
              name: fallbackName,
              address: result?.formatted_address || fallbackName,
              lat: point.lat(),
              lng: point.lng(),
              category: categoryFromGoogleTypes(result?.types),
              placeId: result?.place_id,
              mapUrl: `https://www.google.com/maps/search/?api=1&query=${point.lat()},${point.lng()}`,
            }, point);
          } catch {
            const place = {
              name: 'Pinned location',
              address: `${event.latLng.lat().toFixed(6)}, ${event.latLng.lng().toFixed(6)}`,
              lat: event.latLng.lat(),
              lng: event.latLng.lng(),
              category: 'Sightseeing',
              mapUrl: `https://www.google.com/maps/search/?api=1&query=${event.latLng.lat()},${event.latLng.lng()}`,
            };
            showPreview(place, event.latLng);
          }
        });
      }

      overlaysRef.current.forEach((overlay) => overlay.setMap?.(null));
      overlaysRef.current = [];
      markersMapRef.current.clear();

      if (!infoWindowRef.current) {
        infoWindowRef.current = new maps.InfoWindow();
      }

      const geocoder = new maps.Geocoder();
      const resolved: { place: PlaceWithStop; coord: Coord }[] = [];

      for (const place of places) {
        let coord: Coord | undefined = place.lat != null && place.lng != null
          ? { lat: place.lat, lng: place.lng }
          : undefined;

        if (!coord) {
          const queries = getGeocodeQueries(place, destination);
          for (const query of queries) {
            coord = geocodeCache.get(query);
            if (!coord) {
              try {
                const response = await geocoder.geocode({ address: query });
                const point = response.results?.[0]?.geometry?.location;
                if (point) {
                  coord = { lat: point.lat(), lng: point.lng() };
                  geocodeCache.set(query, coord);
                  break;
                }
              } catch { /* Try next fallback query */ }
            } else {
              break;
            }
          }
        }
        if (coord) resolved.push({ place, coord });
      }
      if (cancelled) return;

      const bounds = new maps.LatLngBounds();
      for (const { place, coord } of resolved) {
        bounds.extend(coord);
        const marker = new maps.Marker({
          map: mapRef.current,
          position: coord,
          label: place.stopNumber != null ? { text: String(place.stopNumber), color: '#fff' } : undefined,
          title: place.name,
        });

        const detail = [place.category, place.address, place.notes].filter(Boolean).join(' · ');
        const infoContent = `<div style="max-width:260px;color:#111827"><strong>${place.name}</strong><div style="font-size:12px;margin-top:4px;color:#4b5563">${detail}</div></div>`;

        marker.addListener('click', () => {
          infoWindowRef.current?.setContent(infoContent);
          infoWindowRef.current?.open({ map: mapRef.current, anchor: marker });
          onPlaceClick?.(place.id);
        });

        overlaysRef.current.push(marker);
        markersMapRef.current.set(place.id, { marker, coord, place, infoContent });
      }

      // Ordinary itinerary stops are independent pins. Draw a segment only
      // when the destination entry represents transportation from the prior stop.
      for (let index = 1; index < resolved.length; index += 1) {
        if (!isTransportation(resolved[index].place)) continue;
        overlaysRef.current.push(new maps.Polyline({
          map: mapRef.current,
          path: [resolved[index - 1].coord, resolved[index].coord],
          strokeColor: '#22d3ee',
          strokeOpacity: 0.85,
          strokeWeight: 3,
        }));
      }

      // Handle focus and centering
      const targetMarkerInfo = targetId ? markersMapRef.current.get(targetId) : undefined;
      if (targetMarkerInfo) {
        mapRef.current.setCenter(targetMarkerInfo.coord);
        mapRef.current.setZoom(15);
        infoWindowRef.current?.setContent(targetMarkerInfo.infoContent);
        infoWindowRef.current?.open({ map: mapRef.current, anchor: targetMarkerInfo.marker });
      } else if (resolved.length > 1) {
        infoWindowRef.current?.close();
        mapRef.current.fitBounds(bounds, 48);
      } else if (resolved.length === 1) {
        infoWindowRef.current?.close();
        mapRef.current.setCenter(resolved[0].coord);
        mapRef.current.setZoom(13);
      } else {
        infoWindowRef.current?.close();
        // Day has no places: use the previous day's location (fallbackLocation)
        let handledFallback = false;
        if (fallbackLocation) {
          if (fallbackLocation.coord) {
            mapRef.current.setCenter(fallbackLocation.coord);
            mapRef.current.setZoom(12);
            handledFallback = true;
          } else if (fallbackLocation.address) {
            let coord = geocodeCache.get(fallbackLocation.address);
            if (!coord) {
              try {
                const response = await geocoder.geocode({ address: fallbackLocation.address });
                const point = response.results?.[0]?.geometry?.location;
                if (point) {
                  coord = { lat: point.lat(), lng: point.lng() };
                  geocodeCache.set(fallbackLocation.address, coord);
                }
              } catch { /* Fall back to destination */ }
            }
            if (coord && !cancelled) {
              mapRef.current.setCenter(coord);
              mapRef.current.setZoom(12);
              handledFallback = true;
            }
          }
        }

        if (!handledFallback && destination) {
          let destCoord = geocodeCache.get(destination);
          if (!destCoord) {
            try {
              const response = await geocoder.geocode({ address: destination });
              const point = response.results?.[0]?.geometry?.location;
              if (point) {
                destCoord = { lat: point.lat(), lng: point.lng() };
                geocodeCache.set(destination, destCoord);
              }
            } catch { /* Retain world view. */ }
          }
          if (destCoord && !cancelled) {
            mapRef.current.setCenter(destCoord);
            mapRef.current.setZoom(8);
          }
        }
      }
      setError('');
    }).catch((e: Error) => setError(e.message));
    return () => { cancelled = true; };
  }, [signature, fallbackSig, destination, targetId, onPlaceClick]);

  return (
    <div style={{ position: 'relative', width: '100%', height: typeof height === 'number' ? `${height}px` : height }}>
      <div ref={elementRef} style={{ width: '100%', height: '100%', borderRadius: 10 }} />
      {error && <div className="empty-state" style={{ position: 'absolute', inset: 12 }}><b>Google Map unavailable</b><div className="small muted">{error}</div></div>}
    </div>
  );
}

