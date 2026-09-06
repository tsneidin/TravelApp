import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MapPin, ExternalLink, Image as ImageIcon } from 'lucide-react';
import { TripMap, type PlaceWithStop } from '../../components/TripMap';
import { Modal } from '../../components/Modal';
import { apiPost } from '../../lib/api';
import type { GeocodedPlace, Trip } from '../../lib/types';
import { computePlaceStopNumberMap } from '../../lib/placeUtils';
import { formatPlaceTime } from './ItineraryTab';

export function MapTab({ trip, reload }: { trip: Trip; reload: () => Promise<void> }) {
  const [params] = useSearchParams();
  const [selected, setSelected] = useState<string | undefined>(params.get('focus') ?? undefined);
  const [draft, setDraft] = useState<GeocodedPlace | null>(null);
  const [draftDayId, setDraftDayId] = useState('');
  const [saving, setSaving] = useState(false);
  const sortedDays = useMemo(
    () => [...(trip.days ?? [])].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime() || a.sortOrder - b.sortOrder),
    [trip.days],
  );

  const placeStopNumberMap = useMemo(() => {
    const scheduled = sortedDays.flatMap((day) => day.places || []);
    const scheduledIds = new Set(scheduled.map((place) => place.id));
    const unassigned = (trip.places ?? []).filter((place) => !scheduledIds.has(place.id));
    return computePlaceStopNumberMap(sortedDays, unassigned);
  }, [sortedDays, trip.places]);

  const places = useMemo<PlaceWithStop[]>(() => {
    const scheduled = sortedDays.flatMap((day) => day.places || []);
    const scheduledIds = new Set(scheduled.map((place) => place.id));
    const unassigned = (trip.places ?? []).filter((place) => !scheduledIds.has(place.id));
    return [...scheduled, ...unassigned].map((place) => ({
      ...place,
      stopNumber: placeStopNumberMap.get(place.id),
    }));
  }, [sortedDays, trip.places, placeStopNumberMap]);

  const saveDraft = async () => {
    if (!draft?.name.trim()) return;
    setSaving(true);
    try {
      await apiPost(`/trips/${trip.id}/places`, {
        name: draft.name.trim(),
        address: draft.address,
        category: draft.category,
        lat: draft.lat,
        lng: draft.lng,
        website: draft.website,
        dayId: draftDayId || undefined,
      });
      setDraft(null);
      setDraftDayId('');
      await reload();
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="panel" style={{ padding: 14 }}>
        <div className="row between mb">
          <h2 className="panel-title" style={{ margin: 0 }}>Trip map</h2>
          <div className="row">
            <span className="small muted">Click to explore or right-click for directions & tools</span>
            <span className="badge">Google Maps · {places.length} itinerary items</span>
          </div>
        </div>
        <div className="map-tab-layout">
          <TripMap
            places={places}
            destination={trip.destination}
            focusPlaceId={selected}
            tripId={trip.id}
            days={trip.days}
            mapViews={trip.mapViews}
            onMapViewsChange={reload}
            onPlaceClick={setSelected}
            onMapClick={(place) => {
              setDraft(place);
              setDraftDayId('');
            }}
            height="70vh"
          />
          <div className="map-tab-list">
            {places.map((place) => {
              const photo = (trip.photos ?? []).find((item) => item.placeId === place.id);
              const day = sortedDays.findIndex((item) => item.id === place.dayId) + 1;
              const googleUrl = place.lat != null && place.lng != null
                ? `https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}`
                : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([place.name, place.address, trip.destination].filter(Boolean).join(', '))}`;
              return (
                <div key={place.id} className={`list-row ${selected === place.id ? 'active-highlight' : ''}`}
                  style={{ alignItems: 'stretch', cursor: 'pointer' }} onClick={() => setSelected((prev) => prev === place.id ? undefined : place.id)}>
                  <div style={{ width: 82, minHeight: 68, borderRadius: 7, overflow: 'hidden', background: 'var(--panel-2)', display: 'grid', placeItems: 'center' }}>
                    {photo ? <img src={photo.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <ImageIcon size={22} className="muted" />}
                  </div>
                  <div className="grow">
                    <div className="title">
                      {place.stopNumber != null && (
                        <span className="stop-number-badge" style={{ display: 'inline-flex', verticalAlign: 'middle', marginRight: 6, fontSize: '0.72rem', padding: '1px 6px', borderRadius: 4, background: 'var(--accent)', color: '#fff' }}>
                          {place.stopNumber}
                        </span>
                      )}
                      {day > 0 ? `Day ${day} · ` : ''}{place.name}
                    </div>
                    <div className="sub"><MapPin size={11} /> {place.address || 'Location resolved from item name'}</div>
                    <div className="small muted">{[place.category, formatPlaceTime(place.startTime, place.endTime), place.notes].filter(Boolean).join(' · ').slice(0, 220)}</div>
                    <div className="row mt" style={{ gap: 6 }}>
                      {place.website && <a className="btn sm ghost" href={place.website} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}><ExternalLink size={11} /> Info</a>}
                      <a className="btn sm ghost" href={googleUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}><MapPin size={11} /> Google Maps</a>
                    </div>
                  </div>
                </div>
              );
            })}
            {!places.length && <div className="empty-state">No itinerary items yet. Click the map to add one.</div>}
          </div>
        </div>
      </div>

      {draft && (
        <Modal title="Add map place to itinerary" onClose={() => setDraft(null)}>
          <div className="field">
            <label>Name</label>
            <input autoFocus value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          </div>
          <div className="field">
            <label>Address</label>
            <input value={draft.address} onChange={(event) => setDraft({ ...draft, address: event.target.value })} />
          </div>
          <div className="field small">
            <label>Category</label>
            <select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })}>
              <option>Sightseeing</option>
              <option>Restaurant</option>
              <option>Activity</option>
              <option>Transport</option>
              <option>Accommodation</option>
              <option>Shopping</option>
            </select>
          </div>
          <div className="field small">
            <label>Day</label>
            <select value={draftDayId} onChange={(event) => setDraftDayId(event.target.value)}>
              <option value="">No day (unassigned)</option>
              {sortedDays.map((day, index) => (
                <option key={day.id} value={day.id}>
                  {`Day ${index + 1}${day.label && !/^day\s*\d+$/i.test(day.label.trim()) ? `: ${day.label}` : ''} (${new Date(day.date).toLocaleDateString()})`}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Website</label>
            <input
              type="url"
              value={draft.website || ''}
              onChange={(event) => setDraft({ ...draft, website: event.target.value })}
              placeholder="Official place website (when available)"
            />
          </div>
          {draft.mapUrl && (
            <a className="link small" href={draft.mapUrl} target="_blank" rel="noreferrer">Open Google Maps listing ↗</a>
          )}
          <div className="modal-actions">
            <button type="button" className="btn" onClick={() => setDraft(null)}>Cancel</button>
            <button type="button" className="btn primary" disabled={saving || !draft.name.trim()} onClick={() => void saveDraft()}>
              {saving ? 'Adding…' : 'Add to itinerary'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
