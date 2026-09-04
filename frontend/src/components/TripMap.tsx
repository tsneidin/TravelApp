import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
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

export function TripMap({ places }: { places: Place[] }) {
  const withCoords = places.filter((p) => p.lat != null && p.lng != null) as (Place & {
    lat: number;
    lng: number;
  })[];

  const bounds: L.LatLngBoundsExpression | undefined =
    withCoords.length > 1
      ? L.latLngBounds(withCoords.map((p) => [p.lat, p.lng] as [number, number]))
      : undefined;

  const path =
    withCoords.length > 1
      ? withCoords.map((p) => [p.lat, p.lng] as [number, number])
      : [];

  return (
    <MapContainer
      center={withCoords[0] ? [withCoords[0].lat, withCoords[0].lng] : [20, 0]}
      zoom={2}
      bounds={bounds}
      style={{ height: 480, width: '100%' }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        subdomains="abcd"
        maxZoom={20}
      />
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
            {p.address ? (
              <div style={{ fontSize: 11, opacity: 0.8 }}>{p.address}</div>
            ) : null}
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