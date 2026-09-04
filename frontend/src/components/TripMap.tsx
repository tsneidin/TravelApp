import { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Place } from '../lib/types';

// Custom SVG marker matching the theme
const marker = L.divIcon({
  className: '',
  html: `<svg width="26" height="34" viewBox="0 0 26 34"><path d="M13 1C6.6 1 1.5 6.1 1.5 12.5c0 8.2 11.5 20.5 11.5 20.5s11.5-12.3 11.5-20.5C24.5 6.1 19.4 1 13 1z" fill="#22d3ee" stroke="#0b1220" stroke-width="2"/><circle cx="13" cy="12" r="4.5" fill="#0b1220"/></svg>`,
  iconSize: [26, 34],
  iconAnchor: [13, 34],
  popupAnchor: [0, -30],
});

// Free, no-API-key tile sources. Primary: official OSM standard tiles (reliable,
// no key required). Fallback: subdomain variant if the primary errors.
const TILE_SOURCES: { url: string; attribution: string; subdomains?: string }[] = [
  {
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    subdomains: 'abc',
  },
];

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la = (a.lat * Math.PI) / 180;
  const lb = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Small in-memory cache so we don't hammer Nominatim for the same destination.
const geoCache = new Map<string, { lat: number; lng: number }>();

/**
 * Geocode a free-text destination via the OpenStreetMap Nominatim search API
 * (no API key required). Used to centre the map on the trip location.
 */
async function geocodeDestination(query: string): Promise<{ lat: number; lng: number } | null> {
  const key = query.trim().toLowerCase();
  if (!key) return null;
  if (geoCache.has(key)) return geoCache.get(key) ?? null;
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const data = (await res.json()) as { lat?: string; lon?: string }[];
    const hit = data?.[0];
    if (!hit?.lat || !hit?.lon) return null;
    const coords = { lat: Number(hit.lat), lng: Number(hit.lon) };
    geoCache.set(key, coords);
    return coords;
  } catch {
    return null;
  }
}

/**
 * Wraps a TileLayer so that if the primary tile source fails, we fall back to
 * the next source to avoid a blank map or an "API key" notice.
 */
function ResilientTileLayer({
  sources,
  maxZoom = 19,
}: {
  sources: { url: string; attribution: string; subdomains?: string }[];
  maxZoom?: number;
}) {
  const [idx, setIdx] = useState(0);
  const src = sources[idx];
  const onError = () => {
    if (idx < sources.length - 1) setIdx(idx + 1);
  };
  return (
    <>
      <TileLayer
        key={src.url}
        url={src.url}
        attribution={src.attribution}
        maxZoom={maxZoom}
        eventHandlers={{ tileerror: onError }}
        {...(src.subdomains ? { subdomains: src.subdomains } : {})}
      />
      {idx > 0 && (
        <div
          style={{
            position: 'absolute',
            bottom: 30,
            left: 8,
            zIndex: 500,
            background: 'var(--panel)',
            border: '1px solid var(--line)',
            borderRadius: 8,
            padding: '4px 10px',
            fontSize: 11,
            color: 'var(--warn)',
          }}
        >
          Using fallback map tiles (primary source unavailable)
        </div>
      )}
    </>
  );
}

type MapFocusTarget =
  | { kind: 'bounds'; pts: [number, number][] }
  | { kind: 'point'; lat: number; lng: number; zoom: number }
  | { kind: 'world' };

/**
 * Child of MapContainer that moves the viewport when the focus target changes:
 *   1. Multiple places with coords  -> fit bounds
 *   2. Single place with coords     -> centre on it (city zoom)
 *   3. No place coords, destination -> centre on geocoded destination
 *   4. Otherwise                   -> world view
 */
function MapFocus({ focus }: { focus: MapFocusTarget }) {
  const map = useMap();
  const key = useMemo(() => {
    if (focus.kind === 'bounds') return `b:${focus.pts.map((p) => p.join(',')).join(';')}`;
    if (focus.kind === 'point') return `p:${focus.lat},${focus.lng},${focus.zoom}`;
    return 'w';
  }, [focus]);

  useEffect(() => {
    if (focus.kind === 'world') {
      map.setView([20, 0], 2, { animate: false });
    } else if (focus.kind === 'bounds') {
      map.fitBounds(L.latLngBounds(focus.pts), { padding: [40, 40] });
    } else {
      map.setView([focus.lat, focus.lng], focus.zoom, { animate: true });
    }
  }, [key]);

  return null;
}

export function TripMap({ places, destination, focusPlaceId }: { places: Place[]; destination?: string | null; focusPlaceId?: string }) {
  const allPlaces = places;
  const withCoords = places.filter((p) => p.lat != null && p.lng != null) as (Place & {
    lat: number;
    lng: number;
  })[];

  const [geo, setGeo] = useState<{ lat: number; lng: number } | null>(null);
  const [focusGeo, setFocusGeo] = useState<{ lat: number; lng: number } | null>(null);

  const focusPlace = focusPlaceId ? allPlaces.find((p) => p.id === focusPlaceId) : undefined;

  // Geocode the focused place (no coords) or the trip destination.
  useEffect(() => {
    let alive = true;
    setGeo(null);
    setFocusGeo(null);

    if (focusPlace) {
      if (focusPlace.lat != null && focusPlace.lng != null) return;
      const q = `${focusPlace.name} ${focusPlace.address ?? ''}`.trim();
      if (!q) return;
      geocodeDestination(q).then((c) => {
        if (alive && c) setFocusGeo(c);
      });
      return () => {
        alive = false;
      };
    }

    if (withCoords.length > 0) return;
    if (!destination) return;
    geocodeDestination(destination).then((c) => {
      if (alive && c) setGeo(c);
    });
    return () => {
      alive = false;
    };
  }, [focusPlaceId, focusPlace?.name, focusPlace?.address, destination, withCoords.length]);

  const focus = useMemo<MapFocusTarget>(() => {
    if (focusPlace) {
      if (focusPlace.lat != null && focusPlace.lng != null) {
        return { kind: 'point', lat: focusPlace.lat, lng: focusPlace.lng, zoom: 15 };
      }
      if (focusGeo) return { kind: 'point', lat: focusGeo.lat, lng: focusGeo.lng, zoom: 13 };
      return { kind: 'world' };
    }
    if (withCoords.length >= 2) {
      return { kind: 'bounds', pts: withCoords.map((p) => [p.lat, p.lng] as [number, number]) };
    }
    if (withCoords.length === 1) {
      const p = withCoords[0];
      return { kind: 'point', lat: p.lat, lng: p.lng, zoom: 12 };
    }
    if (geo) return { kind: 'point', lat: geo.lat, lng: geo.lng, zoom: 8 };
    return { kind: 'world' };
  }, [withCoords, geo, focusPlace, focusGeo]);

  const path = withCoords.length > 1 ? withCoords.map((p) => [p.lat, p.lng] as [number, number]) : [];

  return (
    <MapContainer center={[20, 0]} zoom={2} style={{ height: 480, width: '100%' }}>
      <ResilientTileLayer sources={TILE_SOURCES} maxZoom={19} />
      <MapFocus focus={focus} />
      {path.length > 1 && (
        <Polyline
          positions={path}
          pathOptions={{ color: '#22d3ee', weight: 2.5, opacity: 0.85, dashArray: '8 8' }}
        />
      )}
      {withCoords.map((p) => (
        <Marker key={p.id} position={[p.lat, p.lng]} icon={marker}>
          <Popup>
            <b>{p.name}</b>
            {p.address ? <div style={{ fontSize: 11, opacity: 0.8 }}>{p.address}</div> : null}
            {p.notes ? <div style={{ fontSize: 11, opacity: 0.8 }}>{p.notes}</div> : null}
          </Popup>
        </Marker>
      ))}
      {withCoords.length > 1 && (
        <div style={{ position: 'absolute', bottom: 8, left: 8, zIndex: 500, background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 8, padding: '4px 10px', fontSize: 11, color: 'var(--muted)' }}>
          {withCoords.length} stops · ~{Math.round(haversineKm(withCoords[0], withCoords[withCoords.length - 1]))} km
        </div>
      )}
    </MapContainer>
  );
}