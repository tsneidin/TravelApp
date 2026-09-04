import { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Place } from '../lib/types';

export interface PlaceWithStop extends Place {
  stopNumber?: number;
}

// Generate numbered SVG markers matching Wanderlog's theme
function createNumberedMarker(num: number | string, color = '#22d3ee', active = false) {
  return L.divIcon({
    className: 'custom-map-div-icon',
    html: `
      <div class="wanderlog-pin ${active ? 'active' : ''}">
        <svg width="32" height="40" viewBox="0 0 32 40">
          <path d="M16 1C8.3 1 2 7.3 2 15c0 10.5 14 24 14 24s14-13.5 14-24C30 7.3 23.7 1 16 1z" fill="${active ? '#38bdf8' : color}" stroke="#0b1220" stroke-width="2.2"/>
          <circle cx="16" cy="15" r="9" fill="#0b1220"/>
        </svg>
        <span class="pin-number">${num}</span>
      </div>
    `,
    iconSize: [32, 40],
    iconAnchor: [16, 40],
    popupAnchor: [0, -38],
  });
}

// Unnumbered default marker fallback
const defaultMarker = L.divIcon({
  className: 'custom-map-div-icon',
  html: `<svg width="26" height="34" viewBox="0 0 26 34"><path d="M13 1C6.6 1 1.5 6.1 1.5 12.5c0 8.2 11.5 20.5 11.5 20.5s11.5-12.3 11.5-20.5C24.5 6.1 19.4 1 13 1z" fill="#22d3ee" stroke="#0b1220" stroke-width="2"/><circle cx="13" cy="12" r="4.5" fill="#0b1220"/></svg>`,
  iconSize: [26, 34],
  iconAnchor: [13, 34],
  popupAnchor: [0, -30],
});

// Free, no-API-key tile sources.
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

const geoCache = new Map<string, { lat: number; lng: number }>();

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
  }, [key, focus, map]);

  return null;
}

export function TripMap({
  places,
  destination,
  focusPlaceId,
  activePlaceId,
  onPlaceClick,
  height = 480,
}: {
  places: PlaceWithStop[];
  destination?: string | null;
  focusPlaceId?: string;
  activePlaceId?: string;
  onPlaceClick?: (placeId: string) => void;
  height?: number | string;
}) {
  const allPlaces = places;
  const withCoords = places.filter((p) => p.lat != null && p.lng != null) as (PlaceWithStop & {
    lat: number;
    lng: number;
  })[];

  const [geo, setGeo] = useState<{ lat: number; lng: number } | null>(null);
  const [focusGeos, setFocusGeos] = useState<{ lat: number; lng: number; label: string }[]>([]);

  const targetedId = activePlaceId || focusPlaceId;
  const focusPlace = targetedId ? allPlaces.find((p) => p.id === targetedId) : undefined;

  // Geocode the focused place (if no coords) or the trip destination.
  useEffect(() => {
    let alive = true;
    setGeo(null);
    setFocusGeos([]);

    if (focusPlace) {
      if (focusPlace.lat != null && focusPlace.lng != null) return;

      const airportCodes = Array.from(
        new Set(focusPlace.name.match(/\b[A-Z]{3}\b/g) ?? []),
      ).slice(0, 6);
      const queries = airportCodes.length >= 1
        ? airportCodes.map((code) => ({ label: code, query: `${code} airport` }))
        : [{
            label: focusPlace.name,
            query: `${focusPlace.name} ${focusPlace.address ?? ''} ${destination ?? ''}`.trim(),
          }];

      Promise.all(
        queries.map(async ({ label, query }) => {
          const coords = await geocodeDestination(query);
          return coords ? { ...coords, label } : null;
        }),
      ).then((results) => {
        if (alive) setFocusGeos(results.filter((p): p is { lat: number; lng: number; label: string } => p != null));
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
  }, [targetedId, focusPlace?.name, focusPlace?.address, destination, withCoords.length]);

  const focus = useMemo<MapFocusTarget>(() => {
    if (focusPlace) {
      if (focusPlace.lat != null && focusPlace.lng != null) {
        return { kind: 'point', lat: focusPlace.lat, lng: focusPlace.lng, zoom: 15 };
      }
      if (focusGeos.length >= 2) return { kind: 'bounds', pts: focusGeos.map((p) => [p.lat, p.lng]) };
      if (focusGeos.length === 1) return { kind: 'point', lat: focusGeos[0].lat, lng: focusGeos[0].lng, zoom: 13 };
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
  }, [withCoords, geo, focusPlace, focusGeos]);

  const path = withCoords.length > 1 ? withCoords.map((p) => [p.lat, p.lng] as [number, number]) : [];

  const totalDistanceKm = useMemo(() => {
    if (withCoords.length < 2) return 0;
    let sum = 0;
    for (let i = 1; i < withCoords.length; i++) {
      sum += haversineKm(withCoords[i - 1], withCoords[i]);
    }
    return sum;
  }, [withCoords]);

  return (
    <div style={{ position: 'relative', width: '100%', height: typeof height === 'number' ? `${height}px` : height }}>
      <MapContainer center={[20, 0]} zoom={2} style={{ height: '100%', width: '100%' }}>
        <ResilientTileLayer sources={TILE_SOURCES} maxZoom={19} />
        <MapFocus focus={focus} />
        {path.length > 1 && (
          <Polyline
            positions={path}
            pathOptions={{ color: '#22d3ee', weight: 3, opacity: 0.85, dashArray: '8 8' }}
          />
        )}
        {withCoords.map((p, idx) => {
          const stopNum = p.stopNumber ?? idx + 1;
          const isActive = p.id === targetedId;
          const icon = p.stopNumber != null ? createNumberedMarker(stopNum, '#22d3ee', isActive) : defaultMarker;

          return (
            <Marker
              key={p.id}
              position={[p.lat, p.lng]}
              icon={icon}
              eventHandlers={{
                click: () => onPlaceClick?.(p.id),
              }}
            >
              <Popup>
                <div style={{ minWidth: 140 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 2 }}>
                    {stopNum ? `#${stopNum} ` : ''}{p.name}
                  </div>
                  {p.category && (
                    <span style={{ fontSize: 10, background: '#1e293b', padding: '1px 6px', borderRadius: 4, color: '#38bdf8' }}>
                      {p.category}
                    </span>
                  )}
                  {p.address && <div style={{ fontSize: 11, opacity: 0.8, marginTop: 4 }}>{p.address}</div>}
                  {p.notes && <div style={{ fontSize: 11, opacity: 0.8, marginTop: 2 }}>✏️ {p.notes}</div>}
                </div>
              </Popup>
            </Marker>
          );
        })}
        {focusPlace && focusGeos.map((point) => (
          <Marker key={point.label} position={[point.lat, point.lng]} icon={defaultMarker}>
            <Popup>
              <b>{point.label}</b>
              <div style={{ fontSize: 11, opacity: 0.8 }}>{focusPlace.name}</div>
            </Popup>
          </Marker>
        ))}
        {withCoords.length > 1 && (
          <div
            style={{
              position: 'absolute',
              bottom: 12,
              left: 12,
              zIndex: 500,
              background: 'rgba(16, 26, 46, 0.92)',
              backdropFilter: 'blur(6px)',
              border: '1px solid var(--line)',
              borderRadius: 8,
              padding: '5px 12px',
              fontSize: 11,
              color: 'var(--text)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            }}
          >
            <span style={{ color: 'var(--accent)', fontWeight: 700 }}>{withCoords.length} stops</span>
            <span style={{ opacity: 0.5 }}>·</span>
            <span>~{totalDistanceKm.toFixed(1)} km ({(totalDistanceKm * 0.621371).toFixed(1)} mi) route</span>
          </div>
        )}
      </MapContainer>
    </div>
  );
}