import { Car, Footprints, ExternalLink } from 'lucide-react';

interface Coords {
  lat: number;
  lng: number;
  name?: string;
}

interface TravelEstimateProps {
  origin: Coords;
  destination: Coords;
}

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

function formatMinutes(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h} hr` : `${h}h ${m}m`;
}

export function TravelEstimate({ origin, destination }: TravelEstimateProps) {
  const km = haversineKm(origin, destination);
  if (km < 0.05) {
    return null; // Very close or same spot
  }

  // Realistic city transit calculations
  const driveMin = Math.max(1, Math.round((km / 32) * 60) + 2);
  const walkMin = Math.max(1, Math.round((km / 4.8) * 60));

  const distText = km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
  const milesText = `${(km * 0.621371).toFixed(1)} mi`;

  const gmapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}`;

  return (
    <div className="travel-estimate-container">
      <div className="travel-estimate-line" />
      <a
        href={gmapsUrl}
        target="_blank"
        rel="noreferrer"
        className="travel-estimate-pill"
        title="View route directions on Google Maps ↗"
      >
        <span className="travel-seg">
          <Car size={12} />
          <span>{formatMinutes(driveMin)}</span>
        </span>
        <span className="travel-sep">·</span>
        <span className="travel-seg">
          <Footprints size={12} />
          <span>{formatMinutes(walkMin)}</span>
        </span>
        <span className="travel-sep">·</span>
        <span className="travel-dist">{distText} ({milesText})</span>
        <ExternalLink size={10} className="travel-ext-icon muted" />
      </a>
      <div className="travel-estimate-line" />
    </div>
  );
}
