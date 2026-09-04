import { useSearchParams } from 'react-router-dom';
import { TripMap } from '../../components/TripMap';
import type { Trip } from '../../lib/types';

export function MapTab({ trip }: { trip: Trip }) {
  const [searchParams] = useSearchParams();
  const focusId = searchParams.get('focus');

  const places = trip.places ?? [];
  const withCoords = places.filter((p) => p.lat != null && p.lng != null) as (typeof places[number] & {
    lat: number;
    lng: number;
  })[];

  const focusedPlace = focusId ? places.find((p) => p.id === focusId) : undefined;

  return (
    <div className="panel" style={{ padding: 14 }}>
      <div className="row between mb">
        <h2 className="panel-title" style={{ margin: 0 }}>Trip map</h2>
        <span className="badge">
          {focusedPlace ? `Showing: ${focusedPlace.name}` : 'OpenStreetMap · CARTO Dark'}
        </span>
      </div>
      <TripMap places={places} destination={trip.destination} focusPlaceId={focusId ?? undefined} />

      {withCoords.length === 0 && !focusedPlace && (
        <div className="empty-state mt">
          <div className="big">No placed stops yet</div>
          <p>
            Showing the trip destination (<b>{trip.destination || '—'}</b>) on the map.
            Add lat/lng to a place in the Itinerary tab to switch focus to your stops.
          </p>
        </div>
      )}

      {withCoords.length > 0 && (
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
      )}
    </div>
  );
}