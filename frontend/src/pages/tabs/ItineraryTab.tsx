import { useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Plus, Trash2, MapPin, GripVertical, Map as MapIcon, Pencil, FileText,
  Columns, List, Sparkles, Navigation
} from 'lucide-react';
import { apiPost, apiPatch, apiDelete } from '../../lib/api';
import type { Trip, Place } from '../../lib/types';
import { Modal } from '../../components/Modal';
import { TripMap, type PlaceWithStop } from '../../components/TripMap';
import { PlaceSearchInput } from '../../components/PlaceSearchInput';
import { TravelEstimate } from '../../components/TravelEstimate';

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
  const [sourcePlace, setSourcePlace] = useState<Place | null>(null);

  // Wanderlog Split View State
  const [viewMode, setViewMode] = useState<'split' | 'full'>(() => {
    return window.innerWidth >= 1024 ? 'split' : 'full';
  });
  const [activePlaceId, setActivePlaceId] = useState<string | null>(null);
  const [selectedDayId, setSelectedDayId] = useState<string | null>(null);

  const days = useMemo(() => trip.days ?? [], [trip.days]);
  const orphanPlaces = useMemo(
    () => (trip.places ?? []).filter((p) => !days.some((d) => d.places.some((x) => x.id === p.id))),
    [trip.places, days],
  );

  // Approximate trip coordinates to bias place searches
  const tripCenter = useMemo(() => {
    const placed = (trip.places ?? []).find((p) => p.lat != null && p.lng != null);
    if (placed && placed.lat != null && placed.lng != null) {
      return { lat: placed.lat, lng: placed.lng };
    }
    return undefined;
  }, [trip.places]);

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

  const handlePlaceClick = (p: Place) => {
    setActivePlaceId(p.id);
    if (viewMode === 'full') {
      navigate(`${location.pathname}?tab=map&focus=${p.id}`);
    }
  };

  // Map places calculation: numbered sequentially within the active day or across days
  const displayedMapPlaces = useMemo<PlaceWithStop[]>(() => {
    if (selectedDayId) {
      const day = days.find((d) => d.id === selectedDayId);
      if (!day) return [];
      return day.places.map((p, i) => ({ ...p, stopNumber: i + 1 }));
    }

    // All days: number stops sequentially within each day
    const result: PlaceWithStop[] = [];
    for (const day of days) {
      day.places.forEach((p, i) => {
        result.push({ ...p, stopNumber: i + 1 });
      });
    }
    orphanPlaces.forEach((p) => result.push(p));
    return result;
  }, [days, selectedDayId, orphanPlaces]);

  const renderPlaceRow = (p: Place, stopNumber?: number) => (
    <div
      key={p.id}
      id={`place-${p.id}`}
      className={`list-row place-card ${dragId === p.id ? 'dragging' : ''} ${activePlaceId === p.id ? 'active-highlight' : ''}`}
      draggable
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', p.id); setDragId(p.id); }}
      onDragEnd={() => setDragId(null)}
      onClick={() => setActivePlaceId(p.id)}
      onMouseEnter={() => setActivePlaceId(p.id)}
    >
      <GripVertical size={14} className="muted grip-handle" style={{ cursor: 'grab' }} />
      {stopNumber != null && (
        <span className="stop-number-badge" title={`Stop #${stopNumber}`}>
          {stopNumber}
        </span>
      )}
      <div className="grow">
        <div className="title">
          {p.website ? (
            <a href={p.website} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
              {p.name} ↗
            </a>
          ) : (
            p.name
          )}
        </div>
        <div className="sub">
          <MapPin size={12} style={{ verticalAlign: -2 }} /> {p.address || (p.lat != null ? `${p.lat.toFixed(3)}, ${p.lng?.toFixed(3)}` : 'No location')}
          {p.category ? ` · ${p.category}` : ''}
          {p.startTime ? ` · ${new Date(p.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}
          {p.notes ? ` · ✏️ ${p.notes}` : ''}
        </div>
      </div>
      <button
        type="button"
        className="btn sm ghost"
        title="Show on map"
        onClick={(e) => {
          e.stopPropagation();
          handlePlaceClick(p);
        }}
      >
        <MapIcon size={14} />
      </button>
      {p.sourceText && (
        <button
          type="button"
          className="btn sm ghost"
          title="View source text"
          onClick={(e) => {
            e.stopPropagation();
            setSourcePlace(p);
          }}
        >
          <FileText size={14} /> Source
        </button>
      )}
      <button
        type="button"
        className="btn sm ghost"
        title="Edit / notes"
        onClick={(e) => {
          e.stopPropagation();
          openEdit(p);
        }}
      >
        <Pencil size={14} />
      </button>
      <button
        type="button"
        className="btn sm ghost danger"
        title="Delete place"
        onClick={(e) => {
          e.stopPropagation();
          void removePlace(p);
        }}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );

  return (
    <div className="itinerary-page-root">
      {/* Wanderlog top action bar */}
      <div className="row between mb-2" style={{ marginBottom: 16 }}>
        <div className="row">
          <h2 className="panel-title" style={{ margin: 0 }}>Day-by-day itinerary</h2>
          <span className="badge accent">{days.length} days</span>
          {trip.places && <span className="badge muted">{trip.places.length} places</span>}
        </div>
        <div className="row">
          <div className="segmented-control">
            <button
              type="button"
              className={`seg-btn ${viewMode === 'split' ? 'active' : ''}`}
              onClick={() => setViewMode('split')}
              title="Split View (Itinerary + Live Map)"
            >
              <Columns size={14} />
              <span>Split map</span>
            </button>
            <button
              type="button"
              className={`seg-btn ${viewMode === 'full' ? 'active' : ''}`}
              onClick={() => setViewMode('full')}
              title="Full Width Itinerary"
            >
              <List size={14} />
              <span>Full list</span>
            </button>
          </div>
          <button type="button" className="btn sm ghost" onClick={() => void addDay()}>
            <Plus size={14} /> Add day
          </button>
          <button type="button" className="btn sm primary" onClick={() => openNew('')}>
            <Plus size={14} /> Add place
          </button>
        </div>
      </div>

      {/* Main Split Layout */}
      <div className={`itinerary-layout-container ${viewMode === 'split' ? 'split-mode' : 'full-mode'}`}>
        {/* Left Itinerary Column */}
        <div className="itinerary-left-pane">
          {days.length === 0 && (
            <div className="empty-state">
              <div className="big">No days yet</div>
              <p>Add days matching your trip dates, then place activities on each day.</p>
              <button type="button" className="btn primary mt" onClick={() => void addDay()}>
                <Plus size={14} /> Add Day 1
              </button>
            </div>
          )}

          {days.map((day, dayIndex) => (
            <div className="panel day-panel" key={day.id} id={`day-${day.id}`} style={{ scrollMarginTop: 16, marginBottom: 18 }}>
              <div className="row between day-header">
                <div className="row">
                  <span className="badge accent">
                    {new Date(day.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                  </span>
                  <b>{day.label || `Day ${dayIndex + 1}`}</b>
                  <span className="day-stop-count small muted">({day.places.length} stops)</span>
                </div>
                <div className="row">
                  <button
                    type="button"
                    className="btn sm ghost"
                    title="Focus this day on the map"
                    onClick={() => setSelectedDayId(selectedDayId === day.id ? null : day.id)}
                  >
                    <Navigation size={13} />
                    <span>{selectedDayId === day.id ? 'Showing all' : 'Focus day'}</span>
                  </button>
                  <button type="button" className="btn sm ghost" onClick={() => openNew(day.id)}>
                    <Plus size={14} /> Add
                  </button>
                  <button type="button" className="btn sm ghost danger" onClick={() => removeDay(day.id)} title="Delete day">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {day.places.length === 0 ? (
                <div className="small muted mt mb">Nothing planned this day yet.</div>
              ) : (
                <div
                  className="day-places-list"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => dropOnDay(day.id, day.places.length)(e)}
                >
                  {day.places.map((p, pIdx) => {
                    const nextPlace = day.places[pIdx + 1];
                    const hasCoords = p.lat != null && p.lng != null;
                    const nextHasCoords = nextPlace?.lat != null && nextPlace?.lng != null;

                    return (
                      <div key={p.id}>
                        {renderPlaceRow(p, pIdx + 1)}
                        {nextPlace && hasCoords && nextHasCoords && (
                          <TravelEstimate
                            origin={{ lat: p.lat!, lng: p.lng!, name: p.name }}
                            destination={{ lat: nextPlace.lat!, lng: nextPlace.lng!, name: nextPlace.name }}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Quick-add place search bar inside day panel */}
              <div className="day-quick-add mt">
                <PlaceSearchInput
                  placeholder={`+ Quick add to ${day.label || `Day ${dayIndex + 1}`}…`}
                  biasLat={tripCenter?.lat}
                  biasLng={tripCenter?.lng}
                  onSelect={async (pl) => {
                    await apiPost(`/trips/${trip.id}/places`, {
                      name: pl.name,
                      address: pl.address,
                      category: pl.category,
                      lat: pl.lat,
                      lng: pl.lng,
                      dayId: day.id,
                    });
                    await reload();
                  }}
                />
              </div>
            </div>
          ))}

          {orphanPlaces.length > 0 && (
            <div className="panel mt">
              <h2 className="panel-title">Unassigned places</h2>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                {orphanPlaces.map((p) => (
                  <div key={p.id} style={{ width: '100%' }}>
                    {renderPlaceRow(p)}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Sticky Map Column in Split View */}
        {viewMode === 'split' && (
          <div className="itinerary-right-pane">
            <div className="itinerary-sticky-map-wrapper">
              <div className="map-pane-header">
                <div className="row small">
                  <MapIcon size={14} className="text-accent" />
                  <b>Live Map</b>
                  <span className="badge muted">
                    {selectedDayId
                      ? (days.find((d) => d.id === selectedDayId)?.label || 'Focused Day')
                      : 'All stops'}
                  </span>
                </div>
                <div className="row small map-day-filter-buttons">
                  <button
                    type="button"
                    className={`btn sm ${!selectedDayId ? 'primary' : 'ghost'}`}
                    onClick={() => setSelectedDayId(null)}
                  >
                    All
                  </button>
                  {days.map((d, i) => (
                    <button
                      key={d.id}
                      type="button"
                      className={`btn sm ${selectedDayId === d.id ? 'primary' : 'ghost'}`}
                      onClick={() => setSelectedDayId(d.id)}
                    >
                      D{i + 1}
                    </button>
                  ))}
                </div>
              </div>
              <div className="itinerary-sticky-map-canvas">
                <TripMap
                  places={displayedMapPlaces}
                  destination={trip.destination}
                  activePlaceId={activePlaceId ?? undefined}
                  onPlaceClick={(id) => {
                    setActivePlaceId(id);
                    const el = document.getElementById(`place-${id}`);
                    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }}
                  height="100%"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {sourcePlace && (
        <Modal title={`Source — ${sourcePlace.name}`} onClose={() => setSourcePlace(null)}>
          <pre className="ai-raw-pre" style={{ whiteSpace: 'pre-wrap', maxHeight: '65vh', overflow: 'auto' }}>
            {sourcePlace.sourceText}
          </pre>
          <div className="modal-actions">
            <button type="button" className="btn primary" onClick={() => setSourcePlace(null)}>Close</button>
          </div>
        </Modal>
      )}

      {/* Add / Edit Place Modal with Search Autocomplete */}
      {open && (
        <Modal title={editingId ? 'Edit place' : 'Add place'} onClose={() => setOpen(false)}>
          <div className="field mb-3">
            <label className="field-label-sparkle">
              <Sparkles size={13} className="text-accent" />
              <span>Search landmark, restaurant or address (auto-fill)</span>
            </label>
            <PlaceSearchInput
              biasLat={tripCenter?.lat}
              biasLng={tripCenter?.lng}
              placeholder="e.g. Eiffel Tower, Louvre, Joe's Pizza…"
              autoFocus={!editingId}
              onSelect={(pl) => {
                setEditing((prev) => ({
                  ...prev,
                  name: pl.name,
                  address: pl.address,
                  category: pl.category,
                  lat: String(pl.lat),
                  lng: String(pl.lng),
                }));
              }}
            />
          </div>

          <div className="field">
            <label>Name</label>
            <input
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              placeholder="e.g. Meiji Shrine"
            />
          </div>
          <div className="field small">
            <label>Category</label>
            <select value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })}>
              <option value="">—</option>
              <option>Sightseeing</option>
              <option>Restaurant</option>
              <option>Activity</option>
              <option>Transport</option>
              <option>Accommodation</option>
              <option>Shopping</option>
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
                <option value="">No day (unassigned)</option>
                {days.map((d, i) => (
                  <option key={d.id} value={d.id}>
                    {d.label || `Day ${i + 1}`} ({new Date(d.date).toLocaleDateString()})
                  </option>
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
            <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" className="btn primary" onClick={save} disabled={busy || !editing.name}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}