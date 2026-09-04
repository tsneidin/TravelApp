import { useEffect, useMemo, useRef, useState } from 'react';
import type { Place } from '../lib/types';

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
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&callback=${callback}`;
    script.async = true;
    script.onerror = () => reject(new Error('Google Maps failed to load'));
    document.head.appendChild(script);
  });
  return window.__travelGoogleMapsPromise;
}

const geocodeCache = new Map<string, Coord>();

export function TripMap({ places, destination, focusPlaceId, activePlaceId, onPlaceClick, height = 480 }: {
  places: PlaceWithStop[];
  destination?: string | null;
  focusPlaceId?: string;
  activePlaceId?: string;
  onPlaceClick?: (placeId: string) => void;
  height?: number | string;
}) {
  const elementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const overlaysRef = useRef<any[]>([]);
  const [error, setError] = useState('');
  const targetId = activePlaceId || focusPlaceId;
  const signature = useMemo(
    () => places.map((p) => [p.id, p.name, p.address, p.lat, p.lng, p.stopNumber].join(':')).join('|'),
    [places],
  );

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps().then(async (maps) => {
      if (cancelled || !elementRef.current) return;
      if (!mapRef.current) {
        mapRef.current = new maps.Map(elementRef.current, {
          center: { lat: 20, lng: 0 }, zoom: 2, mapTypeControl: true, streetViewControl: false,
        });
      }
      overlaysRef.current.forEach((overlay) => overlay.setMap?.(null));
      overlaysRef.current = [];
      const geocoder = new maps.Geocoder();
      const resolved: { place: PlaceWithStop; coord: Coord }[] = [];

      for (const place of places) {
        let coord: Coord | undefined = place.lat != null && place.lng != null
          ? { lat: place.lat, lng: place.lng }
          : undefined;
        const query = [place.name, place.address, destination].filter(Boolean).join(', ');
        if (!coord && query) {
          coord = geocodeCache.get(query);
          if (!coord) {
            try {
              const response = await geocoder.geocode({ address: query });
              const point = response.results?.[0]?.geometry?.location;
              if (point) {
                coord = { lat: point.lat(), lng: point.lng() };
                geocodeCache.set(query, coord);
              }
            } catch { /* Item remains listed even when it cannot be geocoded. */ }
          }
        }
        if (coord) resolved.push({ place, coord });
      }
      if (cancelled) return;

      const bounds = new maps.LatLngBounds();
      const info = new maps.InfoWindow();
      for (const { place, coord } of resolved) {
        bounds.extend(coord);
        const marker = new maps.Marker({
          map: mapRef.current,
          position: coord,
          label: place.stopNumber != null ? { text: String(place.stopNumber), color: '#fff' } : undefined,
          title: place.name,
        });
        marker.addListener('click', () => {
          const detail = [place.category, place.address, place.notes].filter(Boolean).join(' · ');
          info.setContent(`<div style="max-width:260px"><strong>${place.name}</strong><div style="font-size:12px;margin-top:4px">${detail}</div></div>`);
          info.open({ map: mapRef.current, anchor: marker });
          onPlaceClick?.(place.id);
        });
        overlaysRef.current.push(marker);
      }
      if (resolved.length > 1) {
        overlaysRef.current.push(new maps.Polyline({
          map: mapRef.current,
          path: resolved.map((entry) => entry.coord),
          strokeColor: '#22d3ee', strokeOpacity: 0.8, strokeWeight: 3,
        }));
      }

      const target = resolved.find((entry) => entry.place.id === targetId);
      if (target) {
        mapRef.current.setCenter(target.coord);
        mapRef.current.setZoom(15);
      } else if (resolved.length > 1) {
        mapRef.current.fitBounds(bounds, 48);
      } else if (resolved.length === 1) {
        mapRef.current.setCenter(resolved[0].coord);
        mapRef.current.setZoom(12);
      } else if (destination) {
        try {
          const response = await geocoder.geocode({ address: destination });
          const point = response.results?.[0]?.geometry?.location;
          if (point) { mapRef.current.setCenter(point); mapRef.current.setZoom(7); }
        } catch { /* Retain world view. */ }
      }
      setError('');
    }).catch((e: Error) => setError(e.message));
    return () => { cancelled = true; };
  }, [signature, destination, targetId, onPlaceClick]);

  return (
    <div style={{ position: 'relative', width: '100%', height: typeof height === 'number' ? `${height}px` : height }}>
      <div ref={elementRef} style={{ width: '100%', height: '100%', borderRadius: 10 }} />
      {error && <div className="empty-state" style={{ position: 'absolute', inset: 12 }}><b>Google Map unavailable</b><div className="small muted">{error}</div></div>}
    </div>
  );
}
