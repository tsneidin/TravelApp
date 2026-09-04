import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { apiGet, apiPost, apiPatch, getToken } from '../lib/api';
import type { CalendarEvent, Trip, BookingType } from '../lib/types';
import { CalendarGrid } from '../components/CalendarGrid';
import { Modal } from '../components/Modal';
import { Spinner } from '../components/Spinner';

export function CalendarView() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [addDate, setAddDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [selTrip, setSelTrip] = useState('');

  const load = useCallback(async () => {
    const [ev, tr] = await Promise.all([
      apiGet<{ events: CalendarEvent[] }>('/calendar'),
      apiGet<{ trips: Trip[] }>('/trips'),
    ]);
    setEvents(ev.events);
    setTrips(tr.trips);
    if (!selTrip && tr.trips.length) setSelTrip(tr.trips[0].id);
  }, [selTrip]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const tripNames = useMemo(() => new Map(trips.map((t) => [t.id, t.name])), [trips]);

  const nav = (d: number) => {
    const dt = new Date(year, month + d, 1);
    setYear(dt.getFullYear());
    setMonth(dt.getMonth());
  };

  const ensureDay = async (tripId: string, date: string) => {
    const r = await apiGet<{ days: { id: string; date: string }[] }>(`/trips/${tripId}/days`);
    const hit = r.days.find((d) => d.date.slice(0, 10) === date);
    if (hit) return hit.id;
    const created = await apiPost<{ day: { id: string } }>(`/trips/${tripId}/days`, { date: new Date(date + 'T12:00:00Z').toISOString() });
    return created.day.id;
  };

  const moveEvent = async (ev: CalendarEvent, date: string) => {
    try {
      if (ev.type === 'place' && ev.placeId) {
        const dayId = await ensureDay(ev.tripId, date);
        await apiPatch(`/trips/${ev.tripId}/places/${ev.placeId}`, { dayId });
      } else if (ev.type === 'booking') {
        const bookingId = ev.id.replace(/^b-/, '');
        await apiPatch(`/trips/${ev.tripId}/bookings/${bookingId}`, {
          startAt: new Date(date + 'T12:00:00Z').toISOString(),
        });
      }
      await load();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const openAdd = (date: string) => {
    setAddDate(date);
    setAddOpen(true);
  };

  const addForm = {
    type: 'activity' as BookingType | 'place',
    title: '',
    provider: '',
    reference: '',
  };
  const [form, setForm] = useState(addForm);

  const saveAdd = async () => {
    if (!form.title || !selTrip) return;
    setBusy(true);
    try {
      if (form.type === 'place') {
        const dayId = await ensureDay(selTrip, addDate);
        await apiPost(`/trips/${selTrip}/places`, { name: form.title, dayId });
      } else {
        await apiPost(`/trips/${selTrip}/bookings`, {
          type: form.type,
          title: form.title,
          provider: form.provider || undefined,
          reference: form.reference || undefined,
          startAt: new Date(addDate + 'T12:00:00Z').toISOString(),
        });
      }
      setAddOpen(false);
      setForm({ ...addForm });
      await load();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const icsUrl = `${window.location.origin}/api/calendar/ics?token=${getToken()}`;

  if (loading) return <div className="app-shell"><Spinner label="Loading calendar…" /></div>;

  return (
    <div className="app-shell">
      <div className="page-head">
        <div>
          <h1 className="page-title">Calendar</h1>
          <p className="page-sub">Every trip's places and bookings, one month at a time.</p>
        </div>
        <div className="row">
          <a className="btn sm" href={icsUrl} target="_blank" rel="noreferrer">
            <Download size={14} /> iCal feed
          </a>
        </div>
      </div>

      <div className="cal-toolbar">
        <button className="btn sm icon-only" onClick={() => nav(-1)}><ChevronLeft size={16} /></button>
        <b style={{ minWidth: 130, textAlign: 'center' }}>
          {new Date(year, month, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </b>
        <button className="btn sm icon-only" onClick={() => nav(1)}><ChevronRight size={16} /></button>
        <div className="spacer" />
        <span className="badge accent">Places</span>
        <span className="badge warn">Bookings</span>
        <span className="small muted">{events.length} events total</span>
      </div>

      <div className="panel" style={{ padding: 14 }}>
        <CalendarGrid
          year={year}
          month={month}
          events={events}
          tripNames={tripNames}
          onSelectDate={openAdd}
          onMoveEvent={moveEvent}
        />
      </div>

      <div className="small muted mt">
        Tip: drag an event onto another date to reschedule it. Click any day to add a place or booking.
      </div>

      {addOpen && (
        <Modal title={`Add on ${new Date(addDate).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}`} onClose={() => setAddOpen(false)}>
          <div className="field small">
            <label>Trip</label>
            <select value={selTrip} onChange={(e) => setSelTrip(e.target.value)}>
              {trips.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div className="seg mb" style={{ marginBottom: 16 }}>
            <button type="button" className={form.type === 'place' ? 'active' : ''} onClick={() => setForm({ ...form, type: 'place' })}>Place / activity</button>
            <button type="button" className={form.type === 'flight' ? 'active' : ''} onClick={() => setForm({ ...form, type: 'flight' })}>Flight</button>
            <button type="button" className={form.type === 'hotel' ? 'active' : ''} onClick={() => setForm({ ...form, type: 'hotel' })}>Hotel</button>
            <button type="button" className={form.type === 'car' ? 'active' : ''} onClick={() => setForm({ ...form, type: 'car' })}>Car</button>
            <button type="button" className={form.type === 'activity' ? 'active' : ''} onClick={() => setForm({ ...form, type: 'activity' })}>Activity</button>
          </div>
          <div className="field">
            <label>{form.type === 'place' ? 'Place name' : 'Booking title'}</label>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder={form.type === 'place' ? 'e.g. Meiji Shrine' : 'e.g. ANA flight'} autoFocus />
          </div>
          {form.type !== 'place' && (
            <div className="grid grid-2">
              <div className="field">
                <label>Provider</label>
                <input value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} />
              </div>
              <div className="field">
                <label>Reference</label>
                <input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} />
              </div>
            </div>
          )}
          <div className="modal-actions">
            <button className="btn" onClick={() => setAddOpen(false)}>Cancel</button>
            <button className="btn primary" onClick={saveAdd} disabled={busy || !form.title}>Add</button>
          </div>
        </Modal>
      )}
    </div>
  );
}