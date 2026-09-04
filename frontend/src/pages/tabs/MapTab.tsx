import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MapPin, ExternalLink, Image as ImageIcon } from 'lucide-react';
import { TripMap, type PlaceWithStop } from '../../components/TripMap';
import type { Trip } from '../../lib/types';

export function MapTab({ trip }: { trip: Trip }) {
  const [params] = useSearchParams();
  const [selected, setSelected] = useState<string | undefined>(params.get('focus') ?? undefined);
  const sortedDays = useMemo(
    () => [...(trip.days ?? [])].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime() || a.sortOrder - b.sortOrder),
    [trip.days],
  );
  const places = useMemo<PlaceWithStop[]>(() => {
    const dayNumbers = new Map(sortedDays.map((day, index) => [day.id, index + 1]));
    return (trip.places ?? []).map((place) => ({ ...place, stopNumber: dayNumbers.get(place.dayId ?? '') }));
  }, [sortedDays, trip.places]);

  return (
    <div className="panel" style={{ padding: 14 }}>
      <div className="row between mb">
        <h2 className="panel-title" style={{ margin: 0 }}>Trip map</h2>
        <span className="badge">Google Maps · {places.length} itinerary items</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.6fr) minmax(300px,.9fr)', gap: 14 }}>
        <TripMap places={places} destination={trip.destination} focusPlaceId={selected} onPlaceClick={setSelected} height="70vh" />
        <div style={{ maxHeight: '70vh', overflowY: 'auto', display: 'grid', gap: 8 }}>
          {places.map((place) => {
            const photo = (trip.photos ?? []).find((item) => item.placeId === place.id);
            const day = sortedDays.findIndex((item) => item.id === place.dayId) + 1;
            const googleUrl = place.lat != null && place.lng != null
              ? `https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}`
              : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([place.name, place.address, trip.destination].filter(Boolean).join(', '))}`;
            return (
              <div key={place.id} className={`list-row ${selected === place.id ? 'active-highlight' : ''}`}
                style={{ alignItems: 'stretch', cursor: 'pointer' }} onClick={() => setSelected(place.id)}>
                <div style={{ width: 82, minHeight: 68, borderRadius: 7, overflow: 'hidden', background: 'var(--panel-2)', display: 'grid', placeItems: 'center' }}>
                  {photo ? <img src={photo.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <ImageIcon size={22} className="muted" />}
                </div>
                <div className="grow">
                  <div className="title">{day > 0 ? `Day ${day} · ` : ''}{place.name}</div>
                  <div className="sub"><MapPin size={11} /> {place.address || 'Location resolved from item name'}</div>
                  <div className="small muted">{[place.category, place.startTime ? new Date(place.startTime).toLocaleString() : null, place.notes].filter(Boolean).join(' · ').slice(0, 220)}</div>
                  <div className="row mt" style={{ gap: 6 }}>
                    {place.website && <a className="btn sm ghost" href={place.website} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}><ExternalLink size={11} /> Info</a>}
                    <a className="btn sm ghost" href={googleUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}><MapPin size={11} /> Google Maps</a>
                  </div>
                </div>
              </div>
            );
          })}
          {!places.length && <div className="empty-state">No itinerary items yet.</div>}
        </div>
      </div>
    </div>
  );
}
