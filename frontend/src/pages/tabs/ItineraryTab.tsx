import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Plus, Trash2, MapPin, GripVertical, Map as MapIcon, Pencil, FileText,
  Columns, List, Sparkles, Navigation, NotebookPen, BookOpen, CalendarCheck, CalendarX,
  ChevronDown, ChevronUp, Clock, ChevronLeft, ChevronRight
} from 'lucide-react';
import { apiPost, apiPatch, apiDelete } from '../../lib/api';
import type { Trip, Place } from '../../lib/types';
import { Modal } from '../../components/Modal';
import { TripMap, type PlaceWithStop } from '../../components/TripMap';
import { PlaceSearchInput } from '../../components/PlaceSearchInput';
import { TravelEstimate } from '../../components/TravelEstimate';
import { getCategoryIcon } from '../../lib/icons';

interface PlaceForm {
  dayId?: string;
  name: string;
  category: string;
  address: string;
  lat?: string;
  lng?: string;
  website: string;
  description: string;
  notes: string;
}

const EMPTY_FORM: PlaceForm = { dayId: '', name: '', category: '', address: '', lat: '', lng: '', website: '', description: '', notes: '' };

function isGenericDayLabel(label?: string | null): boolean {
  if (!label) return true;
  const trimmed = label.trim();
  if (!trimmed) return true;
  return /^day\s*\d+$/i.test(trimmed);
}

export function ItineraryTab({ trip, reload }: { trip: Trip; reload: () => Promise<void> }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<PlaceForm>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [suggestingTitle, setSuggestingTitle] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [expandedPlaceIds, setExpandedPlaceIds] = useState<Set<string>>(new Set());
  const [sourcePlace, setSourcePlace] = useState<Place | null>(null);
  const [dayEditor, setDayEditor] = useState<{ id: string; label: string; notes: string; dayNumber?: number } | null>(null);
  const [journalDay, setJournalDay] = useState<{ date: string; label: string } | null>(null);
  const [journalForm, setJournalForm] = useState({ title: '', body: '' });

  const toggleExpand = (placeId: string) => {
    setExpandedPlaceIds((prev) => {
      const next = new Set(prev);
      if (next.has(placeId)) next.delete(placeId);
      else next.add(placeId);
      return next;
    });
  };

  const handleSuggestTitle = async () => {
    const sourceText = editing.description.trim() || editing.name.trim();
    if (!sourceText) return;
    setSuggestingTitle(true);
    try {
      const res = await apiPost<{ title: string; description: string; category?: string }>(`/trips/${trip.id}/ai/suggest-title`, {
        text: sourceText,
        category: editing.category || undefined,
      });
      if (res.title) {
        setEditing((prev) => ({
          ...prev,
          name: res.title,
          description: res.description || prev.description || prev.name,
          category: res.category || prev.category,
        }));
      }
    } catch (err) {
      console.error('Failed to suggest title', err);
    } finally {
      setSuggestingTitle(false);
    }
  };

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

  const totalPlacesCount = useMemo(
    () => days.reduce((sum, d) => sum + d.places.length, 0) + orphanPlaces.length,
    [days, orphanPlaces]
  );

  const selectedDayIndex = useMemo(() => {
    if (!selectedDayId) return -1;
    return days.findIndex((d) => d.id === selectedDayId);
  }, [selectedDayId, days]);

  const handlePrevDay = () => {
    setActivePlaceId(null);
    if (selectedDayIndex <= 0) {
      setSelectedDayId(null);
    } else {
      setSelectedDayId(days[selectedDayIndex - 1].id);
    }
  };

  const handleNextDay = () => {
    setActivePlaceId(null);
    if (selectedDayIndex === -1) {
      if (days.length > 0) setSelectedDayId(days[0].id);
    } else if (selectedDayIndex < days.length - 1) {
      setSelectedDayId(days[selectedDayIndex + 1].id);
    }
  };

  // Sync active focused day across the app and to AI assist
  useEffect(() => {
    let detail: { dayId: string | null; dayIndex?: number; label?: string; date?: string; mode?: string } = {
      dayId: selectedDayId,
    };
    if (selectedDayId === 'unassigned') {
      detail = { dayId: 'unassigned', label: 'Unassigned Places', mode: 'unassigned' };
    } else if (selectedDayId) {
      const day = days.find((d) => d.id === selectedDayId);
      const idx = days.findIndex((d) => d.id === selectedDayId) + 1;
      if (day) {
        detail = {
          dayId: day.id,
          dayIndex: idx,
          label: day.label && !isGenericDayLabel(day.label) ? day.label : undefined,
          date: day.date,
          mode: 'day',
        };
      }
    } else {
      detail = { dayId: null, mode: 'all' };
    }
    window.dispatchEvent(new CustomEvent('travelapp:day_focused', { detail }));
  }, [selectedDayId, days]);

  // Listen for AI or external commands to change focused day
  useEffect(() => {
    const handleSetFocus = (e: Event) => {
      const customEvent = e as CustomEvent<{ dayId?: string | null; dayIndex?: number; mode?: string }>;
      const detail = customEvent.detail;
      if (!detail) return;
      if (detail.dayId === '' || detail.dayId === null || detail.mode === 'all') {
        setSelectedDayId(null);
        setActivePlaceId(null);
        return;
      }
      if (detail.dayId === 'unassigned' || detail.mode === 'unassigned') {
        setSelectedDayId('unassigned');
        setActivePlaceId(null);
        setTimeout(() => {
          const el = document.getElementById('places-unassigned');
          el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 80);
        return;
      }
      if (detail.dayId) {
        setSelectedDayId(detail.dayId);
        setActivePlaceId(null);
        setTimeout(() => {
          const el = document.getElementById(`day-${detail.dayId}`);
          el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 80);
      }
    };
    window.addEventListener('travelapp:set_focus_day', handleSetFocus);
    return () => window.removeEventListener('travelapp:set_focus_day', handleSetFocus);
  }, []);

  // When a day has no locations, find the most recent prior day that has a location.
  const fallbackLocation = useMemo(() => {
    if (!selectedDayId || selectedDayId === 'unassigned') {
      return trip.destination ? { address: trip.destination } : undefined;
    }

    const sortedDays = [...days].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime() || a.sortOrder - b.sortOrder,
    );
    const currentIndex = sortedDays.findIndex((d) => d.id === selectedDayId);
    if (currentIndex < 0) {
      return trip.destination ? { address: trip.destination } : undefined;
    }

    for (let i = currentIndex - 1; i >= 0; i--) {
      const priorDay = sortedDays[i];
      if (priorDay.places && priorDay.places.length > 0) {
        const validPlaces = priorDay.places.filter(
          (p) => (p.lat != null && p.lng != null) || p.address?.trim() || p.name?.trim(),
        );
        if (validPlaces.length > 0) {
          const lastPlace = validPlaces[validPlaces.length - 1];
          if (lastPlace.lat != null && lastPlace.lng != null) {
            return {
              coord: { lat: lastPlace.lat, lng: lastPlace.lng },
              name: lastPlace.name,
              address: lastPlace.address || lastPlace.name,
            };
          }
          if (lastPlace.address?.trim()) {
            return {
              address: lastPlace.address.trim(),
              name: lastPlace.name,
            };
          }
          if (lastPlace.name?.trim()) {
            return {
              address: [lastPlace.name.trim(), trip.destination].filter(Boolean).join(', '),
              name: lastPlace.name,
            };
          }
        }
      }
    }

    return trip.destination ? { address: trip.destination } : undefined;
  }, [selectedDayId, days, trip.destination]);

  const lastHashRef = useRef<string | null>(null);

  // React Router updates the hash without performing the browser's normal
  // anchor scroll. Explicitly scroll the independently scrolling center pane ONLY when hash changes.
  useEffect(() => {
    const hash = location.hash;
    if (!hash.startsWith('#day-') && !hash.startsWith('#place-')) {
      lastHashRef.current = null;
      return;
    }
    if (lastHashRef.current === hash) return;
    lastHashRef.current = hash;

    if (hash.startsWith('#day-')) {
      const elementId = decodeURIComponent(hash.slice(1));
      const dayId = decodeURIComponent(hash.slice(5));
      if (dayId && days.some((d) => d.id === dayId)) {
        setSelectedDayId(dayId);
        setActivePlaceId(null);
      }
      const frame = requestAnimationFrame(() => {
        document.getElementById(elementId)?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      });
      return () => cancelAnimationFrame(frame);
    }

    if (hash.startsWith('#place-')) {
      const placeId = decodeURIComponent(hash.slice(7));
      const place = (trip.places ?? []).find((p) => p.id === placeId);
      if (place) {
        if (place.dayId && days.some((d) => d.id === place.dayId)) {
          setSelectedDayId(place.dayId);
        }
        setActivePlaceId(place.id);
      }
      const frame = requestAnimationFrame(() => {
        const el = document.getElementById(`place-${placeId}`);
        if (el) {
          el.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
          });
          el.classList.add('place-item-highlight');
          setTimeout(() => el.classList.remove('place-item-highlight'), 2200);
        }
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [location.hash, days, trip.places]);

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
      description: p.description ?? '',
      notes: p.notes ?? '',
    });
    setOpen(true);
  };

  const addDay = async () => {
    const base = trip.startDate ? new Date(trip.startDate) : new Date();
    const date = new Date(base);
    date.setDate(base.getDate() + days.length);
    await apiPost(`/trips/${trip.id}/days`, { date: date.toISOString() });
    await reload();
  };

  const save = async () => {
    setBusy(true);
    try {
      const payload = {
        name: editing.name.trim(),
        category: editing.category || undefined,
        address: editing.address || undefined,
        lat: editing.lat ? Number(editing.lat) : null,
        lng: editing.lng ? Number(editing.lng) : null,
        website: editing.website || undefined,
        description: editing.description || undefined,
        notes: editing.notes || undefined,
        dayId: editing.dayId || undefined,
      };
      if (editingId) {
        await apiPatch(`/trips/${trip.id}/places/${editingId}`, payload);
      } else if (editing.name.trim()) {
        await apiPost(`/trips/${trip.id}/places`, payload);
      }
      setOpen(false);
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const reorder = async (placeId: string, targetDayId: string, targetIndex: number) => {
    let sourcePlace: Place | undefined;
    let sourceDayId: string | null = null;

    for (const d of days) {
      const found = d.places.find((p) => p.id === placeId);
      if (found) {
        sourcePlace = found;
        sourceDayId = d.id;
        break;
      }
    }
    if (!sourcePlace) {
      sourcePlace = orphanPlaces.find((p) => p.id === placeId);
      sourceDayId = null;
    }
    if (!sourcePlace) return;

    const targetDay = days.find((d) => d.id === targetDayId);
    const targetPlaces = [...(targetDay?.places ?? [])].filter((p) => p.id !== placeId);
    const clampedIndex = Math.max(0, Math.min(targetIndex, targetPlaces.length));

    const updatedPlace = { ...sourcePlace, dayId: targetDayId || null };
    targetPlaces.splice(clampedIndex, 0, updatedPlace);

    const entries: { placeId: string; dayId?: string; sortOrder: number }[] = targetPlaces.map(
      (p, i) => ({ placeId: p.id, dayId: targetDayId || undefined, sortOrder: i }),
    );

    // If moved from a different day, also re-index remaining places in source day
    if (sourceDayId && sourceDayId !== targetDayId) {
      const sourceDay = days.find((d) => d.id === sourceDayId);
      const sourceRemaining = (sourceDay?.places ?? []).filter((p) => p.id !== placeId);
      sourceRemaining.forEach((p, i) => {
        entries.push({ placeId: p.id, dayId: sourceDayId!, sortOrder: i });
      });
    }

    setDragId(null);
    await apiPost(`/trips/${trip.id}/reorder`, { entries });
    await reload();
  };

  const dropOnDay = (dayId: string, index: number) => (e: React.DragEvent) => {
    e.preventDefault();
    const placeId = e.dataTransfer.getData('text/plain') || dragId;
    if (placeId) void reorder(placeId, dayId, index);
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

  const saveDayNotes = async () => {
    if (!dayEditor) return;
    const trimmed = dayEditor.label.trim();
    await apiPatch(`/trips/${trip.id}/days/${dayEditor.id}`, {
      label: trimmed && !isGenericDayLabel(trimmed) ? trimmed : null,
      notes: dayEditor.notes,
    });
    setDayEditor(null);
    await reload();
  };

  const saveDayJournal = async () => {
    if (!journalDay || !journalForm.title.trim()) return;
    await apiPost(`/trips/${trip.id}/journal`, {
      title: journalForm.title.trim(),
      body: journalForm.body,
      date: journalDay.date.slice(0, 10),
    });
    setJournalDay(null);
    setJournalForm({ title: '', body: '' });
    await reload();
  };

  const setCalendarVisibility = async (place: Place, includeInCalendar: boolean) => {
    await apiPatch(`/trips/${trip.id}/places/${place.id}`, { includeInCalendar });
    await reload();
  };

  const handlePlaceClick = (p: Place) => {
    setActivePlaceId(p.id);
    if (p.dayId && selectedDayId && p.dayId !== selectedDayId) {
      setSelectedDayId(p.dayId);
    }
    if (viewMode === 'full') {
      navigate(`${location.pathname}?tab=map&focus=${p.id}`);
    }
  };

  // Use one trip-wide sequence so every map marker has a unique number.
  const displayedMapPlaces = useMemo<PlaceWithStop[]>(() => {
    const result: PlaceWithStop[] = [];
    let stopNumber = 1;
    for (const day of days) {
      day.places.forEach((place) => {
        result.push({ ...place, stopNumber });
        stopNumber += 1;
      });
    }
    orphanPlaces.forEach((place) => {
      result.push({ ...place, stopNumber });
      stopNumber += 1;
    });
    return selectedDayId
      ? selectedDayId === 'unassigned'
        ? result.filter((place) => !place.dayId)
        : result.filter((place) => place.dayId === selectedDayId)
      : result;
  }, [days, selectedDayId, orphanPlaces]);

  const renderPlaceRow = (p: Place, stopNumber?: number) => {
    const hasDetails = Boolean(p.description?.trim() || p.notes?.trim());
    const isExpanded = expandedPlaceIds.has(p.id);

    const locationText = p.address?.trim()
      ? p.address.trim()
      : p.lat != null && p.lng != null
      ? `${p.lat.toFixed(3)}, ${p.lng.toFixed(3)}`
      : null;

    const formattedTime = p.startTime
      ? new Date(p.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : null;

    const categoryText = p.category?.trim() || null;
    const hasMeta = Boolean(locationText || categoryText || formattedTime);

    return (
      <div
        key={p.id}
        className="place-item-wrap"
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const movingId = dragId || e.dataTransfer.getData('text/plain');
          if (movingId && p.dayId) {
            void reorder(movingId, p.dayId, Math.max(0, (stopNumber ?? 1) - 1));
          }
        }}
      >
        <div
          id={`place-${p.id}`}
          className={`place-card-compact ${dragId === p.id ? 'dragging' : ''} ${activePlaceId === p.id ? 'active-highlight' : ''} ${isExpanded ? 'active-row' : ''}`}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('text/plain', p.id);
            e.dataTransfer.effectAllowed = 'move';
            setDragId(p.id);
          }}
          onDragEnd={() => setDragId(null)}
          onClick={() => {
            setActivePlaceId(p.id);
            if (p.dayId && selectedDayId && p.dayId !== selectedDayId) {
              setSelectedDayId(p.dayId);
            }
          }}
        >
          {/* Left: Drag grip & Stop number */}
          <div className="place-card-gutter">
            <GripVertical size={13} className="muted grip-handle" style={{ cursor: 'grab' }} />
            {stopNumber != null ? (
              <span className="stop-number-badge" title={`Stop #${stopNumber} • ${p.category || 'Place'}`}>
                {stopNumber}
              </span>
            ) : (
              <span className="place-type-icon-badge" title={p.category || 'Place'}>
                {getCategoryIcon(p.category, p.name)}
              </span>
            )}
          </div>

          {/* Center/Main: Title + Meta */}
          <div className="place-card-main">
            <div className="place-card-top">
              <div
                className="place-title-group"
                onClick={(e) => {
                  e.stopPropagation();
                  setActivePlaceId(p.id);
                  if (p.dayId && selectedDayId && p.dayId !== selectedDayId) {
                    setSelectedDayId(p.dayId);
                  }
                  toggleExpand(p.id);
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.stopPropagation();
                    setActivePlaceId(p.id);
                    if (p.dayId && selectedDayId && p.dayId !== selectedDayId) {
                      setSelectedDayId(p.dayId);
                    }
                    toggleExpand(p.id);
                  }
                }}
                title={hasDetails ? 'Click to toggle full description' : undefined}
              >
                <span className="place-type-inline-icon" title={p.category || 'Place'}>
                  {getCategoryIcon(p.category, p.name)}
                </span>
                <span className="place-title">{p.name}</span>
                {p.website && (
                  <a
                    href={p.website}
                    target="_blank"
                    rel="noreferrer"
                    className="website-ext-link"
                    onClick={(e) => e.stopPropagation()}
                    title="Open official website"
                  >
                    ↗
                  </a>
                )}
                {hasDetails && (
                  <span className="title-detail-badge">
                    {isExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                    <span>{isExpanded ? 'Hide' : 'Details'}</span>
                  </span>
                )}
              </div>

              {/* Right: Sleek, compact action icons */}
              <div className="place-card-actions" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className="place-action-btn"
                  title="Show on map"
                  onClick={() => handlePlaceClick(p)}
                >
                  <MapIcon size={13} />
                </button>
                {p.sourceText && (
                  <button
                    type="button"
                    className="place-action-btn"
                    title="View source confirmation text"
                    onClick={() => setSourcePlace(p)}
                  >
                    <FileText size={13} />
                  </button>
                )}
                <button
                  type="button"
                  className={`place-action-btn ${p.includeInCalendar === false ? 'place-action-inactive' : ''}`}
                  title={p.includeInCalendar !== false ? 'Included in trip calendar' : 'Hidden from trip calendar'}
                  aria-label={p.includeInCalendar !== false ? `Hide ${p.name} from trip calendar` : `Include ${p.name} in trip calendar`}
                  onClick={() => void setCalendarVisibility(p, p.includeInCalendar === false)}
                >
                  {p.includeInCalendar !== false ? <CalendarCheck size={13} /> : <CalendarX size={13} />}
                </button>
                <button
                  type="button"
                  className="place-action-btn"
                  title="Edit place"
                  onClick={() => openEdit(p)}
                >
                  <Pencil size={13} />
                </button>
                <button
                  type="button"
                  className="place-action-btn danger"
                  title="Remove place"
                  onClick={() => void removePlace(p)}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>

            {/* Meta tags: Time, Category, Location */}
            {hasMeta && (
              <div className="place-card-meta">
                {formattedTime && (
                  <span className="place-meta-pill time">
                    <Clock size={11} /> {formattedTime}
                  </span>
                )}
                {categoryText && (
                  <span className="place-meta-pill category">
                    <span style={{ marginRight: 3 }}>{getCategoryIcon(categoryText, p.name)}</span>
                    {categoryText}
                  </span>
                )}
                {locationText && (
                  <span className="place-meta-pill location" title={locationText}>
                    <MapPin size={11} />
                    <span className="place-location-text">{locationText}</span>
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Expanded Description / Notes */}
        {isExpanded && (
          <div className="place-expanded-card">
            {p.description?.trim() ? (
              <div className="place-expanded-section">
                <div className="place-expanded-label">Full Description</div>
                <div className="place-expanded-text">{p.description}</div>
              </div>
            ) : null}
            {p.notes?.trim() ? (
              <div className="place-expanded-section">
                <div className="place-expanded-label">Notes</div>
                <div className="place-expanded-text">✏️ {p.notes}</div>
              </div>
            ) : null}
            {!p.description?.trim() && !p.notes?.trim() && (
              <div className="small muted">
                No description or notes yet.{' '}
                <button
                  type="button"
                  className="btn xs link"
                  onClick={(e) => {
                    e.stopPropagation();
                    openEdit(p);
                  }}
                >
                  Add details
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

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
          {/* Active Focus Header Banner */}
          {selectedDayId && (
            <div className="itinerary-focus-banner">
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <span className="focus-indicator-badge">🎯 In Focus</span>
                <span>
                  {selectedDayId === 'unassigned' ? (
                    <b>Viewing Unassigned Places & Ideas only</b>
                  ) : (
                    (() => {
                      const d = days.find((item) => item.id === selectedDayId);
                      const idx = days.findIndex((item) => item.id === selectedDayId) + 1;
                      const customTitle = d?.label && !isGenericDayLabel(d.label) ? `: ${d.label}` : '';
                      return (
                        <b>
                          Viewing Day {idx} ({d ? new Date(d.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : ''}{customTitle})
                        </b>
                      );
                    })()
                  )}
                </span>
              </div>
              <button
                type="button"
                className="btn sm ghost"
                style={{ padding: '2px 8px', fontSize: '0.78rem' }}
                onClick={() => setSelectedDayId(null)}
                title="Clear focus and view all days"
              >
                Show All Days ✕
              </button>
            </div>
          )}

          {days.length === 0 && (
            <div className="empty-state">
              <div className="big">No days yet</div>
              <p>Add days matching your trip dates, then place activities on each day.</p>
              <button type="button" className="btn primary mt" onClick={() => void addDay()}>
                <Plus size={14} /> Add Day 1
              </button>
            </div>
          )}

          {days.map((day, dayIndex) => {
            const isFocused = selectedDayId === day.id;
            return (
              <div
                className={`panel day-panel ${isFocused ? 'day-panel-focused' : ''}`}
                key={day.id}
                id={`day-${day.id}`}
                style={{ scrollMarginTop: 16, marginBottom: 18 }}
              >
                <div className="row between day-header">
                  <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                    <span className="badge accent">
                      {new Date(day.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                    </span>
                    <b>Day {dayIndex + 1}</b>
                    {!isGenericDayLabel(day.label) && (
                      <span className="day-custom-label" style={{ fontWeight: 600, color: 'var(--text)' }}>
                        : {day.label}
                      </span>
                    )}
                    {isFocused && (
                      <span className="focus-indicator-badge">🎯 In Focus</span>
                    )}
                    <button
                      type="button"
                      className="btn xs ghost muted-hover"
                      title="Rename day or edit notes"
                      onClick={() => {
                        const customTitle = isGenericDayLabel(day.label) ? '' : (day.label ?? '');
                        setDayEditor({ id: day.id, label: customTitle, notes: day.notes || '', dayNumber: dayIndex + 1 });
                      }}
                      style={{ padding: '2px 4px' }}
                    >
                      <Pencil size={12} />
                    </button>
                    <span className="day-stop-count small muted">({day.places.length} stops)</span>
                  </div>
                  <div className="row">
                    <button
                      type="button"
                      className="btn sm ghost"
                      title="Edit day notes"
                      onClick={() => {
                        const customTitle = isGenericDayLabel(day.label) ? '' : (day.label ?? '');
                        setDayEditor({ id: day.id, label: customTitle, notes: day.notes || '', dayNumber: dayIndex + 1 });
                      }}
                    >
                      <NotebookPen size={13} /> Notes
                    </button>
                    <button
                      type="button"
                      className="btn sm ghost"
                      title="Add journal entry for this day"
                      onClick={() => {
                        const customTitle = !isGenericDayLabel(day.label) ? `: ${day.label}` : '';
                        setJournalDay({ date: day.date, label: `Day ${dayIndex + 1}${customTitle}` });
                        setJournalForm({ title: '', body: '' });
                      }}
                    >
                      <BookOpen size={13} /> Journal
                    </button>
                    <button
                      type="button"
                      className={`btn sm ${isFocused ? 'primary' : 'ghost'}`}
                      title="Focus this day on the map"
                      onClick={() => {
                        setActivePlaceId(null);
                        setSelectedDayId(isFocused ? null : day.id);
                      }}
                    >
                      <Navigation size={13} />
                      <span>{isFocused ? '🎯 Focused' : 'Focus day'}</span>
                    </button>
                    <button type="button" className="btn sm ghost" onClick={() => openNew(day.id)}>
                      <Plus size={14} /> Add
                    </button>
                    <button type="button" className="btn sm ghost danger" onClick={() => removeDay(day.id)} title="Delete day">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

              {day.notes && <div className="small mt mb" style={{ whiteSpace: 'pre-wrap' }}><NotebookPen size={12} style={{ verticalAlign: -2 }} /> {day.notes}</div>}

              {day.places.length === 0 ? (
                <div
                  className="small muted mt mb"
                  style={{
                    minHeight: 48,
                    border: '1px dashed var(--border)',
                    borderRadius: 8,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '8px 12px',
                    background: dragId ? 'rgba(34, 211, 238, 0.08)' : 'transparent',
                    transition: 'background 0.15s ease',
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    dropOnDay(day.id, 0)(e);
                  }}
                >
                  Nothing planned this day yet. Drag items here to schedule.
                </div>
              ) : (
                <div
                  className="day-places-list"
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                  }}
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
                  placeholder={`+ Quick add to ${!isGenericDayLabel(day.label) ? day.label : `Day ${dayIndex + 1}`}…`}
                  biasLat={tripCenter?.lat}
                  biasLng={tripCenter?.lng}
                  onSelect={async (pl) => {
                    await apiPost(`/trips/${trip.id}/places`, {
                      name: pl.name,
                      address: pl.address,
                      category: pl.category,
                      lat: pl.lat,
                      lng: pl.lng,
                      website: pl.website,
                      dayId: day.id,
                    });
                    await reload();
                  }}
                />
              </div>
            </div>
          );
        })}

          {/* Unassigned Places / Ideas Section - Always displayed below the last day */}
          <div
            className={`panel orphan-panel ${selectedDayId === 'unassigned' ? 'orphan-panel-focused' : ''}`}
            id="places-unassigned"
            style={{ scrollMarginTop: 16, marginBottom: 18 }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
            }}
            onDrop={(e) => {
              e.preventDefault();
              const movingId = dragId || e.dataTransfer.getData('text/plain');
              if (movingId) void reorder(movingId, '', orphanPlaces.length);
            }}
          >
            <div className="row between day-header">
              <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                <span className="badge muted">Unassigned</span>
                <b>Places not assigned to a day</b>
                {selectedDayId === 'unassigned' && (
                  <span className="focus-indicator-badge">🎯 In Focus</span>
                )}
                <span className="small muted">({orphanPlaces.length} {orphanPlaces.length === 1 ? 'place' : 'places'})</span>
              </div>
              <div className="row">
                <button
                  type="button"
                  className={`btn sm ${selectedDayId === 'unassigned' ? 'primary' : 'ghost'}`}
                  title="Focus unassigned places on the map"
                  onClick={() => {
                    setActivePlaceId(null);
                    setSelectedDayId(selectedDayId === 'unassigned' ? null : 'unassigned');
                  }}
                >
                  <Navigation size={13} />
                  <span>{selectedDayId === 'unassigned' ? '🎯 Focused' : 'Focus unassigned'}</span>
                </button>
                <button type="button" className="btn sm ghost" onClick={() => openNew('')}>
                  <Plus size={14} /> Add
                </button>
              </div>
            </div>

            {orphanPlaces.length === 0 ? (
              <div
                className="small muted mt mb"
                style={{
                  minHeight: 48,
                  border: '1px dashed var(--border)',
                  borderRadius: 8,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '8px 12px',
                  background: dragId ? 'rgba(34, 211, 238, 0.08)' : 'transparent',
                  transition: 'background 0.15s ease',
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const movingId = dragId || e.dataTransfer.getData('text/plain');
                  if (movingId) void reorder(movingId, '', 0);
                }}
              >
                No unassigned places. Drag places here to unschedule, or use quick add below.
              </div>
            ) : (
              <div className="place-list">
                {orphanPlaces.map((p, idx) => (
                  <div
                    key={p.id}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const movingId = dragId || e.dataTransfer.getData('text/plain');
                      if (movingId) void reorder(movingId, '', idx);
                    }}
                  >
                    {renderPlaceRow(p)}
                  </div>
                ))}
              </div>
            )}

            {/* Quick-add place search bar inside unassigned panel */}
            <div className="day-quick-add mt">
              <PlaceSearchInput
                placeholder="+ Quick add unassigned place or idea…"
                biasLat={tripCenter?.lat}
                biasLng={tripCenter?.lng}
                onSelect={async (pl) => {
                  await apiPost(`/trips/${trip.id}/places`, {
                    name: pl.name,
                    address: pl.address,
                    category: pl.category,
                    lat: pl.lat,
                    lng: pl.lng,
                    website: pl.website,
                  });
                  await reload();
                }}
              />
            </div>
          </div>
        </div>

        {/* Right Sticky Map Column in Split View */}
        {viewMode === 'split' && (
          <div className="itinerary-right-pane">
            <div className="itinerary-sticky-map-wrapper">
              <div className="map-pane-header">
                <div className="map-pane-header-left">
                  <MapIcon size={15} className="text-accent" />
                  <span className="map-pane-title">Live Map</span>
                  <span className="badge muted map-stops-badge">
                    {displayedMapPlaces.length} {displayedMapPlaces.length === 1 ? 'stop' : 'stops'}
                  </span>
                </div>

                <div className="map-pane-header-right">
                  <div className="map-day-nav-group">
                    <button
                      type="button"
                      className="map-nav-step-btn"
                      title={selectedDayId ? (selectedDayIndex <= 0 ? 'Show all stops' : 'Previous day') : 'No previous day'}
                      disabled={days.length === 0 || (!selectedDayId && selectedDayIndex === -1)}
                      onClick={handlePrevDay}
                      aria-label="Previous day"
                    >
                      <ChevronLeft size={14} />
                    </button>

                    <select
                      className="map-day-select"
                      value={selectedDayId ?? ''}
                      onChange={(e) => {
                        setActivePlaceId(null);
                        setSelectedDayId(e.target.value || null);
                      }}
                      aria-label="Filter map by day"
                    >
                      <option value="">
                        All Days ({totalPlacesCount} stops)
                      </option>
                      {days.map((d, i) => {
                        const customTitle = !isGenericDayLabel(d.label) ? `: ${d.label}` : '';
                        const dateFormatted = d.date
                          ? ` (${new Date(d.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })})`
                          : '';
                        return (
                          <option key={d.id} value={d.id}>
                            {`Day ${i + 1}${dateFormatted}${customTitle} · ${d.places.length} stop${d.places.length === 1 ? '' : 's'}`}
                          </option>
                        );
                      })}
                      <option value="unassigned">
                        Unassigned ({orphanPlaces.length} stops)
                      </option>
                    </select>

                    <button
                      type="button"
                      className="map-nav-step-btn"
                      title="Next day"
                      disabled={days.length === 0 || selectedDayIndex >= days.length - 1}
                      onClick={handleNextDay}
                      aria-label="Next day"
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>

                  {selectedDayId && (
                    <button
                      type="button"
                      className="map-reset-btn"
                      title="Show all stops on map"
                      onClick={() => {
                        setActivePlaceId(null);
                        setSelectedDayId(null);
                      }}
                    >
                      Show All
                    </button>
                  )}
                </div>
              </div>
              <div className="itinerary-sticky-map-canvas">
                <TripMap
                  places={displayedMapPlaces}
                  destination={trip.destination}
                  fallbackLocation={fallbackLocation}
                  activePlaceId={activePlaceId ?? undefined}
                  tripId={trip.id}
                  days={trip.days}
                  mapViews={trip.mapViews}
                  onMapViewsChange={reload}
                  onMapClick={(pl) => {
                    setEditingId(null);
                    setEditing({
                      ...EMPTY_FORM,
                      dayId: selectedDayId || '',
                      name: pl.name,
                      category: pl.category,
                      address: pl.address,
                      lat: String(pl.lat),
                      lng: String(pl.lng),
                      website: pl.website || '',
                    });
                    setOpen(true);
                  }}
                  onPlaceClick={(id) => {
                    setActivePlaceId(id);
                    const el = document.getElementById(`place-${id}`);
                    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                  }}
                  height="100%"
                />

              </div>
            </div>
          </div>
        )}
      </div>


      {dayEditor && (
        <Modal title={`Day ${dayEditor.dayNumber ?? ''} details${dayEditor.label ? ` — ${dayEditor.label}` : ''}`} onClose={() => setDayEditor(null)}>
          <div className="field">
            <label>Day title / label</label>
            <input
              value={dayEditor.label}
              onChange={(event) => setDayEditor({ ...dayEditor, label: event.target.value })}
              placeholder="e.g. Arrival in Tokyo"
              autoFocus
            />
          </div>
          <div className="field">
            <label>Day notes</label>
            <textarea rows={7} value={dayEditor.notes} onChange={(event) => setDayEditor({ ...dayEditor, notes: event.target.value })} placeholder="General plans, reminders, weather backup, meeting details…" />
          </div>
          <div className="modal-actions">
            <button className="btn" onClick={() => setDayEditor(null)}>Cancel</button>
            <button className="btn primary" onClick={() => void saveDayNotes()}>Save</button>
          </div>
        </Modal>
      )}

      {journalDay && (
        <Modal title={`Journal entry — ${journalDay.label}`} onClose={() => setJournalDay(null)}>
          <div className="field">
            <label>Title</label>
            <input value={journalForm.title} onChange={(event) => setJournalForm({ ...journalForm, title: event.target.value })} autoFocus />
          </div>
          <div className="field">
            <label>Entry</label>
            <textarea rows={7} value={journalForm.body} onChange={(event) => setJournalForm({ ...journalForm, body: event.target.value })} />
          </div>
          <div className="modal-actions">
            <button className="btn" onClick={() => setJournalDay(null)}>Cancel</button>
            <button className="btn primary" disabled={!journalForm.title.trim()} onClick={() => void saveDayJournal()}>Save journal entry</button>
          </div>
        </Modal>
      )}

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
              placeholder="Search a place or paste a Google Maps URL…"
              autoFocus={!editingId}
              onSelect={(pl) => {
                setEditing((prev) => ({
                  ...prev,
                  name: pl.name,
                  address: pl.address,
                  category: pl.category,
                  lat: String(pl.lat),
                  lng: String(pl.lng),
                  website: pl.website || prev.website,
                }));
              }}
            />
          </div>

          <div className="field">
            <div className="row between" style={{ marginBottom: 4, alignItems: 'center' }}>
              <label style={{ margin: 0 }}>Title / Place Name</label>
              <button
                type="button"
                className="btn xs ghost ai-suggest-btn"
                onClick={handleSuggestTitle}
                disabled={suggestingTitle || (!editing.name.trim() && !editing.description.trim())}
                title="Use AI to generate a concise, meaningful title and separate description"
              >
                <Sparkles size={13} className={suggestingTitle ? 'spin' : ''} />
                {suggestingTitle ? 'Generating…' : 'AI Suggest Brief Title'}
              </button>
            </div>
            <input
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              placeholder="e.g. Meiji Shrine"
            />
            {editing.name.trim().length > 35 && (
              <div className="field-hint-ai row between" style={{ marginTop: 4 }}>
                <span className="small muted">💡 Title is lengthy ({editing.name.trim().length} chars).</span>
                <button
                  type="button"
                  className="btn xs link"
                  onClick={handleSuggestTitle}
                  disabled={suggestingTitle}
                >
                  ✨ Shorten with AI
                </button>
              </div>
            )}
          </div>

          <div className="field">
            <label>
              Full Description{' '}
              <span className="muted small font-normal">(revealed when title is clicked in itinerary)</span>
            </label>
            <textarea
              rows={3}
              value={editing.description}
              onChange={(e) => setEditing({ ...editing, description: e.target.value })}
              placeholder="Full details, highlights, tour information, schedule, or tips…"
            />
          </div>
          <div className="field small">
            <label>Category</label>
            <select value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })}>
              <option value="">Auto-infer with AI / keywords</option>
              <option value="Sightseeing">🏛 Sightseeing</option>
              <option value="Restaurant">🍽 Restaurant / Dining</option>
              <option value="Activity">🎟 Activity / Tour</option>
              <option value="Flight">✈ Flight</option>
              <option value="Train">🚆 Train / Rail</option>
              <option value="Transport">🚗 Transport / Rental</option>
              <option value="Accommodation">🛏 Accommodation / Hotel</option>
              <option value="Shopping">🛍 Shopping</option>
              <option value="Nature">🌲 Nature / Beach / Park</option>
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
                    {`Day ${i + 1}${!isGenericDayLabel(d.label) ? `: ${d.label}` : ''} (${new Date(d.date).toLocaleDateString()})`}
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