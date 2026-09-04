import { TripMap } from '../../components/TripMap';
import type { Trip } from '../../lib/types';

export function MapTab({ trip }: { trip: Trip }) {
  const places = trip.places ?? [];
  const withCoords = places.filter((p) => p.lat != null && p.lng != null) as (typeof places[number] & {
    lat: number;
    lng: number;
  })[];

  return (
    <div className="panel" style={{ padding: 14 }}>
      <div className="row between mb">
        <h2 className="panel-title" style={{ margin: 0 }}>Trip map</h2>
        <span className="badge">OpenStreetMap · CARTO Dark</span>
      </div>
      <TripMap places={places} />

      {withCoords.length === 0 && (
        <div className="empty-state mt">
          <div className="big">No placed stops yet</div>
          <p>Add lat/lng to a place in the Itinerary tab to see it on the map.</p>
        </div>
      )}

      <div className="grid grid-3 mt">
        {withCoords.map((p) => (
          <div className="list-row" key={p.id}>
            <div className="grow">
              <div className="title">{p.name}</div>
              <div className="sub">{p.lat.toFixed(4)}, {p.lng?.toFixed(4)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}