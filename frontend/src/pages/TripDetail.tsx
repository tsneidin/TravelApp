import { useCallback, useEffect, useState } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { apiGet, apiPatch, apiDelete } from '../lib/api';
import { endForStart } from '../lib/dateRange';
import { useAuth } from '../lib/auth';
import type { Trip } from '../lib/types';
import { Spinner } from '../components/Spinner';
import { Modal } from '../components/Modal';
import { ItineraryTab } from './tabs/ItineraryTab';
import { MapTab } from './tabs/MapTab';
import { BudgetTab } from './tabs/BudgetTab';
import { PhotosJournalTab } from './tabs/PhotosJournalTab';
import { PackingTab } from './tabs/PackingTab';
import { BookingsTab } from './tabs/BookingsTab';

type Tab =
  | 'itinerary'
  | 'map'
  | 'budget'
  | 'photos'
  | 'packing'
  | 'bookings';

const TABS: { key: Tab; label: string }[] = [
  { key: 'itinerary', label: 'Itinerary' },
  { key: 'map', label: 'Map' },
  { key: 'budget', label: 'Budget' },
  { key: 'photos', label: 'Photos & journal' },
  { key: 'packing', label: 'Packing' },
  { key: 'bookings', label: 'Bookings' },
];

export function TripDetail() {
  const { tripId } = useParams();
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const [trip, setTrip] = useState<Trip | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestedTab = (searchParams.get('tab') as Tab | null) ?? 'itinerary';
  const tab = TABS.some((t) => t.key === requestedTab) ? requestedTab : 'itinerary';
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState({ name: '', destination: '', currency: 'USD', startDate: '', endDate: '', description: '' });

  const load = useCallback(async () => {
    try {
      const r = await apiGet<{ trip: Trip }>(`/trips/${tripId}`);
      setTrip(r.trip);
      window.dispatchEvent(new CustomEvent('travelapp:trip-updated', { detail: { trip: r.trip } }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  // Reload whenever the AI assistant modifies this trip (itinerary/bookings/budget).
  useEffect(() => {
    const onMutated = (e: Event) => {
      const detail = (e as CustomEvent).detail as { tripId?: string } | undefined;
      if (!detail?.tripId || detail.tripId === tripId) void load();
    };
    window.addEventListener('travelapp:mutated', onMutated);
    return () => window.removeEventListener('travelapp:mutated', onMutated);
  }, [load, tripId]);

  const save = async () => {
    await apiPatch(`/trips/${tripId}`, {
      name: form.name,
      destination: form.destination,
      currency: form.currency,
      startDate: form.startDate || null,
      endDate: form.endDate || null,
      description: form.description,
    });
    setEditOpen(false);
    await load();
  };

  const remove = async () => {
    if (!confirm('Delete this trip and all its data? This cannot be undone.')) return;
    await apiDelete(`/trips/${tripId}`);
    window.location.href = '/';
  };

  if (loading) return <div className="app-shell"><Spinner label="Loading trip…" /></div>;
  if (error) return <div className="app-shell"><div className="empty-state"><div className="big danger">{error}</div></div></div>;
  if (!trip) return null;

  const isOwner = trip.ownerId === user?.id;

  const openEdit = () => {
    setForm({
      name: trip.name,
      destination: trip.destination || '',
      currency: trip.currency,
      startDate: trip.startDate ? trip.startDate.slice(0, 10) : '',
      endDate: trip.endDate ? trip.endDate.slice(0, 10) : '',
      description: trip.description ?? '',
    });
    setEditOpen(true);
  };

  return (
    <div className="app-shell">
      <div className="page-head">
        <div>
          <Link to="/" className="link small">← All trips</Link>
          <h1 className="page-title">{trip.name}</h1>
          <p className="page-sub">
            {trip.destination || 'Destination TBD'}
            {trip.startDate ? ` · ${new Date(trip.startDate).toLocaleDateString()} — ${trip.endDate ? new Date(trip.endDate).toLocaleDateString() : '?'}` : ''}
            {' · '}
            {trip.owner?.name ?? 'you'}
          </p>
        </div>
        <div className="row">
          <button className="btn" onClick={openEdit}>Edit trip</button>
          {isOwner && <button className="btn danger" onClick={remove}>Delete</button>}
        </div>
      </div>

      {tab === 'itinerary' && <ItineraryTab trip={trip} reload={load} />}
      {tab === 'map' && <MapTab trip={trip} reload={load} />}
      {tab === 'budget' && <BudgetTab trip={trip} reload={load} />}
      {tab === 'photos' && <PhotosJournalTab trip={trip} reload={load} />}
      {tab === 'packing' && <PackingTab trip={trip} reload={load} />}
      {tab === 'bookings' && <BookingsTab trip={trip} reload={load} />}

      {editOpen && (
        <Modal title="Edit trip" onClose={() => setEditOpen(false)}>
          <div className="field">
            <label>Name</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="field">
            <label>Destination</label>
            <input value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} />
          </div>
          <div className="grid grid-2">
            <div className="field">
              <label>Start date</label>
              <input type="date" value={form.startDate} onChange={(e) => { const startDate = e.target.value; setForm({ ...form, startDate, endDate: endForStart(startDate, form.endDate) }); }} />
            </div>
            <div className="field">
              <label>End date</label>
              <input type="date" min={form.startDate || undefined} value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
            </div>
          </div>
          <div className="field small">
            <label>Currency</label>
            <select value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })}>
              {['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'NZD'].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Description</label>
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="modal-actions">
            <button className="btn" onClick={() => setEditOpen(false)}>Cancel</button>
            <button className="btn primary" onClick={save}>Save</button>
          </div>
        </Modal>
      )}
    </div>
  );
}