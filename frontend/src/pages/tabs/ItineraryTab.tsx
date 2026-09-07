import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  Plus, Trash2, MapPin, GripVertical, Map as MapIcon, Pencil, FileText,
  Columns, List, Sparkles, Navigation, NotebookPen, BookOpen, CalendarCheck, CalendarX,
  ChevronDown, ChevronUp, Clock, ChevronLeft, ChevronRight, Calendar, ExternalLink,
  ArrowUp, ArrowDown, CheckSquare, Hotel
} from 'lucide-react';
import { apiPost, apiPatch, apiDelete } from '../../lib/api';
import type { Trip, Place, JournalEntry, Day, TodoItem } from '../../lib/types';
import { Modal, ConfirmModal } from '../../components/Modal';
import { TripMap, type PlaceWithStop } from '../../components/TripMap';
import { PlaceSearchInput } from '../../components/PlaceSearchInput';
import { TravelEstimate } from '../../components/TravelEstimate';
import { getCategoryIcon } from '../../lib/icons';
import { computePlaceStopNumberMap, cleanPlaceOrStayTitle, resolveDayLocation, isAccommodationItem } from '../../lib/placeUtils';
import { AuditBadge } from '../../components/AuditBadge';
import { JournalEntryModal } from '../../components/JournalEntryModal';
import { DayTodoModal } from '../../components/DayTodoModal';
import { BookingModal } from '../../components/BookingModal';
import {
  generateSpanId,
  extractSpanId,
  embedSpanId,
  stripSpanId,
  findSpannedPlaces,
  getConsecutiveDays,
} from '../../lib/spanUtils';
import { renderTextWithLinks, isUrl, formatUrl } from '../../lib/linkUtils';

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
  startTime: string;
  endTime: string;
  spanDays?: number;
}

const EMPTY_FORM: PlaceForm = {
  dayId: '',
  name: '',
  category: '',
  address: '',
  lat: '',
  lng: '',
  website: '',
  description: '',
  notes: '',
  startTime: '',
  endTime: '',
  spanDays: 1,
};

export function extractTimeHHMM(isoOrTime?: string | null): string {
  if (!isoOrTime) return '';
  const match = isoOrTime.match(/T(\d{2}):(\d{2})/);
  if (match) return `${match[1]}:${match[2]}`;
  const tMatch = isoOrTime.match(/^(\d{1,2}):(\d{2})\s*([AP]M)?$/i);
  if (tMatch) {
    let h = parseInt(tMatch[1], 10);
    const m = tMatch[2];
    const ampm = tMatch[3]?.toUpperCase();
    if (ampm === 'PM' && h < 12) h += 12;
    if (ampm === 'AM' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${m}`;
  }
  return '';
}

export function formatPlaceTime(startTime?: string | null, endTime?: string | null): string | null {
  if (!startTime) return null;

  const parseTime = (isoOrTime: string): string => {
    const isoMatch = isoOrTime.match(/T(\d{2}):(\d{2})/);
    if (isoMatch) {
      const h = parseInt(isoMatch[1], 10);
      const m = isoMatch[2];
      const ampm = h >= 12 ? 'PM' : 'AM';
      const h12 = h % 12 || 12;
      return `${h12}:${m} ${ampm}`;
    }
    const tMatch = isoOrTime.match(/^(\d{1,2}):(\d{2})\s*([AP]M)?$/i);
    if (tMatch) {
      let h = parseInt(tMatch[1], 10);
      const m = tMatch[2];
      const ampm = tMatch[3] ? tMatch[3].toUpperCase() : h >= 12 ? 'PM' : 'AM';
      const h12 = h % 12 || 12;
      return `${h12}:${m} ${ampm}`;
    }
    try {
      const d = new Date(isoOrTime);
      if (!Number.isNaN(d.getTime())) {
        const h = d.getUTCHours();
        const m = String(d.getUTCMinutes()).padStart(2, '0');
        const ampm = h >= 12 ? 'PM' : 'AM';
        const h12 = h % 12 || 12;
        return `${h12}:${m} ${ampm}`;
      }
    } catch {
      // ignore
    }
    return isoOrTime;
  };

  const startFormatted = parseTime(startTime);
  if (!endTime) return startFormatted;
  const endFormatted = parseTime(endTime);
  if (startFormatted === endFormatted) return startFormatted;
  return `${startFormatted} – ${endFormatted}`;
}

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
  const [editingPlaceItem, setEditingPlaceItem] = useState<Place | null>(null);
  const [updateAllInSeries, setUpdateAllInSeries] = useState(false);
  const [editing, setEditing] = useState<PlaceForm>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [expandedPlaceIds, setExpandedPlaceIds] = useState<Set<string>>(new Set());
  const [sourcePlace, setSourcePlace] = useState<Place | null>(null);
  const [dayEditor, setDayEditor] = useState<{
    id: string;
    label: string;
    notes: string;
    noteUrl?: string;
    location?: string;
    lat?: number | null;
    lng?: number | null;
    defaultLocation?: string;
    dayNumber?: number;
    spanDays?: number;
    activeTargetKey?: string;
    placeNotesMap?: Record<string, string>;
    placeUrlsMap?: Record<string, string>;
  } | null>(null);
  const [journalModalState, setJournalModalState] = useState<{
    open: boolean;
    entry?: { id?: string; title: string; body: string; date?: string };
    dayEntries?: JournalEntry[];
    dayLabel?: string;
  }>({ open: false });
  const [dayTodoModalState, setDayTodoModalState] = useState<{
    day: Day;
    dayIndex: number;
  } | null>(null);
  const [deletingJournalId, setDeletingJournalId] = useState<string | null>(null);
  const [deletingPlace, setDeletingPlace] = useState<Place | null>(null);
  const [deletingDayId, setDeletingDayId] = useState<string | null>(null);
  const [addDropdownDayId, setAddDropdownDayId] = useState<string | null>(null);
  const [bookingModalDayState, setBookingModalDayState] = useState<{ startAt: string; endAt: string } | null>(null);
  const [pendingReorder, setPendingReorder] = useState<{
    sourcePlace: Place;
    sourceDayId: string | null;
    targetDayId: string;
    targetIndex: number;
    siblingPlaces: Place[];
  } | null>(null);

  const toggleExpand = (placeId: string) => {
    setExpandedPlaceIds((prev) => {
      const next = new Set(prev);
      if (next.has(placeId)) next.delete(placeId);
      else next.add(placeId);
      return next;
    });
  };

  // Wanderlog Split View State
  const [viewMode, setViewMode] = useState<'split' | 'full'>(() => {
    return window.innerWidth >= 1024 ? 'split' : 'full';
  });
  const [mobileTab, setMobileTab] = useState<'list' | 'map'>('list');
  const [activePlaceId, setActivePlaceId] = useState<string | null>(null);
  const [selectedDayId, setSelectedDayId] = useState<string | null>(null);

  const days = useMemo(() => trip.days ?? [], [trip.days]);
  const allPlaces = useMemo(() => trip.places ?? [], [trip.places]);
  const orphanPlaces = useMemo(
    () => allPlaces.filter((p) => !days.some((d) => d.places.some((x) => x.id === p.id))),
    [allPlaces, days],
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

  // Close day add menu when clicking outside
  useEffect(() => {
    if (!addDropdownDayId) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest('.day-add-dropdown-container')) {
        setAddDropdownDayId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [addDropdownDayId]);

  // When a day has no locations on the map, resolve the day's fallback location using the priority cascade.
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

    const resolved = resolveDayLocation(currentIndex, sortedDays, trip.destination);
    if (resolved.lat != null && resolved.lng != null) {
      return {
        coord: { lat: resolved.lat, lng: resolved.lng },
        name: resolved.name,
        address: resolved.address || resolved.name,
      };
    }
    if (resolved.name) {
      return {
        name: resolved.name,
        address: resolved.address || resolved.name,
      };
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
    setEditingPlaceItem(null);
    setUpdateAllInSeries(false);
    setEditing({ ...EMPTY_FORM, dayId, spanDays: 1 });
    setOpen(true);
  };

  const openEdit = (p: Place) => {
    setEditingId(p.id);
    setEditingPlaceItem(p);
    const siblingPlaces = findSpannedPlaces(p, allPlaces, days);
    setUpdateAllInSeries(siblingPlaces.length > 1);
    setEditing({
      dayId: p.dayId ?? '',
      name: cleanPlaceOrStayTitle(p.name),
      category: p.category ?? '',
      address: p.address ?? '',
      lat: p.lat != null ? String(p.lat) : '',
      lng: p.lng != null ? String(p.lng) : '',
      website: p.website ?? '',
      description: p.description ?? '',
      notes: stripSpanId(p.notes),
      startTime: extractTimeHHMM(p.startTime),
      endTime: extractTimeHHMM(p.endTime),
      spanDays: 1,
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
      let finalStartTime: string | null = null;
      let finalEndTime: string | null = null;

      const selectedDay = days.find((d) => d.id === editing.dayId);
      const baseDate = selectedDay?.date
        ? selectedDay.date.slice(0, 10)
        : trip.startDate?.slice(0, 10) || new Date().toISOString().slice(0, 10);

      if (editing.startTime) {
        finalStartTime = `${baseDate}T${editing.startTime}:00.000Z`;
      }
      if (editing.endTime) {
        finalEndTime = `${baseDate}T${editing.endTime}:00.000Z`;
      }

      let latVal: number | null = editing.lat ? Number(editing.lat) : null;
      let lngVal: number | null = editing.lng ? Number(editing.lng) : null;

      // Automatically parse lat, lng coordinates if entered in the address field
      if (editing.address?.trim()) {
        const coordMatch = editing.address.trim().match(/^(-?\d+(\.\d+)?)\s*,\s*(-?\d+(\.\d+)?)$/);
        if (coordMatch) {
          const parsedLat = Number(coordMatch[1]);
          const parsedLng = Number(coordMatch[3]);
          if (!isNaN(parsedLat) && !isNaN(parsedLng) && parsedLat >= -90 && parsedLat <= 90 && parsedLng >= -180 && parsedLng <= 180) {
            latVal = parsedLat;
            lngVal = parsedLng;
          }
        }
      }

      if (editingId) {
        // If part of multi-day series and user chose to apply changes to all occurrences
        if (updateAllInSeries && editingPlaceItem) {
          const siblingPlaces = findSpannedPlaces(editingPlaceItem, allPlaces, days);
          if (siblingPlaces.length > 1) {
            const existingSpanId = extractSpanId(editingPlaceItem) || generateSpanId();
            const taggedNotes = embedSpanId(editing.notes, existingSpanId);
            await Promise.all(
              siblingPlaces.map((sibling) => {
                const siblingDay = days.find((d) => d.id === sibling.dayId);
                const sBaseDate = siblingDay?.date ? siblingDay.date.slice(0, 10) : baseDate;
                const sStartTime = editing.startTime ? `${sBaseDate}T${editing.startTime}:00.000Z` : null;
                const sEndTime = editing.endTime ? `${sBaseDate}T${editing.endTime}:00.000Z` : null;
                return apiPatch(`/trips/${trip.id}/places/${sibling.id}`, {
                  name: editing.name.trim(),
                  category: editing.category || undefined,
                  address: editing.address || undefined,
                  lat: latVal,
                  lng: lngVal,
                  website: editing.website || undefined,
                  description: editing.description || undefined,
                  notes: taggedNotes,
                  startTime: sStartTime,
                  endTime: sEndTime,
                });
              }),
            );
          } else {
            const payload = {
              name: editing.name.trim(),
              category: editing.category || undefined,
              address: editing.address || undefined,
              lat: latVal,
              lng: lngVal,
              website: editing.website || undefined,
              description: editing.description || undefined,
              notes: editing.notes || undefined,
              dayId: editing.dayId ? editing.dayId : null,
              startTime: finalStartTime,
              endTime: finalEndTime,
            };
            await apiPatch(`/trips/${trip.id}/places/${editingId}`, payload);
          }
        } else {
          const payload = {
            name: editing.name.trim(),
            category: editing.category || undefined,
            address: editing.address || undefined,
            lat: latVal,
            lng: lngVal,
            website: editing.website || undefined,
            description: editing.description || undefined,
            notes: editing.notes || undefined,
            dayId: editing.dayId ? editing.dayId : null,
            startTime: finalStartTime,
            endTime: finalEndTime,
          };
          await apiPatch(`/trips/${trip.id}/places/${editingId}`, payload);
        }
      } else if (editing.name.trim()) {
        const spanDays = editing.spanDays ?? 1;
        if (spanDays > 1 && editing.dayId && editing.dayId !== 'unassigned') {
          const targetDays = getConsecutiveDays(editing.dayId, spanDays, days);
          const spanId = generateSpanId();
          const taggedNotes = embedSpanId(editing.notes, spanId);
          const isAccom = isAccommodationItem(editing);
          const placesPayload = targetDays.map((targetDay, idx) => {
            let dayStartTime: string | null = null;
            let dayEndTime: string | null = null;
            const targetBaseDate = targetDay.date ? targetDay.date.slice(0, 10) : baseDate;
            if (isAccom && targetDays.length > 1) {
              if (idx === 0) {
                // Check-in day: starts at check-in time (e.g. 15:00 / 3 PM)
                if (editing.startTime) dayStartTime = `${targetBaseDate}T${editing.startTime}:00.000Z`;
              } else if (idx === targetDays.length - 1) {
                // Checkout day: ends at check-out time (e.g. 10:00 / 10 AM)
                if (editing.endTime) dayEndTime = `${targetBaseDate}T${editing.endTime}:00.000Z`;
              }
            } else {
              if (editing.startTime) {
                dayStartTime = `${targetBaseDate}T${editing.startTime}:00.000Z`;
              }
              if (editing.endTime) {
                dayEndTime = `${targetBaseDate}T${editing.endTime}:00.000Z`;
              }
            }
            return {
              name: editing.name.trim(),
              category: editing.category || undefined,
              address: editing.address || undefined,
              lat: latVal,
              lng: lngVal,
              website: editing.website || undefined,
              description: editing.description || undefined,
              notes: taggedNotes || undefined,
              dayId: targetDay.id,
              sortOrder: (targetDay.places?.length ?? 0) + idx,
              startTime: dayStartTime,
              endTime: dayEndTime,
            };
          });
          await apiPost(`/trips/${trip.id}/places/bulk`, { places: placesPayload });
        } else {
          const payload = {
            name: editing.name.trim(),
            category: editing.category || undefined,
            address: editing.address || undefined,
            lat: latVal,
            lng: lngVal,
            website: editing.website || undefined,
            description: editing.description || undefined,
            notes: editing.notes || undefined,
            dayId: editing.dayId ? editing.dayId : null,
            startTime: finalStartTime,
            endTime: finalEndTime,
          };
          await apiPost(`/trips/${trip.id}/places`, payload);
        }
      }
      setOpen(false);
      await reload();
    } finally {
      setBusy(false);
    }
  };

  const executeReorderSingle = async (
    sourcePlace: Place,
    sourceDayId: string | null,
    targetDayId: string,
    targetIndex: number,
  ) => {
    const targetIsUnassigned = !targetDayId || targetDayId === 'unassigned';
    const targetPlaces = targetIsUnassigned
      ? [...orphanPlaces].filter((p) => p.id !== sourcePlace.id)
      : [...(days.find((d) => d.id === targetDayId)?.places ?? [])].filter((p) => p.id !== sourcePlace.id);
    const clampedIndex = Math.max(0, Math.min(targetIndex, targetPlaces.length));

    const updatedPlace = { ...sourcePlace, dayId: targetIsUnassigned ? null : targetDayId };
    targetPlaces.splice(clampedIndex, 0, updatedPlace);

    const entries: { placeId: string; dayId: string | null; sortOrder: number }[] = targetPlaces.map(
      (p, i) => ({ placeId: p.id, dayId: targetIsUnassigned ? null : targetDayId, sortOrder: i }),
    );

    // If moved from a different day, also re-index remaining places in source day
    if (sourceDayId && sourceDayId !== (targetIsUnassigned ? null : targetDayId)) {
      const sourceDay = days.find((d) => d.id === sourceDayId);
      const sourceRemaining = (sourceDay?.places ?? []).filter((p) => p.id !== sourcePlace.id);
      sourceRemaining.forEach((p, i) => {
        entries.push({ placeId: p.id, dayId: sourceDayId, sortOrder: i });
      });
    }

    setPendingReorder(null);
    setDragId(null);
    await apiPost(`/trips/${trip.id}/reorder`, { entries });
    await reload();
  };

  const executeReorderSeries = async (
    sourcePlace: Place,
    sourceDayId: string | null,
    targetDayId: string,
    targetIndex: number,
    siblingPlaces: Place[],
  ) => {
    const isSameDay = sourceDayId === targetDayId;
    const targetIsUnassigned = !targetDayId || targetDayId === 'unassigned';

    const sortedDays = [...days].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime() || a.sortOrder - b.sortOrder
    );

    const entries: { placeId: string; dayId: string | null; sortOrder: number }[] = [];

    if (isSameDay || targetIsUnassigned) {
      // 1. Same-day reordering: shift position within day for this place and its siblings
      const sourcePlaces = [...(days.find((d) => d.id === sourceDayId)?.places ?? [])].filter(
        (p) => p.id !== sourcePlace.id
      );
      const clampedIndex = Math.max(0, Math.min(targetIndex, sourcePlaces.length));
      sourcePlaces.splice(clampedIndex, 0, { ...sourcePlace, dayId: sourceDayId });
      sourcePlaces.forEach((p, i) => {
        entries.push({ placeId: p.id, dayId: sourceDayId, sortOrder: i });
      });

      for (const sibling of siblingPlaces) {
        if (sibling.id === sourcePlace.id || !sibling.dayId) continue;
        const sibDay = days.find((d) => d.id === sibling.dayId);
        if (!sibDay) continue;
        const sibPlaces = [...(sibDay.places ?? [])].filter((p) => p.id !== sibling.id);
        const sibClamped = Math.max(0, Math.min(clampedIndex, sibPlaces.length));
        sibPlaces.splice(sibClamped, 0, { ...sibling, dayId: sibling.dayId });
        sibPlaces.forEach((p, i) => {
          entries.push({ placeId: p.id, dayId: sibling.dayId ?? null, sortOrder: i });
        });
      }
    } else {
      // 2. Across-day move (e.g. Day 1 -> Day 3)
      const sourceDayIdx = sortedDays.findIndex((d) => d.id === sourceDayId);
      const targetDayIdx = sortedDays.findIndex((d) => d.id === targetDayId);
      const deltaDays = sourceDayIdx !== -1 && targetDayIdx !== -1 ? targetDayIdx - sourceDayIdx : 0;

      const dayPlacesMap = new Map<string, Place[]>();
      for (const d of sortedDays) {
        const nonSeriesPlaces = (d.places ?? []).filter(
          (p) => !siblingPlaces.some((s) => s.id === p.id)
        );
        dayPlacesMap.set(d.id, nonSeriesPlaces);
      }

      for (const sibling of siblingPlaces) {
        const curSibDayIdx = sortedDays.findIndex((d) => d.id === sibling.dayId);
        let newSibDayIdx = curSibDayIdx !== -1 ? curSibDayIdx + deltaDays : targetDayIdx;
        newSibDayIdx = Math.max(0, Math.min(sortedDays.length - 1, newSibDayIdx));
        const targetDay = sortedDays[newSibDayIdx];

        if (targetDay) {
          const list = dayPlacesMap.get(targetDay.id) ?? [];
          const clampedIndex = Math.max(0, Math.min(targetIndex, list.length));
          list.splice(clampedIndex, 0, { ...sibling, dayId: targetDay.id });
          dayPlacesMap.set(targetDay.id, list);
        }
      }

      for (const [dayId, pList] of dayPlacesMap.entries()) {
        pList.forEach((p, i) => {
          entries.push({ placeId: p.id, dayId, sortOrder: i });
        });
      }
    }

    setPendingReorder(null);
    setDragId(null);
    await apiPost(`/trips/${trip.id}/reorder`, { entries });
    await reload();
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

    const siblingPlaces = findSpannedPlaces(sourcePlace, allPlaces, days);
    if (siblingPlaces.length > 1) {
      setPendingReorder({
        sourcePlace,
        sourceDayId,
        targetDayId,
        targetIndex,
        siblingPlaces,
      });
      return;
    }

    await executeReorderSingle(sourcePlace, sourceDayId, targetDayId, targetIndex);
  };

  const dropOnDay = (dayId: string, index: number) => (e: React.DragEvent) => {
    e.preventDefault();
    const placeId = e.dataTransfer.getData('text/plain') || dragId;
    if (placeId) void reorder(placeId, dayId, index);
  };

  const removePlace = (p: Place) => {
    setDeletingPlace(p);
  };

  const removeDay = (dayId: string) => {
    setDeletingDayId(dayId);
  };

  const isItemNote = (p: Place) => {
    const cat = (p.category || '').toLowerCase().trim();
    return cat === 'note' || cat === 'notes';
  };

  const openTripNotes = () => {
    const orphanNotes = orphanPlaces.filter(isItemNote);
    const pNotesMap: Record<string, string> = {};
    const pUrlsMap: Record<string, string> = {};
    orphanNotes.forEach((p: Place) => {
      pNotesMap[p.id] = p.notes || p.description || '';
      pUrlsMap[p.id] = p.website || '';
    });
    setDayEditor({
      id: 'trip',
      label: 'Trip Notes',
      notes: trip.notes || '',
      noteUrl: trip.notesUrl || '',
      location: '',
      defaultLocation: trip.destination || '',
      dayNumber: undefined,
      spanDays: 1,
      activeTargetKey: 'trip',
      placeNotesMap: pNotesMap,
      placeUrlsMap: pUrlsMap,
    });
  };

  const openDayNotes = (day: Day, dayIndex: number) => {
    const customTitle = isGenericDayLabel(day.label) ? '' : (day.label ?? '');
    const pNotesMap: Record<string, string> = {};
    const pUrlsMap: Record<string, string> = {};
    (day.places ?? []).filter(isItemNote).forEach((p: Place) => {
      pNotesMap[p.id] = p.notes || p.description || '';
      pUrlsMap[p.id] = p.website || '';
    });
    const sortedDays = [...days].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime() || a.sortOrder - b.sortOrder,
    );
    const resolved = resolveDayLocation(dayIndex, sortedDays, trip.destination);
    setDayEditor({
      id: day.id,
      label: customTitle,
      notes: day.notes || '',
      noteUrl: day.notesUrl || '',
      location: day.location || '',
      lat: day.lat,
      lng: day.lng,
      defaultLocation: resolved.name || trip.destination || '',
      dayNumber: dayIndex + 1,
      spanDays: 1,
      activeTargetKey: 'day',
      placeNotesMap: pNotesMap,
      placeUrlsMap: pUrlsMap,
    });
  };

  const openDayJournals = (day: Day, dayIndex: number) => {
    const customTitle = !isGenericDayLabel(day.label) ? `: ${day.label}` : '';
    const entriesForDay = (trip.journal ?? []).filter((j: JournalEntry) => {
      if (!j.date) return false;
      return j.date.slice(0, 10) === day.date.slice(0, 10);
    });
    const first = entriesForDay.length > 0 ? entriesForDay[0] : undefined;
    setJournalModalState({
      open: true,
      entry: first ? {
        id: first.id,
        title: first.title,
        body: first.body,
        date: first.date ? first.date.slice(0, 10) : day.date.slice(0, 10),
      } : {
        title: '',
        body: '',
        date: day.date.slice(0, 10),
      },
      dayEntries: entriesForDay,
      dayLabel: `Day ${dayIndex + 1}${customTitle}`,
    });
  };

  const openDayTodos = (day: Day, dayIndex: number) => {
    setDayTodoModalState({ day, dayIndex });
  };

  const openAddBookingForDay = (day: Day) => {
    const dStr = day.date ? day.date.slice(0, 10) : new Date().toISOString().slice(0, 10);
    const checkin = `${dStr}T15:00`;
    const nextD = new Date(`${dStr}T00:00:00`);
    nextD.setDate(nextD.getDate() + 1);
    const pad = (n: number) => String(n).padStart(2, '0');
    const checkoutStr = `${nextD.getFullYear()}-${pad(nextD.getMonth() + 1)}-${pad(nextD.getDate())}`;
    const checkout = `${checkoutStr}T10:00`;
    setBookingModalDayState({ startAt: checkin, endAt: checkout });
  };

  const saveDayNotes = async () => {
    if (!dayEditor) return;

    if (dayEditor.id === 'trip') {
      await apiPatch(`/trips/${trip.id}`, {
        notes: dayEditor.notes?.trim() || null,
        notesUrl: dayEditor.noteUrl?.trim() || null,
      });

      if (orphanPlaces) {
        const patchPromises: Promise<unknown>[] = [];
        for (const p of orphanPlaces) {
          const editedPlaceNote = dayEditor.placeNotesMap?.[p.id];
          const editedPlaceUrl = dayEditor.placeUrlsMap?.[p.id];
          if (
            (editedPlaceNote !== undefined && editedPlaceNote !== (p.notes || '')) ||
            (editedPlaceUrl !== undefined && editedPlaceUrl !== (p.website || ''))
          ) {
            patchPromises.push(
              apiPatch(`/trips/${trip.id}/places/${p.id}`, {
                ...(editedPlaceNote !== undefined ? { notes: editedPlaceNote.trim() || null } : {}),
                ...(editedPlaceUrl !== undefined ? { website: editedPlaceUrl.trim() || null } : {}),
              })
            );
          }
        }
        if (patchPromises.length > 0) {
          await Promise.all(patchPromises);
        }
      }

      setDayEditor(null);
      await reload();
      return;
    }

    const trimmed = dayEditor.label.trim();
    const currentSpan = dayEditor.spanDays ?? 1;
    const currentDay = days.find((d) => d.id === dayEditor.id);
    const locationVal = dayEditor.location?.trim() || null;
    const latVal = dayEditor.lat != null ? dayEditor.lat : null;
    const lngVal = dayEditor.lng != null ? dayEditor.lng : null;
    const noteUrlVal = dayEditor.noteUrl?.trim() || null;

    if (currentSpan > 1) {
      const targetDays = getConsecutiveDays(dayEditor.id, currentSpan, days);
      await Promise.all(
        targetDays.map((d) => {
          const isStart = d.id === dayEditor.id;
          return apiPatch(`/trips/${trip.id}/days/${d.id}`, {
            ...(isStart ? { label: trimmed && !isGenericDayLabel(trimmed) ? trimmed : null } : {}),
            notes: dayEditor.notes,
            notesUrl: noteUrlVal,
            location: locationVal,
            lat: latVal,
            lng: lngVal,
          });
        }),
      );
    } else {
      await apiPatch(`/trips/${trip.id}/days/${dayEditor.id}`, {
        label: trimmed && !isGenericDayLabel(trimmed) ? trimmed : null,
        notes: dayEditor.notes,
        notesUrl: noteUrlVal,
        location: locationVal,
        lat: latVal,
        lng: lngVal,
      });
    }

    if (currentDay?.places) {
      const patchPromises: Promise<unknown>[] = [];
      for (const p of currentDay.places) {
        const editedPlaceNote = dayEditor.placeNotesMap?.[p.id];
        const editedPlaceUrl = dayEditor.placeUrlsMap?.[p.id];
        if (
          (editedPlaceNote !== undefined && editedPlaceNote !== (p.notes || '')) ||
          (editedPlaceUrl !== undefined && editedPlaceUrl !== (p.website || ''))
        ) {
          patchPromises.push(
            apiPatch(`/trips/${trip.id}/places/${p.id}`, {
              ...(editedPlaceNote !== undefined ? { notes: editedPlaceNote.trim() || null } : {}),
              ...(editedPlaceUrl !== undefined ? { website: editedPlaceUrl.trim() || null } : {}),
            })
          );
        }
      }
      if (patchPromises.length > 0) {
        await Promise.all(patchPromises);
      }
    }

    setDayEditor(null);
    await reload();
  };

  useEffect(() => {
    const handleOpenDayNotes = (e: Event) => {
      const detail = (e as CustomEvent).detail as { tripId?: string; dayId?: string; dayIndex?: number } | undefined;
      if (!detail) return;
      if (detail.dayId === 'trip' || (!detail.dayId && !days.length)) {
        openTripNotes();
        return;
      }
      const sortedDays = [...days].sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime() || a.sortOrder - b.sortOrder,
      );
      const targetDay = sortedDays.find((d) => d.id === detail.dayId);
      if (targetDay) {
        const dIdx = detail.dayIndex != null ? detail.dayIndex : sortedDays.indexOf(targetDay);
        openDayNotes(targetDay, Math.max(0, dIdx));
      } else if (detail.dayId === 'trip') {
        openTripNotes();
      }
    };
    window.addEventListener('travelapp:open_day_notes', handleOpenDayNotes);
    return () => window.removeEventListener('travelapp:open_day_notes', handleOpenDayNotes);
  }, [days, trip.destination, trip.notes, orphanPlaces]);

  const handleSaveJournalEntry = async (data: { id?: string; title: string; body: string; date?: string }) => {
    const targetId = data.id || journalModalState.entry?.id;
    if (targetId) {
      await apiPatch(`/trips/${trip.id}/journal/${targetId}`, {
        title: data.title,
        body: data.body,
        date: data.date || undefined,
      });
    } else {
      await apiPost(`/trips/${trip.id}/journal`, {
        title: data.title,
        body: data.body,
        date: data.date || undefined,
      });
    }
    setJournalModalState({ open: false });
    await reload();
  };

  const handleRemoveJournal = async (id: string) => {
    await apiDelete(`/trips/${trip.id}/journal/${id}`);
    setDeletingJournalId(null);
    await reload();
  };

  const setCalendarVisibility = async (place: Place, includeInCalendar: boolean) => {
    await apiPatch(`/trips/${trip.id}/places/${place.id}`, { includeInCalendar });
    await reload();
  };

  const handlePlaceClick = (p: Place) => {
    if (activePlaceId === p.id) {
      setActivePlaceId(null);
    } else {
      setActivePlaceId(p.id);
      if (p.dayId && selectedDayId && p.dayId !== selectedDayId) {
        setSelectedDayId(p.dayId);
      }
      if (viewMode === 'full') {
        navigate(`${location.pathname}?tab=map&focus=${p.id}`);
      }
    }
  };

  // Pre-calculate sequential trip-wide numbers so multi-day items at the same location share the same number and map pin.
  const placeStopNumberMap = useMemo(() => {
    return computePlaceStopNumberMap(days, orphanPlaces);
  }, [days, orphanPlaces]);

  // Use one trip-wide sequence so every map marker has a unique number.
  const displayedMapPlaces = useMemo<PlaceWithStop[]>(() => {
    const result: PlaceWithStop[] = [];
    for (const day of days) {
      day.places.forEach((place) => {
        result.push({ ...place, stopNumber: placeStopNumberMap.get(place.id) });
      });
    }
    orphanPlaces.forEach((place) => {
      result.push({ ...place, stopNumber: placeStopNumberMap.get(place.id) });
    });
    return selectedDayId
      ? selectedDayId === 'unassigned'
        ? result.filter((place) => !place.dayId)
        : result.filter((place) => place.dayId === selectedDayId)
      : result;
  }, [days, selectedDayId, orphanPlaces, placeStopNumberMap]);

  const renderPlaceRow = (p: Place, stopNumber?: number, placeIndex?: number, totalInDay?: number) => {
    const hasDetails = Boolean(p.description?.trim() || p.notes?.trim());
    const isExpanded = expandedPlaceIds.has(p.id);

    const locationText = p.address?.trim()
      ? p.address.trim()
      : p.lat != null && p.lng != null
      ? `${p.lat.toFixed(3)}, ${p.lng.toFixed(3)}`
      : null;

    const formattedTime = formatPlaceTime(p.startTime, p.endTime);

    const categoryText = p.category?.trim() || null;
    const siblingPlaces = findSpannedPlaces(p, allPlaces, days);
    const isSpanned = siblingPlaces.length > 1;
    const hasMeta = Boolean(locationText || categoryText || formattedTime || isSpanned);

    const isNote = isItemNote(p);
    const noteUrl = p.website || (isUrl(p.name) ? formatUrl(p.name) : isUrl(p.notes) ? formatUrl(p.notes) : null);

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
          if (movingId) {
            void reorder(movingId, p.dayId || '', Math.max(0, placeIndex ?? 0));
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
                <span className="place-title">{cleanPlaceOrStayTitle(p.name)}</span>
                {noteUrl && (
                  <a
                    href={formatUrl(noteUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="website-ext-link"
                    onClick={(e) => e.stopPropagation()}
                    title={`Open link: ${noteUrl}`}
                  >
                    <ExternalLink size={12} />
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
                {placeIndex != null && (totalInDay ?? 0) > 1 && (
                  <>
                    <button
                      type="button"
                      className="place-action-btn"
                      disabled={placeIndex <= 0}
                      title="Move up"
                      onClick={() => void reorder(p.id, p.dayId || '', placeIndex - 1)}
                    >
                      <ArrowUp size={13} />
                    </button>
                    <button
                      type="button"
                      className="place-action-btn"
                      disabled={placeIndex >= (totalInDay ?? 0) - 1}
                      title="Move down"
                      onClick={() => void reorder(p.id, p.dayId || '', placeIndex + 1)}
                    >
                      <ArrowDown size={13} />
                    </button>
                  </>
                )}
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

            {/* Meta tags: Time, Category, Location, Website, Multi-day */}
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
                {!isNote && (
                  <a
                    href={
                      p.lat && p.lng
                        ? `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`
                        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([p.name, p.address, trip.destination].filter(Boolean).join(', '))}`
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="place-meta-pill location"
                    title="Open in Google Maps in a new tab"
                    onClick={(e) => e.stopPropagation()}
                    style={{ textDecoration: 'none' }}
                  >
                    <MapPin size={11} />
                    <span>Open map</span>
                  </a>
                )}
                {noteUrl && (
                  <a
                    href={formatUrl(noteUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="place-meta-pill location"
                    title={`Open link: ${noteUrl}`}
                    onClick={(e) => e.stopPropagation()}
                    style={{ textDecoration: 'none', color: 'var(--accent)', fontWeight: 600 }}
                  >
                    <ExternalLink size={11} />
                    <span>Open Link ↗</span>
                  </a>
                )}
                {isSpanned && (
                  <span className="place-meta-pill span-badge" title={`Spans across ${siblingPlaces.length} days in this itinerary`}>
                    <Calendar size={11} style={{ marginRight: 3 }} />
                    {siblingPlaces.length} days
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
                <div className="place-expanded-label">
                  {p.category?.toLowerCase() === 'transport' || p.description.includes('Step-by-Step Directions')
                    ? '🧭 Route & Step-by-Step Directions (Offline Ready)'
                    : 'Full Description'}
                </div>
                <div className="place-expanded-text">{renderTextWithLinks(p.description)}</div>
              </div>
            ) : null}
            <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {noteUrl && (
                <a
                  href={formatUrl(noteUrl)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn xs ghost"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink size={12} />
                  <span>Open Link ↗</span>
                </a>
              )}
              {!isNote && (
                <a
                  href={
                    p.lat && p.lng
                      ? `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`
                      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([p.name, p.address, trip.destination].filter(Boolean).join(', '))}`
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn xs ghost"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, textDecoration: 'none' }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <MapPin size={12} />
                  <span>Open in Google Maps ↗</span>
                </a>
              )}
            </div>
            {p.notes?.trim() ? (
              <div className="place-expanded-section">
                <div className="place-expanded-label">Notes</div>
                <div className="place-expanded-text">✏️ {renderTextWithLinks(p.notes)}</div>
              </div>
            ) : null}
            {!p.description?.trim() && !p.notes?.trim() && !noteUrl && (
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
            {(p.createdBy || p.updatedBy) && (
              <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end' }}>
                <AuditBadge createdBy={p.createdBy} createdAt={p.createdAt} updatedBy={p.updatedBy} updatedAt={p.updatedAt} />
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className={`itinerary-page-root ${mobileTab === 'map' ? 'mobile-showing-map' : 'mobile-showing-list'}`}>
      {/* Mobile Sticky Day Carousel Strip (<= 820px) */}
      <div className="mobile-day-strip-wrap">
        <div className="mobile-day-strip">
          <button
            type="button"
            className={`mobile-day-chip ${!selectedDayId ? 'active' : ''}`}
            onClick={() => {
              setSelectedDayId(null);
              setActivePlaceId(null);
            }}
          >
            <span>All Days</span>
            <span className="mobile-day-chip-count">{totalPlacesCount}</span>
          </button>
          {days.map((day, idx) => {
            const isSel = selectedDayId === day.id;
            const dateStr = day.date
              ? new Date(day.date).toLocaleDateString(undefined, { weekday: 'short', month: 'numeric', day: 'numeric' })
              : '';
            return (
              <button
                key={day.id}
                type="button"
                className={`mobile-day-chip ${isSel ? 'active' : ''}`}
                onClick={() => {
                  setSelectedDayId(day.id);
                  setActivePlaceId(null);
                  if (mobileTab === 'list') {
                    const el = document.getElementById(`day-${day.id}`);
                    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }
                }}
              >
                <span>Day {idx + 1}</span>
                {dateStr && <span className="mobile-day-chip-sub">{dateStr}</span>}
                <span className="mobile-day-chip-count">{day.places.length}</span>
              </button>
            );
          })}
          {orphanPlaces.length > 0 && (
            <button
              type="button"
              className={`mobile-day-chip ${selectedDayId === 'unassigned' ? 'active' : ''}`}
              onClick={() => {
                setSelectedDayId('unassigned');
                setActivePlaceId(null);
                if (mobileTab === 'list') {
                  const el = document.getElementById('places-unassigned');
                  el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
              }}
            >
              <span>Ideas</span>
              <span className="mobile-day-chip-count">{orphanPlaces.length}</span>
            </button>
          )}
          <button
            type="button"
            className="mobile-day-chip mobile-day-chip-add"
            onClick={() => void addDay()}
            title="Add next day"
          >
            <Plus size={14} /> Day
          </button>
        </div>
      </div>

      {/* Wanderlog top action bar */}
      <div className="row between mb-2 desktop-action-bar" style={{ marginBottom: 16 }}>
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
          {trip.destination && (
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(trip.destination)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn sm ghost"
              title={`Open ${trip.destination} on Google Maps in a new tab`}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}
            >
              <MapPin size={13} />
              <span>Open map</span>
            </a>
          )}
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

          <div id="trip-notes" />

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
            const dayJournalEntries = (trip.journal ?? []).filter((j: JournalEntry) => {
              if (!j.date) return false;
              return j.date.slice(0, 10) === day.date.slice(0, 10);
            });
            const dayTodos = (trip.todos ?? []).filter((t: TodoItem) => {
              if (!t.dueDate) return false;
              return t.dueDate.slice(0, 10) === day.date.slice(0, 10);
            });
            const dayPlaceNotes = (day.places ?? []).filter(isItemNote);
            const hasDayNotes = Boolean(day.notes?.trim());
            const totalDayNotesCount = (hasDayNotes ? 1 : 0) + dayPlaceNotes.length;
            const resolvedLocation = resolveDayLocation(dayIndex, days, trip.destination);

            return (
              <div
                className={`panel day-panel ${isFocused ? 'day-panel-focused' : ''}`}
                key={day.id}
                id={`day-${day.id}`}
                style={{ scrollMarginTop: 16, marginBottom: 18 }}
              >
                <div className="day-header" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div className="row between" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                    <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                      <b>Day {dayIndex + 1}</b>
                      {!isGenericDayLabel(day.label) && (
                        <span className="day-custom-label" style={{ fontWeight: 600, color: 'var(--text)' }}>
                          : {day.label}
                        </span>
                      )}
                      <button
                        type="button"
                        className="btn xs ghost muted-hover"
                        title="Rename day, set location or edit notes"
                        onClick={() => openDayNotes(day, dayIndex)}
                        style={{ padding: '2px 4px' }}
                      >
                        <Pencil size={12} />
                      </button>
                      <span className="day-stop-count small muted">({day.places.length} stops)</span>
                      {resolvedLocation.name && (
                        <span
                          className="badge"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            fontSize: '0.74rem',
                            fontWeight: 500,
                            padding: '2px 7px',
                            background: resolvedLocation.source === 'explicit' ? 'rgba(56, 189, 248, 0.15)' : 'var(--panel-2)',
                            color: resolvedLocation.source === 'explicit' ? 'var(--accent)' : 'var(--text)',
                            border: '1px solid var(--line)',
                            maxWidth: '220px',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={`Day location (${resolvedLocation.source.replace('_', ' ')}): ${resolvedLocation.name}`}
                        >
                          <MapPin size={11} style={{ flexShrink: 0, color: 'var(--accent)' }} />
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {resolvedLocation.name}
                          </span>
                        </span>
                      )}
                    </div>

                    {/* Date right justified on the right side */}
                    <div style={{ marginLeft: 'auto' }}>
                      <span className="badge accent" style={{ fontWeight: 600 }}>
                        {new Date(day.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                  </div>

                  <div className="row between" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn sm ghost"
                        style={totalDayNotesCount > 0 ? { color: 'var(--accent)' } : undefined}
                        title="Edit day notes"
                        onClick={() => openDayNotes(day, dayIndex)}
                      >
                        <NotebookPen size={13} /> {totalDayNotesCount > 0 ? `Notes(${totalDayNotesCount})` : 'Notes'}
                      </button>
                      <button
                        type="button"
                        className="btn sm ghost"
                        style={dayJournalEntries.length > 0 ? { color: 'var(--accent)' } : undefined}
                        title="Add or view journal entries for this day"
                        onClick={() => openDayJournals(day, dayIndex)}
                      >
                        <BookOpen size={13} /> {dayJournalEntries.length > 0 ? `Journals(${dayJournalEntries.length})` : 'Journals'}
                      </button>
                      <button
                        type="button"
                        className="btn sm ghost"
                        style={dayTodos.length > 0 ? { color: 'var(--accent)' } : undefined}
                        title="Add or view to-do items due on this day"
                        onClick={() => openDayTodos(day, dayIndex)}
                      >
                        <CheckSquare size={13} /> {dayTodos.length > 0 ? `To-Do's(${dayTodos.length})` : "To-Do's"}
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
                    </div>
                    <div className="row" style={{ gap: 6, marginLeft: 'auto', position: 'relative' }}>
                      <div className="day-add-dropdown-container" style={{ position: 'relative' }}>
                        <button
                          type="button"
                          className="btn sm ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            setAddDropdownDayId(addDropdownDayId === day.id ? null : day.id);
                          }}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                          title="Add item, notes, journal, or booking to this day"
                        >
                          <Plus size={14} />
                          <span>Add</span>
                          <ChevronDown size={12} style={{ opacity: 0.7 }} />
                        </button>

                        {addDropdownDayId === day.id && (
                          <div
                            style={{
                              position: 'absolute',
                              top: 'calc(100% + 4px)',
                              right: 0,
                              zIndex: 110,
                              minWidth: '190px',
                              background: 'var(--card-bg, #1a1e29)',
                              border: '1px solid var(--border)',
                              borderRadius: '8px',
                              boxShadow: '0 8px 24px rgba(0,0,0,0.36)',
                              padding: '5px',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '2px',
                            }}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              className="btn sm ghost"
                              style={{
                                width: '100%',
                                justifyContent: 'flex-start',
                                textAlign: 'left',
                                padding: '7px 10px',
                                gap: 8,
                                borderRadius: 6,
                              }}
                              onClick={() => {
                                setAddDropdownDayId(null);
                                openNew(day.id);
                              }}
                            >
                              <MapPin size={14} style={{ color: 'var(--accent)' }} />
                              <span>Place / Activity</span>
                            </button>

                            <button
                              type="button"
                              className="btn sm ghost"
                              style={{
                                width: '100%',
                                justifyContent: 'flex-start',
                                textAlign: 'left',
                                padding: '7px 10px',
                                gap: 8,
                                borderRadius: 6,
                              }}
                              onClick={() => {
                                setAddDropdownDayId(null);
                                openDayNotes(day, dayIndex);
                              }}
                            >
                              <FileText size={14} style={{ color: '#eab308' }} />
                              <span>Day Notes</span>
                            </button>

                            <button
                              type="button"
                              className="btn sm ghost"
                              style={{
                                width: '100%',
                                justifyContent: 'flex-start',
                                textAlign: 'left',
                                padding: '7px 10px',
                                gap: 8,
                                borderRadius: 6,
                              }}
                              onClick={() => {
                                setAddDropdownDayId(null);
                                openDayJournals(day, dayIndex);
                              }}
                            >
                              <BookOpen size={14} style={{ color: '#a855f7' }} />
                              <span>Journal Entry</span>
                            </button>

                            <button
                              type="button"
                              className="btn sm ghost"
                              style={{
                                width: '100%',
                                justifyContent: 'flex-start',
                                textAlign: 'left',
                                padding: '7px 10px',
                                gap: 8,
                                borderRadius: 6,
                              }}
                              onClick={() => {
                                setAddDropdownDayId(null);
                                openAddBookingForDay(day);
                              }}
                            >
                              <Hotel size={14} style={{ color: '#10b981' }} />
                              <span>Booking / Stay</span>
                            </button>
                          </div>
                        )}
                      </div>

                      <button type="button" className="btn sm ghost danger" onClick={() => removeDay(day.id)} title="Delete day">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>



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
                        {renderPlaceRow(p, placeStopNumberMap.get(p.id), pIdx, day.places.length)}
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
                  className="btn sm ghost"
                  onClick={openTripNotes}
                  title="Edit general trip notes not tied to a day"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                >
                  <NotebookPen size={13} />
                  <span>{trip.notes?.trim() ? 'Trip notes' : '+ Trip notes'}</span>
                </button>
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
                    {renderPlaceRow(p, placeStopNumberMap.get(p.id), idx, orphanPlaces.length)}
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
                    setEditingPlaceItem(null);
                    setUpdateAllInSeries(false);
                    const isAccom = isAccommodationItem(pl);
                    const defaultCat = isAccom ? 'Accommodation' : (pl.category || '');
                    setEditing({
                      ...EMPTY_FORM,
                      dayId: selectedDayId || (days.length > 0 ? days[0].id : ''),
                      name: pl.name,
                      category: defaultCat,
                      address: pl.address,
                      lat: String(pl.lat),
                      lng: String(pl.lng),
                      website: pl.website || '',
                      startTime: isAccom ? '15:00' : '',
                      endTime: isAccom ? '10:00' : '',
                      spanDays: isAccom ? 2 : 1,
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


      {dayEditor && (() => {
        const isTripLevel = dayEditor.id === 'trip';
        const currentDay = !isTripLevel ? days.find((d) => d.id === dayEditor.id) : undefined;
        const maxSpan = days.length > 0 ? days.length - (dayEditor.dayNumber ? dayEditor.dayNumber - 1 : 0) : 1;
        const currentSpan = dayEditor.spanDays ?? 1;
        const targetDays = (!isTripLevel && currentSpan > 1) ? getConsecutiveDays(dayEditor.id, currentSpan, days) : [];

        const orphanNotes = (orphanPlaces ?? []).filter(isItemNote);
        const noteTargets = isTripLevel
          ? [
              {
                key: 'trip',
                label: 'Trip Notes',
                subtitle: 'General trip notes & reference',
                type: 'day' as const,
              },
              ...orphanNotes.map((p, idx) => ({
                key: p.id,
                label: p.name || `Note #${idx + 1}`,
                subtitle: p.address || p.category || 'Unassigned note item',
                type: 'place' as const,
                place: p,
              })),
            ]
          : [
              {
                key: 'day',
                label: `Day ${dayEditor.dayNumber || 1} Notes`,
                subtitle: 'Day-level general notes',
                type: 'day' as const,
              },
              ...((currentDay?.places ?? []).filter(isItemNote)).map((p, idx) => ({
                key: p.id,
                label: p.name || `Note #${idx + 1}`,
                subtitle: p.address || p.category || 'Note item',
                type: 'place' as const,
                place: p,
              })),
            ];

        const activeKey = dayEditor.activeTargetKey || (isTripLevel ? 'trip' : 'day');
        const activeIdx = Math.max(0, noteTargets.findIndex((t) => t.key === activeKey));
        const currentTarget = noteTargets[activeIdx] || noteTargets[0];

        const activeNoteText = (activeKey === 'day' || activeKey === 'trip')
          ? dayEditor.notes
          : (dayEditor.placeNotesMap?.[activeKey] ?? '');

        const activeNoteUrl = (activeKey === 'day' || activeKey === 'trip')
          ? (dayEditor.noteUrl ?? '')
          : (dayEditor.placeUrlsMap?.[activeKey] ?? '');

        const updateActiveNoteText = (newText: string) => {
          if (activeKey === 'day' || activeKey === 'trip') {
            setDayEditor({ ...dayEditor, notes: newText });
          } else {
            setDayEditor({
              ...dayEditor,
              placeNotesMap: {
                ...(dayEditor.placeNotesMap || {}),
                [activeKey]: newText,
              },
            });
          }
        };

        const updateActiveNoteUrl = (newUrl: string) => {
          if (activeKey === 'day' || activeKey === 'trip') {
            setDayEditor({ ...dayEditor, noteUrl: newUrl });
          } else {
            setDayEditor({
              ...dayEditor,
              placeUrlsMap: {
                ...(dayEditor.placeUrlsMap || {}),
                [activeKey]: newUrl,
              },
            });
          }
        };

        return (
          <Modal
            title={isTripLevel ? `Trip Notes — ${trip.name}` : `Day ${dayEditor.dayNumber ?? ''} Notes${dayEditor.label ? ` — ${dayEditor.label}` : ''}`}
            onClose={() => setDayEditor(null)}
          >
            {/* Pager if multiple note targets exist */}
            {noteTargets.length > 1 && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 10px',
                  background: 'var(--surface-hover)',
                  borderRadius: '6px',
                  border: '1px solid var(--border)',
                  marginBottom: '0.6rem',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button
                    type="button"
                    className="btn xs ghost"
                    disabled={activeIdx <= 0}
                    onClick={() => {
                      if (activeIdx > 0) {
                        setDayEditor({ ...dayEditor, activeTargetKey: noteTargets[activeIdx - 1].key });
                      }
                    }}
                    title="Previous note"
                  >
                    <ChevronLeft size={14} />
                    <span>Prev</span>
                  </button>
                  <span style={{ fontSize: '12px', fontWeight: 600 }}>
                    Note {activeIdx + 1} of {noteTargets.length}: {currentTarget.label}
                  </span>
                  <button
                    type="button"
                    className="btn xs ghost"
                    disabled={activeIdx >= noteTargets.length - 1}
                    onClick={() => {
                      if (activeIdx < noteTargets.length - 1) {
                        setDayEditor({ ...dayEditor, activeTargetKey: noteTargets[activeIdx + 1].key });
                      }
                    }}
                    title="Next note"
                  >
                    <span>Next</span>
                    <ChevronRight size={14} />
                  </button>
                </div>

                <select
                  value={activeKey}
                  onChange={(e) => setDayEditor({ ...dayEditor, activeTargetKey: e.target.value })}
                  style={{ fontSize: '12px', padding: '2px 6px', maxWidth: '170px' }}
                >
                  {noteTargets.map((t, idx) => (
                    <option key={t.key} value={t.key}>
                      {`${idx + 1}. ${t.label}`}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {activeKey === 'trip' && (
              <div className="small muted" style={{ marginBottom: '0.6rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                <NotebookPen size={14} className="text-accent" />
                <span>General notes, reminders, or reference details for the overall trip.</span>
              </div>
            )}

            {activeKey === 'day' && !isTripLevel && (
              <>
                <div className="field" style={{ marginBottom: '0.6rem' }}>
                  <label style={{ marginBottom: 4 }}>Day title / label</label>
                  <input
                    value={dayEditor.label}
                    onChange={(event) => setDayEditor({ ...dayEditor, label: event.target.value })}
                    placeholder="e.g. Arrival in Tokyo"
                  />
                </div>

                <div className="field" style={{ marginBottom: '0.6rem' }}>
                  <div className="row between" style={{ alignItems: 'center', marginBottom: 4 }}>
                    <label style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 5 }}>
                      <MapPin size={13} className="text-accent" />
                      <span>Day Location</span>
                    </label>
                    {dayEditor.location && (
                      <button
                        type="button"
                        className="btn xs link muted"
                        style={{ padding: 0, fontSize: '11px' }}
                        onClick={() => setDayEditor({ ...dayEditor, location: '', lat: null, lng: null })}
                      >
                        Reset to default
                      </button>
                    )}
                  </div>
                  <PlaceSearchInput
                    value={dayEditor.location ?? ''}
                    placeholder={
                      dayEditor.defaultLocation
                        ? `Auto: ${dayEditor.defaultLocation} (type or search to override)`
                        : 'Search city, neighborhood, or address…'
                    }
                    biasLat={tripCenter?.lat}
                    biasLng={tripCenter?.lng}
                    onChange={(val) => setDayEditor((prev) => (prev ? { ...prev, location: val } : prev))}
                    onSelect={(pl) => {
                      setDayEditor((prev) =>
                        prev
                          ? {
                              ...prev,
                              location: pl.address || pl.name,
                              lat: pl.lat,
                              lng: pl.lng,
                            }
                          : prev,
                      );
                    }}
                  />
                  <div className="small muted" style={{ marginTop: 3, fontSize: '11.5px' }}>
                    {dayEditor.location ? (
                      <span>Custom location set for this day</span>
                    ) : (
                      <span>
                        Defaulting to:{' '}
                        <strong>{dayEditor.defaultLocation || trip.destination || 'Trip destination'}</strong>
                      </span>
                    )}
                  </div>
                </div>
              </>
            )}

            <div className="field" style={{ marginBottom: '0.6rem' }}>
              <div className="row between" style={{ alignItems: 'center', marginBottom: 4 }}>
                <label style={{ margin: 0 }}>
                  {activeKey === 'trip'
                    ? 'Trip Notes'
                    : activeKey === 'day'
                    ? 'General Day notes'
                    : `${currentTarget.label} notes`}
                </label>
                {activeKey === 'day' && !isTripLevel && days.length > 1 && (
                  <div className="row items-center gap-1">
                    <span className="small muted">Span to next:</span>
                    <input
                      type="number"
                      min={1}
                      max={Math.max(1, maxSpan)}
                      value={dayEditor.spanDays ?? 1}
                      onChange={(e) => {
                        const val = Math.max(1, Math.min(maxSpan, parseInt(e.target.value || '1', 10)));
                        setDayEditor({ ...dayEditor, spanDays: val });
                      }}
                      style={{ width: '60px', padding: '2px 6px', fontSize: '13px' }}
                    />
                    <span className="small muted">days</span>
                  </div>
                )}
              </div>
              <textarea
                rows={isTripLevel ? 7 : 6}
                value={activeNoteText}
                onChange={(event) => updateActiveNoteText(event.target.value)}
                placeholder={
                  isTripLevel
                    ? 'General trip reminders, packing lists, confirmation links, emergency contacts…'
                    : activeKey === 'day'
                    ? 'General plans, reminders, weather backup, meeting details…'
                    : `Notes, tips or details for ${currentTarget.label}…`
                }
                autoFocus
              />
              {activeKey === 'day' && !isTripLevel && currentSpan > 1 && targetDays.length > 1 && (
                <div className="small muted" style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Calendar size={13} className="text-accent" />
                  <span>
                    Will apply these notes across <strong>{targetDays.length} days</strong> (Day {dayEditor.dayNumber} – Day {(dayEditor.dayNumber ?? 1) + targetDays.length - 1})
                  </span>
                </div>
              )}
            </div>

            <div className="field" style={{ marginBottom: '0.8rem' }}>
              <div className="row between" style={{ alignItems: 'center', marginBottom: 4 }}>
                <label style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <ExternalLink size={13} className="text-accent" />
                  <span>Note URL / Link</span>
                </label>
                {activeNoteUrl.trim() && (
                  <a
                    href={formatUrl(activeNoteUrl.trim())}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn xs ghost"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '2px 8px',
                      color: 'var(--accent)',
                      textDecoration: 'none',
                      fontWeight: 600,
                      background: 'rgba(56, 189, 248, 0.12)',
                      borderRadius: 4,
                    }}
                    title="Open link in a new tab"
                  >
                    <ExternalLink size={12} />
                    <span>Open link ↗</span>
                  </a>
                )}
              </div>
              <input
                type="url"
                value={activeNoteUrl}
                onChange={(event) => updateActiveNoteUrl(event.target.value)}
                placeholder="https://… (e.g. reservation link, tickets, article or guide URL)"
              />
            </div>

            <div className="modal-actions">
              <button className="btn primary" onClick={() => void saveDayNotes()}>Save</button>
              <button className="btn" onClick={() => setDayEditor(null)}>Cancel</button>
            </div>
          </Modal>
        );
      })()}

      {journalModalState.open && (
        <JournalEntryModal
          tripId={trip.id}
          isOpen={journalModalState.open}
          onClose={() => setJournalModalState({ open: false })}
          onSave={handleSaveJournalEntry}
          onDelete={handleRemoveJournal}
          initialData={journalModalState.entry}
          dayEntries={journalModalState.dayEntries || []}
          tripPhotos={trip.photos}
          onPhotosUploaded={reload}
        />
      )}

      {dayTodoModalState && (
        <DayTodoModal
          tripId={trip.id}
          isOpen={Boolean(dayTodoModalState)}
          onClose={() => setDayTodoModalState(null)}
          day={dayTodoModalState.day}
          dayIndex={dayTodoModalState.dayIndex}
          todos={trip.todos ?? []}
          onReload={reload}
          onNavigateToTodos={() => navigate(`/trips/${trip.id}?tab=todos`)}
        />
      )}

      {bookingModalDayState && (
        <BookingModal
          tripId={trip.id}
          initialType="hotel"
          initialStartAt={bookingModalDayState.startAt}
          initialEndAt={bookingModalDayState.endAt}
          onClose={() => setBookingModalDayState(null)}
          onSaved={async () => {
            setBookingModalDayState(null);
            await reload();
          }}
        />
      )}

      {deletingJournalId && (
        <ConfirmModal
          title="Delete journal entry"
          message="Delete this journal entry?"
          confirmLabel="Delete"
          danger
          onConfirm={() => void handleRemoveJournal(deletingJournalId)}
          onCancel={() => setDeletingJournalId(null)}
        />
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

      {deletingPlace && (() => {
        const siblingPlaces = findSpannedPlaces(deletingPlace, allPlaces, days);
        if (siblingPlaces.length > 1) {
          return (
            <Modal title="Delete multi-day place" onClose={() => setDeletingPlace(null)}>
              <p style={{ margin: '0 0 1rem' }}>
                <strong>&ldquo;{deletingPlace.name}&rdquo;</strong> appears on <strong>{siblingPlaces.length} days</strong> in your itinerary.
              </p>
              <p className="muted small" style={{ margin: '0 0 1.5rem' }}>
                Would you like to delete all {siblingPlaces.length} occurrences in this multi-day series or only remove this specific day's instance?
              </p>
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn danger"
                  onClick={async () => {
                    await apiPost(`/trips/${trip.id}/places/bulk-delete`, {
                      placeIds: siblingPlaces.map((p) => p.id),
                    });
                    setDeletingPlace(null);
                    await reload();
                  }}
                >
                  Delete All {siblingPlaces.length} Occurrences
                </button>
                <button
                  type="button"
                  className="btn"
                  style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
                  onClick={async () => {
                    await apiDelete(`/trips/${trip.id}/places/${deletingPlace.id}`);
                    setDeletingPlace(null);
                    await reload();
                  }}
                >
                  Delete Only This Day
                </button>
                <button type="button" className="btn" onClick={() => setDeletingPlace(null)}>
                  Cancel
                </button>
              </div>
            </Modal>
          );
        }

        return (
          <ConfirmModal
            title="Remove place"
            message={`Are you sure you want to remove "${deletingPlace.name}" from the trip?`}
            confirmLabel="Delete"
            danger
            onConfirm={async () => {
              await apiDelete(`/trips/${trip.id}/places/${deletingPlace.id}`);
              setDeletingPlace(null);
              await reload();
            }}
            onCancel={() => setDeletingPlace(null)}
          />
        );
      })()}

      {deletingDayId && (
        <ConfirmModal
          title="Delete day"
          message="Delete this day? Places will be kept but unassigned."
          confirmLabel="Delete"
          danger
          onConfirm={async () => {
            await apiDelete(`/trips/${trip.id}/days/${deletingDayId}`);
            setDeletingDayId(null);
            await reload();
          }}
          onCancel={() => setDeletingDayId(null)}
        />
      )}

      {pendingReorder && (
        <Modal title="Move Spanned Item" onClose={() => setPendingReorder(null)}>
          <p style={{ marginTop: 0, marginBottom: '1.25rem', lineHeight: '1.5' }}>
            <strong>{cleanPlaceOrStayTitle(pendingReorder.sourcePlace.name)}</strong> appears on <strong>{pendingReorder.siblingPlaces.length} days</strong>.
            <br />
            Do you want to move only this occurrence, or move the entire series together?
          </p>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn primary"
              onClick={() => {
                void executeReorderSeries(
                  pendingReorder.sourcePlace,
                  pendingReorder.sourceDayId,
                  pendingReorder.targetDayId,
                  pendingReorder.targetIndex,
                  pendingReorder.siblingPlaces,
                );
              }}
            >
              Move Entire Series ({pendingReorder.siblingPlaces.length} Days)
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                void executeReorderSingle(
                  pendingReorder.sourcePlace,
                  pendingReorder.sourceDayId,
                  pendingReorder.targetDayId,
                  pendingReorder.targetIndex,
                );
              }}
            >
              Move Only This Occurrence
            </button>
            <button type="button" className="btn" onClick={() => setPendingReorder(null)}>
              Cancel
            </button>
          </div>
        </Modal>
      )}

      {/* Add / Edit Place Modal with Search Autocomplete & Multi-day Span */}
      {open && (
        <Modal title={editingId ? 'Edit place' : 'Add place'} onClose={() => setOpen(false)}>
          <div className="field" style={{ marginBottom: '0.6rem' }}>
            <label className="field-label-sparkle" style={{ marginBottom: 4 }}>
              <Sparkles size={13} className="text-accent" />
              <span>Search landmark, restaurant or address (auto-fill)</span>
            </label>
            <PlaceSearchInput
              biasLat={tripCenter?.lat}
              biasLng={tripCenter?.lng}
              placeholder="Search a place or paste a Google Maps URL…"
              autoFocus={!editingId}
              onSelect={(pl) => {
                const isAccom = isAccommodationItem(pl);
                setEditing((prev) => ({
                  ...prev,
                  name: pl.name,
                  address: pl.address,
                  category: pl.category || prev.category,
                  lat: String(pl.lat),
                  lng: String(pl.lng),
                  website: pl.website || prev.website,
                  startTime: isAccom ? (prev.startTime || '15:00') : prev.startTime,
                  endTime: isAccom ? (prev.endTime || '10:00') : prev.endTime,
                  spanDays: isAccom && (!prev.spanDays || prev.spanDays <= 1) ? 2 : prev.spanDays,
                }));
              }}
            />
          </div>

          <div className="field" style={{ marginBottom: '0.6rem' }}>
            <label style={{ marginBottom: 4 }}>Title / Place Name</label>
            <input
              value={editing.name}
              onChange={(e) => {
                const val = e.target.value;
                setEditing((prev) => {
                  const isLink = isUrl(val);
                  return {
                    ...prev,
                    name: val,
                    website: isLink && !prev.website ? val.trim() : prev.website,
                    category: isLink && !prev.category ? 'Note' : prev.category,
                  };
                });
              }}
              placeholder="e.g. Meiji Shrine, or https://…"
            />
          </div>

          <div className="field" style={{ marginBottom: '0.6rem' }}>
            <label style={{ marginBottom: 4 }}>
              Full Description{' '}
              <span className="muted small font-normal">(revealed when title is clicked in itinerary)</span>
            </label>
            <textarea
              rows={2}
              value={editing.description}
              onChange={(e) => setEditing({ ...editing, description: e.target.value })}
              placeholder="Full details, highlights, tour information, schedule, or tips…"
            />
          </div>

          <div className="field" style={{ marginBottom: '0.6rem' }}>
            <div className="row between" style={{ alignItems: 'center', marginBottom: 4 }}>
              <label style={{ margin: 0 }}>Address or Coordinates</label>
              {(editing.address.trim() || editing.name.trim() || (editing.lat && editing.lng)) && (
                <a
                  href={
                    editing.lat && editing.lng
                      ? `https://www.google.com/maps/search/?api=1&query=${editing.lat},${editing.lng}`
                      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([editing.name, editing.address, trip.destination].filter(Boolean).join(', '))}`
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn xs ghost"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 6px', color: 'var(--accent)', textDecoration: 'none' }}
                  title="Open in Google Maps in a new tab"
                >
                  <ExternalLink size={12} />
                  <span>Open map</span>
                </a>
              )}
            </div>
            <input
              value={editing.address}
              onChange={(e) => {
                const val = e.target.value;
                const coordMatch = val.trim().match(/^(-?\d+(\.\d+)?)\s*,\s*(-?\d+(\.\d+)?)$/);
                if (coordMatch) {
                  setEditing({ ...editing, address: val, lat: coordMatch[1], lng: coordMatch[3] });
                } else {
                  setEditing({ ...editing, address: val });
                }
              }}
              placeholder="Street, city or 40.7128, -74.0060"
            />
          </div>

          <div className="field" style={{ marginBottom: '0.6rem' }}>
            <div className="row between" style={{ alignItems: 'center', marginBottom: 4 }}>
              <label style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 5 }}>
                {editing.category === 'Note' ? (
                  <>
                    <ExternalLink size={13} className="text-accent" />
                    <span>Note URL</span>
                  </>
                ) : (
                  <span>Website</span>
                )}
              </label>
              {(editing.website.trim() || isUrl(editing.name)) && (
                <a
                  href={formatUrl(editing.website.trim() || editing.name.trim())}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn xs ghost"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '2px 8px',
                    color: 'var(--accent)',
                    textDecoration: 'none',
                    fontWeight: 600,
                    background: 'rgba(56, 189, 248, 0.12)',
                    borderRadius: 4,
                  }}
                  title="Open link in new tab"
                >
                  <ExternalLink size={12} />
                  <span>Open link ↗</span>
                </a>
              )}
            </div>
            <input
              type="url"
              value={editing.website}
              onChange={(e) => setEditing({ ...editing, website: e.target.value })}
              placeholder={editing.category === 'Note' ? 'https://… (e.g. guide, tickets or reservation link)' : 'https://…'}
            />
          </div>

          {/* Category, Day, and Span across days on the same horizontal row */}
          <div className={!editingId && days.length > 0 ? 'grid grid-3' : days.length > 0 ? 'grid grid-2' : ''} style={{ gap: '0.75rem', marginBottom: '0.6rem' }}>
            <div className="field small" style={{ marginBottom: 0 }}>
              <label style={{ marginBottom: 4 }}>Category</label>
              <select
                value={editing.category}
                onChange={(e) => {
                  const newCat = e.target.value;
                  const isAccom = isAccommodationItem({ category: newCat });
                  setEditing((prev) => ({
                    ...prev,
                    category: newCat,
                    startTime: isAccom ? (prev.startTime || '15:00') : prev.startTime,
                    endTime: isAccom ? (prev.endTime || '10:00') : prev.endTime,
                    spanDays: isAccom && (!prev.spanDays || prev.spanDays <= 1) ? 2 : prev.spanDays,
                  }));
                }}
              >
                <option value="">Auto-infer with AI</option>
                <option value="Note">📝 Note / Reminder</option>
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

            {days.length > 0 && (
              <div className="field small" style={{ marginBottom: 0 }}>
                <label style={{ marginBottom: 4 }}>Day</label>
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

            {!editingId && days.length > 0 && (
              <div className="field small" style={{ marginBottom: 0 }}>
                <label style={{ marginBottom: 4 }}>Span across days</label>
                <div className="row items-center gap-1">
                  <input
                    type="number"
                    min={1}
                    max={days.length}
                    value={editing.spanDays ?? 1}
                    disabled={!editing.dayId || editing.dayId === 'unassigned'}
                    onChange={(e) => {
                      const val = Math.max(1, Math.min(days.length, parseInt(e.target.value || '1', 10)));
                      setEditing({ ...editing, spanDays: val });
                    }}
                    style={{ width: '65px' }}
                  />
                  <span className="small muted" style={{ fontSize: '11px', whiteSpace: 'nowrap' }}>
                    {(editing.spanDays ?? 1) > 1 ? 'consec. days' : 'day (single)'}
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-2" style={{ gap: '0.75rem', marginBottom: '0.6rem' }}>
            <div className="field small" style={{ marginBottom: 0 }}>
              <label style={{ marginBottom: 4 }}>Start / Departure Time</label>
              <input
                type="time"
                value={editing.startTime}
                onChange={(e) => setEditing({ ...editing, startTime: e.target.value })}
              />
            </div>
            <div className="field small" style={{ marginBottom: 0 }}>
              <label style={{ marginBottom: 4 }}>End / Arrival Time</label>
              <input
                type="time"
                value={editing.endTime}
                onChange={(e) => setEditing({ ...editing, endTime: e.target.value })}
              />
            </div>
          </div>

          {!editingId && (editing.spanDays ?? 1) > 1 && editing.dayId && editing.dayId !== 'unassigned' && (() => {
            const targetDays = getConsecutiveDays(editing.dayId, editing.spanDays ?? 1, days);
            const startDayIdx = days.findIndex((d) => d.id === editing.dayId);
            return (
              <div className="small muted" style={{ marginTop: '-0.25rem', marginBottom: '0.6rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Calendar size={13} className="text-accent" />
                <span>
                  Will create this item across <strong>{targetDays.length} days</strong> (Day {startDayIdx + 1} – Day {startDayIdx + targetDays.length})
                </span>
              </div>
            );
          })()}

          <div className="field" style={{ marginBottom: '0.6rem' }}>
            <label style={{ marginBottom: 4 }}>Notes</label>
            <textarea rows={2} value={editing.notes} onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '10px',
              marginTop: '12px',
              flexWrap: 'nowrap',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
              {editingId && editingPlaceItem && (() => {
                const siblingPlaces = findSpannedPlaces(editingPlaceItem, allPlaces, days);
                if (siblingPlaces.length > 1) {
                  return (
                    <label
                      style={{
                        margin: 0,
                        cursor: 'pointer',
                        fontWeight: 500,
                        fontSize: '13px',
                        userSelect: 'none',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        whiteSpace: 'nowrap',
                      }}
                      title={`This item appears on ${siblingPlaces.length} days. Uncheck to update only this single instance.`}
                    >
                      <input
                        type="checkbox"
                        checked={updateAllInSeries}
                        onChange={(e) => setUpdateAllInSeries(e.target.checked)}
                        style={{ cursor: 'pointer', margin: 0 }}
                      />
                      <span>Apply to all {siblingPlaces.length} occurrences</span>
                    </label>
                  );
                }
                return null;
              })()}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginLeft: 'auto', flexShrink: 0 }}>
              <button type="button" className="btn primary" onClick={save} disabled={busy || !editing.name}>
                {busy ? 'Saving…' : 'Save'}
              </button>
              <button type="button" className="btn" onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Mobile Floating Action Controls (<= 820px) */}
      <div className="mobile-itinerary-fabs">
        <button
          type="button"
          className="mobile-map-toggle-fab"
          onClick={() => setMobileTab(mobileTab === 'list' ? 'map' : 'list')}
          title={mobileTab === 'list' ? 'Switch to interactive map view' : 'Switch to itinerary list view'}
        >
          {mobileTab === 'list' ? (
            <>
              <MapIcon size={16} />
              <span>Map ({displayedMapPlaces.length})</span>
            </>
          ) : (
            <>
              <List size={16} />
              <span>List ({totalPlacesCount})</span>
            </>
          )}
        </button>

        <button
          type="button"
          className="mobile-add-place-fab"
          onClick={() => openNew(selectedDayId && selectedDayId !== 'unassigned' ? selectedDayId : '')}
          title="Add place or stop"
          aria-label="Add place"
        >
          <Plus size={22} />
        </button>
      </div>
    </div>
  );
}