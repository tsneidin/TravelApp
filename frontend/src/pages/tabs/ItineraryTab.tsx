import { useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Plus, Trash2, MapPin, GripVertical, Map as MapIcon, Pencil } from 'lucide-react';
import { apiPost, apiPatch, apiDelete } from '../../lib/api';
import type { Trip, Place } from '../../lib/types';
import { Modal } from '../../components/Modal';

interface PlaceForm {
  dayId?: string;
  name: string;
  category: string;
  address: string;
  lat?: string;
  lng?: string;
  website: string;
  notes: string;
}

const EMPTY_FORM: PlaceForm = { dayId: '', name: '', category: '', address: '', lat: '', lng: '', website: '', notes: '' };

export function ItineraryTab({ trip, reload }: { trip: Trip; reload: () => Promise<void> }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<PlaceForm>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);

  const days = useMemo(() => trip.days ?? [], [trip.days]);
  const orphanPlaces = useMemo(
    () => (trip.places ?? []).filter((p) => !days.some((d) => d.places.some((x) => x.id === p.id))),
    [trip.places, days],
  );

  const openNew = (dayId: string) => {
    setEditingId(null);
    setEditing({ ...EMPTY_FORM, dayId });
    setOpen(true);
  };

  const openEdit = (p: Place) => {
    setEditingId(p.id);
    setEditing({
      dayId: p.dayId ?? '',
      name: p.name,
      category: p.category ?? '',
      address: p.address ?? '',
      lat: p.lat != null ? String(p.lat) : '',
      lng: p.lng != null ? String(p.lng) : '',
      website: p.website ?? '',
      notes: p.notes ?? '',
    });
    setOpen(true);
  };

  const addDay = async () => {
    const base = trip.startDate ? new Date(trip.startDate) : new Date();
    const date = new Date(base);
    date.setDate(base.getDate() + days.length);
    await apiPost(`/trips/${trip.id}/days`, { date: date.toISOString(), label: `Day ${days.length + 1}` });
    await reload();
  };

  const save = async () => {
    setBusy(true);
    try {
      const payload = {
        name: editing.name,
        category: editing.category || undefined,
        address: editing.address || undefined,
        lat: editing.lat ? Number(editing.lat) : null,
        lng: editing.lng ? Number(editing.lng) : null,
        website: editing.website || undefined,
        notes: editing.notes || undefined,
        dayId: editing.dayId || undefined,
      };
      if (editingId) {
        await apiPatch(`/trips/${trip.id}/places/${editingId}`, payload);
      } else if (editing.name) {
        await apiPost(`/trips/${trip.id}/places`, payload);
      }
      setOpen(false);
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const reorder = async (placeId: string, targetDayId: string, index: number) => {
    const all = [...(trip.places ?? [])];
    const idx = all.findIndex((p) => p.id === placeId);
    if (idx < 0) return;
    const [pl] = all.splice(idx, 1);
    pl.dayId = targetDayId;
    const siblings = all.filter((p) => p.dayId === targetDayId);
    siblings.sort((a, b) => a.sortOrder - b.sortOrder);
    siblings.splice(Math.min(index, siblings.length), 0, pl);
    const entries = siblings.map((p, i) => ({ placeId: p.id, dayId: targetDayId, sortOrder: i }));
    await apiPost(`/trips/${trip.id}/reorder`, { entries });
    await reload();
  };

  const dropOnDay = (dayId: string, index: number) => (e: React.DragEvent) => {
    e.preventDefault();
    const placeId = e.dataTransfer.getData('text/plain');
    if (placeId && dragId) void reorder(dragId, dayId, index);
  };

  const removePlace = async (p: Place) => {
    if (!confirm(`Remove "${p.name}" from the trip?`)) return;
    await apiDelete(`/trips/${trip.id}/places/${p.id}`);
    await reload();
  };

  const removeDay = async (dayId: string) => {
    if (!confirm('Delete this day? Places will be kept but unassigned.')) return;
    await apiDelete(`/trips/${trip.id}/days/${dayId}`);
    await reload();
  };

  const openOnMap = (p: Place) => {
    navigate(`${location.pathname}?tab=map&focus=${p.id}`);
  };

  const renderPlaceRow = (p: Place) => (
    <div
      key={p.id}
      className={`list-row ${dragId === p.id ? 'dragging' : ''}`}
      draggable
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', p.id); setDragId(p.id); }}
      onDragEnd={() => setDragId(null)}
    >
      <GripVertical size={14} className="muted" style={{ cursor: 'grab' }} />
      <div className="grow">
        <div className="title">
          {p.website ? (
            <a href={p.website} target="_blank" rel="noreferrer">{p.name} ↗</a>
          ) : p.name}
        </div>
        <div className="sub">
          <MapPin size={12} style={{ verticalAlign: -2 }} /> {p.address || (p.lat != null ? `${p.lat.toFixed(3)}, ${p.lng?.toFixed(3)}` : 'No location')}
          {p.category ? ` · ${p.category}` : ''}
          {p.startTime ? ` · ${new Date(p.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
          {p.notes ? ` · ✏️ ${p.notes}` : ''}
        </div>
      </div>
      <button className="btn sm ghost" title="Show on map" onClick={() => openOnMap(p)}>
        <MapIcon size={14} />
      </button>
      <button className="btn sm ghost" title="Edit / notes" onClick={() => openEdit(p)}>
        <Pencil size={14} />
      </button>
      <button className="btn sm ghost danger" onClick={() => removePlace(p)}>
        <Trash2 size={14} />
      </button>
    </div>
  );

  return (
    <div className="grid" style={{ gridTemplateColumns: '1fr' }}>
      <div className="row between">
        <h2 className="panel-title" style={{ margin: 0 }}>Day-by-day plan</h2>
        <div className="row">
          <button className="btn sm ghost" onClick={() => void addDay()}>
            <Plus size={14} /> Add day
          </button>
          <button className="btn sm" onClick={() => openNew('')}>
            <Plus size={14} /> Add place
          </button>
        </div>
      </div>

      {days.length === 0 && (
        <div className="empty-state">
          <div className="big">No days yet</div>
          <p>Add days matching your trip dates, then place activities on each day.</p>
        </div>
      )}

      {days.map((day) => (
        <div className="panel" key={day.id} id={`day-${day.id}`} style={{ scrollMarginTop: 16 }}>
          <div className="row between">
            <div className="row">
              <span className="badge accent">{new Date(day.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
              <b>{day.label || 'Day'}</b>
            </div>
            <div className="row">
              <button className="btn sm ghost" onClick={() => openNew(day.id)}>
                <Plus size={14} /> Add place
              </button>
              <button className="btn sm ghost danger" onClick={() => removeDay(day.id)} title="Delete day">
                <Trash2 size={14} />
              </button>
            </div>
          </div>

          {day.places.length === 0 ? (
            <div className="small muted mt">Nothing planned this day yet.</div>
          ) : (
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => dropOnDay(day.id, day.places.length)(e)}
            >
              {day.places.map((p) => (
                <div key={p.id}>
                  {renderPlaceRow(p)}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {orphanPlaces.length > 0 && (
        <div className="panel">
          <h2 className="panel-title">Unassigned places</h2>
          <div className="row" style={{ gap: 8 }}>
            {orphanPlaces.map((p) => (
              <div key={p.id} className="grow">
                {renderPlaceRow(p)}
              </div>
            ))}
          </div>
        </div>
      )}

      {open && (
        <Modal title={editingId ? 'Edit place' : 'Add place'} onClose={() => setOpen(false)}>
          <div className="field">
            <label>Name</label>
            <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="e.g. Meiji Shrine" autoFocus />
          </div>
          <div className="field small">
            <label>Category</label>
            <select value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })}>
              <option value="">—</option>
              <option>Restaurant</option><option>Sightseeing</option><option>Activity</option>
              <option>Transport</option><option>Accommodation</option><option>Shopping</option>
            </select>
          </div>
          <div className="field">
            <label>Address</label>
            <input value={editing.address} onChange={(e) => setEditing({ ...editing, address: e.target.value })} placeholder="Street, city" />
          </div>
          <div className="grid grid-2">
            <div className="field small">
              <label>Lat</label>
              <input value={editing.lat} onChange={(e) => setEditing({ ...editing, lat: e.target.value })} placeholder="35.6764" />
            </div>
            <div className="field small">
              <label>Lng</label>
              <input value={editing.lng} onChange={(e) => setEditing({ ...editing, lng: e.target.value })} placeholder="139.6993" />
            </div>
          </div>
          {days.length > 0 && (
            <div className="field small">
              <label>Day</label>
              <select value={editing.dayId ?? ''} onChange={(e) => setEditing({ ...editing, dayId: e.target.value })}>
                <option value="">No day</option>
                {days.map((d) => (
                  <option key={d.id} value={d.id}>{new Date(d.date).toLocaleDateString()} {d.label ? `— ${d.label}` : ''}</option>
                ))}
              </select>
            </div>
          )}
          <div className="field">
            <label>Website</label>
            <input
              type="url"
              value={editing.website}
              onChange={(e) => setEditing({ ...editing, website: e.target.value })}
              placeholder="https://…"
            />
          </div>
          <div className="field">
            <label>Notes</label>
            <textarea value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
          </div>
          <div className="modal-actions">
            <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn primary" onClick={save} disabled={busy || !editing.name}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}