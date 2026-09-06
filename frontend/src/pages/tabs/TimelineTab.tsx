import { useMemo, useState } from 'react';
import {
  Calendar, Clock, MapPin, Plane, Hotel, Compass, AlertCircle,
  ZoomIn, ZoomOut, Filter, ExternalLink, Car, Train, Bus, Pencil, Plus
} from 'lucide-react';
import type { Trip, Booking, BookingType, Place, Day } from '../../lib/types';
import { Modal } from '../../components/Modal';
import { AuditBadge } from '../../components/AuditBadge';
import { getCategoryIcon } from '../../lib/icons';
import { apiPost, apiPatch } from '../../lib/api';
import { endForStart } from '../../lib/dateRange';

interface TimelineTabProps {
  trip: Trip;
  reload: () => Promise<void>;
}

interface TimelineDay {
  dayNumber: number;
  dateStr: string; // YYYY-MM-DD
  dateObj: Date;
  dayRecord?: Day;
  places: Place[];
  label?: string | null;
  city?: string | null;
}

interface StaySpan {
  id: string;
  title: string;
  provider?: string | null;
  reference?: string | null;
  startDayIndex: number;
  endDayIndex: number;
  nights: number;
  booking?: Booking;
  place?: Place;
  laneIndex?: number;
}

interface TransitSpan {
  id: string;
  title: string;
  type: 'flight' | 'train' | 'car' | 'bus' | 'transit';
  provider?: string | null;
  reference?: string | null;
  startDayIndex: number;
  endDayIndex: number;
  startTime?: string | null;
  endTime?: string | null;
  booking?: Booking;
  place?: Place;
  laneIndex?: number;
}

function parseDateKey(val?: string | null): string | null {
  if (!val) return null;
  const m = val.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function toDatetimeLocal(val?: string | null): string {
  if (!val) return '';
  const d = new Date(val);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  return `${y}-${m}-${day}T${hours}:${minutes}`;
}

function formatBookingDateTime(val?: string | null): string {
  if (!val) return '—';
  const d = new Date(val);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function detectTransitType(str: string, defaultType: TransitSpan['type'] = 'transit'): TransitSpan['type'] {
  const s = str.toLowerCase();
  if (s.includes('flight') || s.includes('airline') || s.includes('air') || s.includes('plane') || s.includes('fly')) {
    return 'flight';
  }
  if (s.includes('train') || s.includes('rail') || s.includes('eurostar') || s.includes('amtrak') || s.includes('freccia') || s.includes('italo')) {
    return 'train';
  }
  if (s.includes('bus') || s.includes('flixbus') || s.includes('coach') || s.includes('shuttle')) {
    return 'bus';
  }
  if (s.includes('car') || s.includes('rental') || s.includes('drive') || s.includes('hertz') || s.includes('avis') || s.includes('enterprise') || s.includes('sixt')) {
    return 'car';
  }
  return defaultType;
}

function getTransitIcon(type: TransitSpan['type']) {
  switch (type) {
    case 'flight':
      return <Plane size={13} style={{ color: '#818cf8', flexShrink: 0 }} />;
    case 'train':
      return <Train size={13} style={{ color: '#38bdf8', flexShrink: 0 }} />;
    case 'bus':
      return <Bus size={13} style={{ color: '#fb923c', flexShrink: 0 }} />;
    case 'car':
      return <Car size={13} style={{ color: '#facc15', flexShrink: 0 }} />;
    default:
      return <Plane size={13} style={{ color: '#818cf8', flexShrink: 0 }} />;
  }
}

function getTransitColors(type: TransitSpan['type']) {
  switch (type) {
    case 'flight':
      return {
        bg: 'linear-gradient(135deg, rgba(99, 102, 241, 0.22), rgba(129, 140, 248, 0.14))',
        border: 'rgba(129, 140, 248, 0.55)',
        badge: 'rgba(99, 102, 241, 0.25)',
      };
    case 'train':
      return {
        bg: 'linear-gradient(135deg, rgba(56, 189, 248, 0.22), rgba(14, 165, 233, 0.14))',
        border: 'rgba(56, 189, 248, 0.55)',
        badge: 'rgba(56, 189, 248, 0.25)',
      };
    case 'bus':
      return {
        bg: 'linear-gradient(135deg, rgba(251, 146, 60, 0.22), rgba(249, 115, 22, 0.14))',
        border: 'rgba(251, 146, 60, 0.55)',
        badge: 'rgba(251, 146, 60, 0.25)',
      };
    case 'car':
      return {
        bg: 'linear-gradient(135deg, rgba(250, 204, 21, 0.22), rgba(234, 179, 8, 0.14))',
        border: 'rgba(250, 204, 21, 0.55)',
        badge: 'rgba(250, 204, 21, 0.25)',
      };
    default:
      return {
        bg: 'linear-gradient(135deg, rgba(99, 102, 241, 0.22), rgba(56, 189, 248, 0.14))',
        border: 'rgba(129, 140, 248, 0.55)',
        badge: 'rgba(99, 102, 241, 0.25)',
      };
  }
}

export function TimelineTab({ trip, reload }: TimelineTabProps) {
  const [zoomLevel, setZoomLevel] = useState<'standard' | 'compact'>('standard');
  const [trackFilter, setTrackFilter] = useState<'all' | 'stays' | 'transit' | 'activities'>('all');
  const [selectedItem, setSelectedItem] = useState<{
    type: 'stay' | 'transit' | 'place' | 'day';
    title: string;
    stay?: StaySpan;
    transit?: TransitSpan;
    place?: Place;
    day?: TimelineDay;
  } | null>(null);

  const [editingBooking, setEditingBooking] = useState<Booking | null>(null);
  const [gapAddModal, setGapAddModal] = useState<{ startDayIndex: number; endDayIndex: number } | null>(null);
  const [bookingForm, setBookingForm] = useState<{
    type: BookingType;
    title: string;
    provider: string;
    reference: string;
    startAt: string;
    endAt: string;
  }>({
    type: 'hotel',
    title: '',
    provider: '',
    reference: '',
    startAt: '',
    endAt: '',
  });
  const [busy, setBusy] = useState(false);

  const openEditBooking = (b: Booking) => {
    setEditingBooking(b);
    setBookingForm({
      type: b.type,
      title: b.title,
      provider: b.provider || '',
      reference: b.reference || '',
      startAt: toDatetimeLocal(b.startAt),
      endAt: toDatetimeLocal(b.endAt),
    });
  };

  const openAddStayForGap = (gapDayIdx: number) => {
    const curDay = timelineDays[gapDayIdx];
    const nextDay = timelineDays[Math.min(gapDayIdx + 1, timelineDays.length - 1)];
    const startAtStr = curDay ? `${curDay.dateStr}T15:00` : '';
    const endAtStr = nextDay ? `${nextDay.dateStr}T11:00` : '';

    setGapAddModal({ startDayIndex: gapDayIdx, endDayIndex: Math.min(gapDayIdx + 1, timelineDays.length - 1) });
    setBookingForm({
      type: 'hotel',
      title: '',
      provider: '',
      reference: '',
      startAt: startAtStr,
      endAt: endAtStr,
    });
  };

  const saveBookingForm = async () => {
    if (!bookingForm.title) return;
    setBusy(true);
    try {
      if (editingBooking) {
        await apiPatch(`/trips/${trip.id}/bookings/${editingBooking.id}`, {
          ...bookingForm,
          startAt: bookingForm.startAt ? new Date(bookingForm.startAt).toISOString() : null,
          endAt: bookingForm.endAt ? new Date(bookingForm.endAt).toISOString() : null,
        });
        setEditingBooking(null);
      } else {
        await apiPost(`/trips/${trip.id}/bookings`, {
          ...bookingForm,
          startAt: bookingForm.startAt ? new Date(bookingForm.startAt).toISOString() : undefined,
          endAt: bookingForm.endAt ? new Date(bookingForm.endAt).toISOString() : undefined,
        });
        setGapAddModal(null);
      }
      await reload();
    } finally {
      setBusy(false);
    }
  };

  // 1. Build sorted distinct timeline days
  const timelineDays = useMemo<TimelineDay[]>(() => {
    const rawDays = [...(trip.days ?? [])].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime() || a.sortOrder - b.sortOrder
    );

    const dayMap = new Map<string, Day>();
    for (const d of rawDays) {
      const key = parseDateKey(d.date);
      if (key && !dayMap.has(key)) {
        dayMap.set(key, d);
      }
    }

    const startDateKey = parseDateKey(trip.startDate);
    const endDateKey = parseDateKey(trip.endDate);

    const datesSet = new Set<string>();
    for (const key of dayMap.keys()) datesSet.add(key);

    if (startDateKey) datesSet.add(startDateKey);
    if (endDateKey) datesSet.add(endDateKey);

    // If both start and end date exist, fill in any missing dates in range
    if (startDateKey && endDateKey) {
      const cur = new Date(startDateKey + 'T00:00:00');
      const end = new Date(endDateKey + 'T00:00:00');
      while (cur <= end) {
        const y = cur.getFullYear();
        const m = String(cur.getMonth() + 1).padStart(2, '0');
        const d = String(cur.getDate()).padStart(2, '0');
        datesSet.add(`${y}-${m}-${d}`);
        cur.setDate(cur.getDate() + 1);
      }
    }

    const sortedDateKeys = Array.from(datesSet).sort();

    return sortedDateKeys.map((dateKey, idx) => {
      const dayRecord = dayMap.get(dateKey);
      const dateObj = new Date(dateKey + 'T00:00:00');
      const dayPlaces = dayRecord?.places ?? [];

      return {
        dayNumber: idx + 1,
        dateStr: dateKey,
        dateObj,
        dayRecord,
        places: dayPlaces,
        label: dayRecord?.label,
      };
    });
  }, [trip.days, trip.startDate, trip.endDate]);

  // 2. Map Stays / Accommodations across the timeline with multi-lane packing
  const { staySpans, totalStayLanes } = useMemo(() => {
    if (timelineDays.length === 0) return { staySpans: [], totalStayLanes: 1 };
    const dateToIndex = new Map<string, number>();
    timelineDays.forEach((d, idx) => dateToIndex.set(d.dateStr, idx));

    const rawStays: StaySpan[] = [];

    // Check hotel bookings
    for (const b of trip.bookings ?? []) {
      if (b.type === 'hotel') {
        const sKey = parseDateKey(b.startAt);
        const eKey = parseDateKey(b.endAt);

        let startIdx = sKey && dateToIndex.has(sKey) ? dateToIndex.get(sKey)! : 0;
        let endIdx = eKey && dateToIndex.has(eKey) ? dateToIndex.get(eKey)! : startIdx + 1;
        if (endIdx <= startIdx) endIdx = startIdx + 1;
        endIdx = Math.min(endIdx, timelineDays.length - 1);

        const nights = Math.max(1, endIdx - startIdx);
        rawStays.push({
          id: b.id,
          title: b.title,
          provider: b.provider,
          reference: b.reference,
          startDayIndex: startIdx,
          endDayIndex: endIdx,
          nights,
          booking: b,
        });
      }
    }

    // Check lodging places
    for (const d of timelineDays) {
      const dIdx = dateToIndex.get(d.dateStr) ?? 0;
      for (const p of d.places) {
        const cat = (p.category || '').toLowerCase();
        if (cat === 'lodging' || cat === 'hotel') {
          const exists = rawStays.some(
            (s) => s.title.toLowerCase().includes(p.name.toLowerCase()) || p.name.toLowerCase().includes(s.title.toLowerCase())
          );
          if (!exists) {
            rawStays.push({
              id: p.id,
              title: p.name,
              startDayIndex: dIdx,
              endDayIndex: Math.min(dIdx + 1, timelineDays.length - 1),
              nights: 1,
              place: p,
            });
          }
        }
      }
    }

    // Sort stays by start index, then duration descending
    const sorted = [...rawStays].sort((a, b) => {
      if (a.startDayIndex !== b.startDayIndex) return a.startDayIndex - b.startDayIndex;
      return (b.endDayIndex - b.startDayIndex) - (a.endDayIndex - a.startDayIndex);
    });

    // Multi-lane packing for stays
    const laneEnds: number[] = [];
    const packedStays: StaySpan[] = sorted.map((stay) => {
      let lane = -1;
      for (let i = 0; i < laneEnds.length; i++) {
        if (stay.startDayIndex >= laneEnds[i]) {
          lane = i;
          laneEnds[i] = stay.endDayIndex;
          break;
        }
      }
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(stay.endDayIndex);
      }
      return { ...stay, laneIndex: lane };
    });

    return {
      staySpans: packedStays,
      totalStayLanes: Math.max(1, laneEnds.length),
    };
  }, [timelineDays, trip.bookings]);

  // 3. Map Transit / Flights across the timeline with multi-lane packing
  const { transitSpans, totalTransitLanes } = useMemo(() => {
    if (timelineDays.length === 0) return { transitSpans: [], totalTransitLanes: 1 };
    const dateToIndex = new Map<string, number>();
    timelineDays.forEach((d, idx) => dateToIndex.set(d.dateStr, idx));

    const rawTransits: TransitSpan[] = [];

    // Collect daily transport/flight places from itinerary days first
    const placeTransits: TransitSpan[] = [];
    for (const d of timelineDays) {
      const dIdx = dateToIndex.get(d.dateStr) ?? 0;
      for (const p of d.places) {
        const cat = (p.category || '').toLowerCase();
        const pNameLower = p.name.toLowerCase();
        if (
          cat === 'transport' ||
          cat === 'transit' ||
          cat === 'flight' ||
          pNameLower.includes('flight') ||
          pNameLower.includes('airline') ||
          pNameLower.includes('american airlines') ||
          pNameLower.includes('delta') ||
          pNameLower.includes('united') ||
          pNameLower.includes('train') ||
          pNameLower.includes('flixbus')
        ) {
          let endDIdx = dIdx;
          if (p.endTime && p.startTime && p.endTime < p.startTime) {
            endDIdx = Math.min(dIdx + 1, timelineDays.length - 1);
          }

          placeTransits.push({
            id: p.id,
            title: p.name,
            type: detectTransitType(p.name, 'transit'),
            startDayIndex: dIdx,
            endDayIndex: endDIdx,
            startTime: p.startTime,
            endTime: p.endTime,
            place: p,
          });
        }
      }
    }

    // Process transit bookings (flight, car)
    for (const b of trip.bookings ?? []) {
      if (b.type === 'flight' || b.type === 'car') {
        const sKey = parseDateKey(b.startAt);
        const eKey = parseDateKey(b.endAt);

        const startIdx = sKey && dateToIndex.has(sKey) ? dateToIndex.get(sKey)! : 0;
        let endIdx = eKey && dateToIndex.has(eKey) ? dateToIndex.get(eKey)! : startIdx;
        endIdx = Math.min(Math.max(startIdx, endIdx), timelineDays.length - 1);

        // Check if booking has structured legs array in details
        const detailsObj = b.details && typeof b.details === 'object' ? (b.details as Record<string, unknown>) : null;
        const legs = detailsObj && (Array.isArray(detailsObj.legs) ? detailsObj.legs : Array.isArray(detailsObj.flights) ? detailsObj.flights : null);

        if (legs && legs.length > 0) {
          // Unpack each structured flight leg as an individual timeline transit bar
          for (let lIdx = 0; lIdx < legs.length; lIdx++) {
            const leg = legs[lIdx] as Record<string, unknown>;
            const depKey = parseDateKey(typeof leg.departTime === 'string' ? leg.departTime : null);
            const arrKey = parseDateKey(typeof leg.arriveTime === 'string' ? leg.arriveTime : null);
            const legStartIdx = depKey && dateToIndex.has(depKey) ? dateToIndex.get(depKey)! : startIdx;
            const legEndIdx = arrKey && dateToIndex.has(arrKey) ? dateToIndex.get(arrKey)! : legStartIdx;

            const carrier = (typeof leg.carrier === 'string' && leg.carrier) || b.provider || 'Flight';
            const flightNo = typeof leg.flightNumber === 'string' ? leg.flightNumber : '';
            const fromCode = (typeof leg.fromCode === 'string' && leg.fromCode) || (typeof leg.fromCity === 'string' && leg.fromCity) || '';
            const toCode = (typeof leg.toCode === 'string' && leg.toCode) || (typeof leg.toCity === 'string' && leg.toCity) || '';
            const route = fromCode && toCode ? `${fromCode} → ${toCode}` : '';
            const legTitle = [carrier, flightNo, route ? `(${route})` : ''].filter(Boolean).join(' ');

            rawTransits.push({
              id: `${b.id}-leg-${lIdx}`,
              title: legTitle || b.title,
              type: 'flight',
              provider: carrier,
              reference: b.reference,
              startDayIndex: legStartIdx,
              endDayIndex: Math.min(Math.max(legStartIdx, legEndIdx), timelineDays.length - 1),
              startTime: typeof leg.departTime === 'string' ? leg.departTime : b.startAt,
              endTime: typeof leg.arriveTime === 'string' ? leg.arriveTime : b.endAt,
              booking: b,
            });
          }
        } else {
          // Check if daily places already represent individual flight legs
          const hasMatchingPlaces = placeTransits.some(
            (pt) =>
              (b.reference && pt.place?.notes && pt.place.notes.includes(b.reference)) ||
              (b.provider && pt.title.toLowerCase().includes(b.provider.toLowerCase()))
          );

          // If this is a multi-day flight booking (e.g. 25 days round-trip) and individual flight places exist,
          // prefer the individual day flight places over the monolithic 25-day block!
          if (b.type === 'flight' && (endIdx - startIdx > 1) && hasMatchingPlaces) {
            // Skip the monolithic multi-day booking in favor of the individual daily place legs
          } else {
            const tType = b.type === 'flight' ? 'flight' : b.type === 'car' ? 'car' : detectTransitType(b.title);
            rawTransits.push({
              id: b.id,
              title: b.title,
              type: tType,
              provider: b.provider,
              reference: b.reference,
              startDayIndex: startIdx,
              endDayIndex: endIdx,
              startTime: b.startAt,
              endTime: b.endAt,
              booking: b,
            });
          }
        }
      }
    }

    // Add daily transport places (avoiding duplicates if a booking already created that exact leg)
    for (const pt of placeTransits) {
      const isDupe = rawTransits.some(
        (rt) =>
          rt.startDayIndex === pt.startDayIndex &&
          (rt.title.toLowerCase().trim() === pt.title.toLowerCase().trim() ||
           (rt.reference && pt.place?.notes && pt.place.notes.includes(rt.reference) && rt.title.includes(pt.title)))
      );
      if (!isDupe) {
        rawTransits.push(pt);
      }
    }

    // Sort transits chronologically by startDayIndex, then by duration descending, then title
    const sorted = [...rawTransits].sort((a, b) => {
      if (a.startDayIndex !== b.startDayIndex) return a.startDayIndex - b.startDayIndex;
      const durA = a.endDayIndex - a.startDayIndex;
      const durB = b.endDayIndex - b.startDayIndex;
      if (durB !== durA) return durB - durA;
      return a.title.localeCompare(b.title);
    });

    // Multi-lane packing algorithm for transit items
    const laneEnds: number[] = [];
    const packedTransits: TransitSpan[] = sorted.map((item) => {
      let lane = -1;
      for (let i = 0; i < laneEnds.length; i++) {
        // Items must not overlap horizontally within the same lane
        if (item.startDayIndex > laneEnds[i]) {
          lane = i;
          laneEnds[i] = item.endDayIndex;
          break;
        }
      }
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(item.endDayIndex);
      }
      return { ...item, laneIndex: lane };
    });

    return {
      transitSpans: packedTransits,
      totalTransitLanes: Math.max(1, laneEnds.length),
    };
  }, [timelineDays, trip.bookings]);

  // 4. Compute Lodging Gap Analysis (Which nights have no hotel)
  const lodgingGaps = useMemo<number[]>(() => {
    if (timelineDays.length <= 1) return [];
    const coveredNights = new Set<number>();

    for (const s of staySpans) {
      for (let day = s.startDayIndex; day < s.endDayIndex; day++) {
        coveredNights.add(day);
      }
      if (s.startDayIndex === s.endDayIndex) {
        coveredNights.add(s.startDayIndex);
      }
    }

    // Overnight transits also cover lodging
    for (const t of transitSpans) {
      if (t.endDayIndex > t.startDayIndex) {
        for (let day = t.startDayIndex; day < t.endDayIndex; day++) {
          coveredNights.add(day);
        }
      }
    }

    const gaps: number[] = [];
    for (let i = 0; i < timelineDays.length - 1; i++) {
      if (!coveredNights.has(i)) {
        gaps.push(i);
      }
    }
    return gaps;
  }, [timelineDays, staySpans, transitSpans]);

  const totalNights = Math.max(0, timelineDays.length - 1);
  const coveredNightsCount = totalNights - lodgingGaps.length;
  const isFullyBooked = totalNights > 0 && lodgingGaps.length === 0;

  const colWidth = zoomLevel === 'compact' ? 140 : 220;
  const totalGridWidth = Math.max(800, timelineDays.length * colWidth);

  // Height sizing for multi-lane tracks
  const barHeight = 36;
  const barGap = 6;
  const staysTrackHeight = Math.max(52, totalStayLanes * (barHeight + barGap) + 8);
  const transitTrackHeight = Math.max(52, totalTransitLanes * (barHeight + barGap) + 8);

  return (
    <div>
      {/* KPI Overview Strip */}
      <div className="kpis">
        <div className="kpi">
          <div className="k-label">Trip duration</div>
          <div className="k-value" style={{ color: 'var(--accent)' }}>
            {timelineDays.length} {timelineDays.length === 1 ? 'Day' : 'Days'}
          </div>
          <div className="k-sub">
            {timelineDays.length > 0
              ? `${timelineDays[0].dateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${timelineDays[timelineDays.length - 1].dateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
              : 'Dates pending'}
          </div>
        </div>

        <div className="kpi">
          <div className="k-label">Lodging coverage</div>
          <div className="k-value" style={{ color: isFullyBooked ? 'var(--success, #10b981)' : lodgingGaps.length > 0 ? 'var(--warning, #f59e0b)' : 'var(--text)' }}>
            {totalNights > 0 ? `${coveredNightsCount} / ${totalNights} nights` : '—'}
          </div>
          <div className="k-sub" style={{ color: isFullyBooked ? '#10b981' : lodgingGaps.length > 0 ? '#f59e0b' : 'var(--muted)' }}>
            {isFullyBooked ? 'All nights covered! 🎉' : lodgingGaps.length > 0 ? `⚠️ ${lodgingGaps.length} nights missing lodging` : 'No nights scheduled'}
          </div>
        </div>

        <div className="kpi">
          <div className="k-label">Transit & travel legs</div>
          <div className="k-value">{transitSpans.length}</div>
          <div className="k-sub">Flights, trains & connections</div>
        </div>

        <div className="kpi">
          <div className="k-label">Scheduled stops</div>
          <div className="k-value">{trip._count?.places ?? 0}</div>
          <div className="k-sub">Across {timelineDays.length} days</div>
        </div>
      </div>

      {/* Gantt Controls Bar */}
      <div className="row between mb" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        {/* Track Filters */}
        <div style={{ display: 'flex', gap: 6, background: 'var(--panel)', padding: 4, borderRadius: 8, border: '1px solid var(--line)' }}>
          <button
            type="button"
            className={`btn sm ${trackFilter === 'all' ? 'primary' : 'ghost'}`}
            onClick={() => setTrackFilter('all')}
          >
            <Filter size={13} /> All Tracks
          </button>
          <button
            type="button"
            className={`btn sm ${trackFilter === 'stays' ? 'primary' : 'ghost'}`}
            onClick={() => setTrackFilter('stays')}
          >
            <Hotel size={13} /> Stays ({staySpans.length})
          </button>
          <button
            type="button"
            className={`btn sm ${trackFilter === 'transit' ? 'primary' : 'ghost'}`}
            onClick={() => setTrackFilter('transit')}
          >
            <Plane size={13} /> Transit ({transitSpans.length})
          </button>
          <button
            type="button"
            className={`btn sm ${trackFilter === 'activities' ? 'primary' : 'ghost'}`}
            onClick={() => setTrackFilter('activities')}
          >
            <Compass size={13} /> Activities
          </button>
        </div>

        {/* Zoom Level Toggle */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <button
            type="button"
            className={`btn sm ${zoomLevel === 'compact' ? 'primary' : 'ghost'}`}
            onClick={() => setZoomLevel('compact')}
            title="Compact Macro Overview"
          >
            <ZoomOut size={13} /> Compact
          </button>
          <button
            type="button"
            className={`btn sm ${zoomLevel === 'standard' ? 'primary' : 'ghost'}`}
            onClick={() => setZoomLevel('standard')}
            title="Standard Detailed View"
          >
            <ZoomIn size={13} /> Standard
          </button>
        </div>
      </div>

      {/* Lodging Gaps Warning Alert */}
      {lodgingGaps.length > 0 && (trackFilter === 'all' || trackFilter === 'stays') && (
        <div
          className="panel mb"
          style={{
            padding: '10px 14px',
            background: 'rgba(245, 158, 11, 0.08)',
            borderColor: 'rgba(245, 158, 11, 0.3)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <AlertCircle size={18} style={{ color: 'var(--warning, #f59e0b)', flexShrink: 0 }} />
          <div style={{ fontSize: '0.86rem' }}>
            <strong>Lodging Gap Detected:</strong> You have {lodgingGaps.length} {lodgingGaps.length === 1 ? 'night' : 'nights'} without a hotel or overnight transit (e.g. Day {lodgingGaps.map((g) => g + 1).join(', Day ')}).
          </div>
        </div>
      )}

      {/* GANTT TIMELINE MATRIX CONTAINER */}
      {timelineDays.length === 0 ? (
        <div className="empty-state">
          <Calendar size={36} className="muted" style={{ margin: '0 auto 10px', opacity: 0.5 }} />
          <div className="big">No itinerary dates yet</div>
          <p>Set trip start and end dates or add days to your itinerary to view the macro timeline.</p>
        </div>
      ) : (
        <div
          className="panel"
          style={{
            padding: 0,
            overflowX: 'auto',
            borderRadius: 'var(--radius)',
            border: '1px solid var(--line)',
            background: 'var(--panel)',
          }}
        >
          <div style={{ minWidth: totalGridWidth, display: 'flex', flexDirection: 'column' }}>
            {/* 1. DATE HEADER ROW */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${timelineDays.length}, ${colWidth}px)`,
                borderBottom: '2px solid var(--line)',
                background: 'var(--panel-2)',
                position: 'sticky',
                top: 0,
                zIndex: 10,
              }}
            >
              {timelineDays.map((day) => {
                const weekday = day.dateObj.toLocaleDateString(undefined, { weekday: 'short' });
                const dateNum = day.dateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

                return (
                  <div
                    key={day.dateStr}
                    style={{
                      padding: '10px 12px',
                      borderRight: '1px solid var(--line)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 2,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontWeight: 800, fontSize: '0.9rem', color: 'var(--text)' }}>
                        Day {day.dayNumber}
                      </span>
                      <span style={{ fontSize: '0.74rem', color: 'var(--accent)', fontWeight: 600 }}>
                        {weekday}
                      </span>
                    </div>

                    <div style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
                      {dateNum}
                    </div>

                    {day.label && (
                      <div
                        style={{
                          fontSize: '0.72rem',
                          fontWeight: 600,
                          color: 'var(--text)',
                          marginTop: 2,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={day.label}
                      >
                        {day.label}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* 2. TRACK: ACCOMMODATIONS (🏨) */}
            {(trackFilter === 'all' || trackFilter === 'stays') && (
              <div style={{ borderBottom: '1px solid var(--line)', padding: '10px 0' }}>
                <div style={{ padding: '0 12px 6px', display: 'flex', alignItems: 'center', gap: 6, color: 'var(--muted)', fontSize: '0.74rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  <Hotel size={13} style={{ color: 'var(--accent)' }} /> Stays & Accommodations {totalStayLanes > 1 ? `(${totalStayLanes} Lanes)` : ''}
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(${timelineDays.length}, ${colWidth}px)`,
                    position: 'relative',
                    minHeight: staysTrackHeight,
                  }}
                >
                  {/* Grid background vertical lines */}
                  {timelineDays.map((d) => (
                    <div key={d.dateStr} style={{ borderRight: '1px solid rgba(255,255,255,0.05)', minHeight: staysTrackHeight }} />
                  ))}

                  {/* Render Lodging Spanning Bars */}
                  {staySpans.map((stay) => {
                    const spanCols = Math.max(1, stay.endDayIndex - stay.startDayIndex);
                    const leftPos = stay.startDayIndex * colWidth + 6;
                    const width = spanCols * colWidth - 12;
                    const lane = stay.laneIndex ?? 0;
                    const topPos = 4 + lane * (barHeight + barGap);

                    return (
                      <div
                        key={stay.id}
                        onClick={() => setSelectedItem({ type: 'stay', title: stay.title, stay })}
                        style={{
                          position: 'absolute',
                          left: leftPos,
                          width,
                          top: topPos,
                          height: barHeight,
                          background: 'linear-gradient(135deg, rgba(34, 211, 238, 0.22), rgba(56, 189, 248, 0.14))',
                          border: '1px solid var(--accent)',
                          borderRadius: 8,
                          padding: '0 10px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 8,
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                          zIndex: 2,
                          boxShadow: '0 2px 6px rgba(0,0,0,0.18)',
                        }}
                        title={`${stay.title} (${stay.nights} nights)`}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, overflow: 'hidden' }}>
                          <Hotel size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                          <span style={{ fontWeight: 700, fontSize: '0.82rem', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {stay.title}
                          </span>
                        </div>
                        <span className="badge accent" style={{ fontSize: '0.66rem', padding: '1px 6px', flexShrink: 0 }}>
                          {stay.nights} {stay.nights === 1 ? 'night' : 'nights'}
                        </span>
                      </div>
                    );
                  })}

                  {/* Lodging Gap Indicators */}
                  {lodgingGaps.map((gapDayIdx) => (
                    <div
                      key={`gap-${gapDayIdx}`}
                      onClick={() => openAddStayForGap(gapDayIdx)}
                      style={{
                        position: 'absolute',
                        left: gapDayIdx * colWidth + 6,
                        width: colWidth - 12,
                        top: 4,
                        height: barHeight,
                        background: 'repeating-linear-gradient(45deg, rgba(245, 158, 11, 0.08), rgba(245, 158, 11, 0.08) 6px, rgba(245, 158, 11, 0.16) 6px, rgba(245, 158, 11, 0.16) 12px)',
                        border: '1px dashed var(--warning, #f59e0b)',
                        borderRadius: 8,
                        padding: '0 8px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 4,
                        zIndex: 1,
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                      title={`No hotel booked for Day ${gapDayIdx + 1} night — click to add accommodation`}
                    >
                      <Plus size={12} style={{ color: 'var(--warning, #f59e0b)' }} />
                      <span style={{ fontSize: '0.72rem', color: 'var(--warning, #f59e0b)', fontWeight: 600 }}>
                        + Add Stay
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 3. TRACK: TRANSIT & FLIGHTS (✈️) */}
            {(trackFilter === 'all' || trackFilter === 'transit') && (
              <div style={{ borderBottom: '1px solid var(--line)', padding: '10px 0' }}>
                <div style={{ padding: '0 12px 6px', display: 'flex', alignItems: 'center', gap: 6, color: 'var(--muted)', fontSize: '0.74rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  <Plane size={13} style={{ color: '#818cf8' }} /> Transit & Travel Legs {totalTransitLanes > 1 ? `(${totalTransitLanes} Lanes)` : ''}
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(${timelineDays.length}, ${colWidth}px)`,
                    position: 'relative',
                    minHeight: transitTrackHeight,
                  }}
                >
                  {timelineDays.map((d) => (
                    <div key={d.dateStr} style={{ borderRight: '1px solid rgba(255,255,255,0.05)', minHeight: transitTrackHeight }} />
                  ))}

                  {transitSpans.map((transit) => {
                    const spanCols = Math.max(1, transit.endDayIndex - transit.startDayIndex + 1);
                    const leftPos = transit.startDayIndex * colWidth + 6;
                    const width = spanCols * colWidth - 12;
                    const lane = transit.laneIndex ?? 0;
                    const topPos = 4 + lane * (barHeight + barGap);
                    const theme = getTransitColors(transit.type);

                    // Extract short time label if available
                    let timeLabel: string | null = null;
                    if (transit.startTime) {
                      const m = transit.startTime.match(/(\d{1,2}:\d{2})/);
                      if (m) timeLabel = m[1];
                    }

                    return (
                      <div
                        key={transit.id}
                        onClick={() => setSelectedItem({ type: 'transit', title: transit.title, transit })}
                        style={{
                          position: 'absolute',
                          left: leftPos,
                          width,
                          top: topPos,
                          height: barHeight,
                          background: theme.bg,
                          border: `1px solid ${theme.border}`,
                          borderRadius: 8,
                          padding: '0 10px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: 8,
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                          zIndex: 2,
                          boxShadow: '0 2px 6px rgba(0,0,0,0.18)',
                        }}
                        title={transit.title}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, overflow: 'hidden' }}>
                          {getTransitIcon(transit.type)}
                          <span style={{ fontWeight: 700, fontSize: '0.82rem', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {transit.title}
                          </span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                          {timeLabel && (
                            <span className="badge" style={{ fontSize: '0.64rem', padding: '1px 5px', opacity: 0.9 }}>
                              <Clock size={9} style={{ marginRight: 2 }} /> {timeLabel}
                            </span>
                          )}
                          {transit.reference && (
                            <span className="badge" style={{ fontSize: '0.64rem', padding: '1px 5px', opacity: 0.85 }}>
                              {transit.reference}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 4. TRACK: DAILY ACTIVITIES & PLACES (📍) */}
            {(trackFilter === 'all' || trackFilter === 'activities') && (
              <div style={{ padding: '12px 0' }}>
                <div style={{ padding: '0 12px 8px', display: 'flex', alignItems: 'center', gap: 6, color: 'var(--muted)', fontSize: '0.76rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  <Compass size={13} style={{ color: '#10b981' }} /> Daily Activities & Scheduled Stops
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(${timelineDays.length}, ${colWidth}px)`,
                  }}
                >
                  {timelineDays.map((day) => (
                    <div
                      key={day.dateStr}
                      style={{
                        padding: '6px 8px',
                        borderRight: '1px solid rgba(255,255,255,0.06)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                        minHeight: 120,
                      }}
                    >
                      {day.places.length === 0 ? (
                        <div className="small muted" style={{ fontStyle: 'italic', fontSize: '0.74rem', padding: '10px 4px', textAlign: 'center' }}>
                          No stops
                        </div>
                      ) : (
                        day.places.map((place, pIdx) => (
                          <div
                            key={place.id}
                            onClick={() => setSelectedItem({ type: 'place', title: place.name, place })}
                            style={{
                              background: 'var(--panel-2)',
                              border: '1px solid var(--line)',
                              borderRadius: 6,
                              padding: '6px 8px',
                              cursor: 'pointer',
                              display: 'flex',
                              flexDirection: 'column',
                              gap: 3,
                              transition: 'all 0.15s ease',
                            }}
                            title={place.name}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                              <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--accent)' }}>
                                #{pIdx + 1}
                              </span>
                              <span style={{ fontSize: '0.8rem', marginRight: 2 }}>
                                {getCategoryIcon(place.category, place.name)}
                              </span>
                              <span
                                style={{
                                  fontWeight: 600,
                                  fontSize: '0.8rem',
                                  color: 'var(--text)',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {place.name}
                              </span>
                            </div>

                            {place.startTime && (
                              <div className="small muted" style={{ fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: 3 }}>
                                <Clock size={10} /> {place.startTime} {place.endTime ? `– ${place.endTime}` : ''}
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* LODGING GAP QUICK ADD MODAL */}
      {gapAddModal && (
        <Modal title="Add Accommodation for Gap" onClose={() => setGapAddModal(null)}>
          <div className="field">
            <label>Hotel / Property Name</label>
            <input
              value={bookingForm.title}
              onChange={(e) => setBookingForm({ ...bookingForm, title: e.target.value })}
              placeholder="e.g. Grand Hotel Flora, Airbnb Villa"
              autoFocus
            />
          </div>
          <div className="grid grid-2">
            <div className="field">
              <label>Provider / Host</label>
              <input
                value={bookingForm.provider}
                onChange={(e) => setBookingForm({ ...bookingForm, provider: e.target.value })}
                placeholder="e.g. Booking.com, Marriott"
              />
            </div>
            <div className="field">
              <label>Confirmation Reference</label>
              <input
                value={bookingForm.reference}
                onChange={(e) => setBookingForm({ ...bookingForm, reference: e.target.value })}
                placeholder="e.g. HTL-98765"
              />
            </div>
          </div>
          <div className="grid grid-2">
            <div className="field">
              <label>Check-in Date & Time</label>
              <input
                type="datetime-local"
                value={bookingForm.startAt}
                onChange={(e) => {
                  const startAt = e.target.value;
                  setBookingForm({ ...bookingForm, startAt, endAt: endForStart(startAt, bookingForm.endAt) });
                }}
              />
            </div>
            <div className="field">
              <label>Check-out Date & Time</label>
              <input
                type="datetime-local"
                min={bookingForm.startAt || undefined}
                value={bookingForm.endAt}
                onChange={(e) => setBookingForm({ ...bookingForm, endAt: e.target.value })}
              />
            </div>
          </div>
          <div className="modal-actions">
            <button className="btn primary" onClick={saveBookingForm} disabled={busy || !bookingForm.title}>
              {busy ? 'Saving…' : 'Add Accommodation'}
            </button>
            <button className="btn" onClick={() => setGapAddModal(null)}>Cancel</button>
          </div>
        </Modal>
      )}

      {/* EDIT BOOKING MODAL */}
      {editingBooking && (
        <Modal title={`Edit ${editingBooking.type === 'hotel' ? 'Accommodation' : editingBooking.type === 'flight' ? 'Flight' : 'Reservation'}`} onClose={() => setEditingBooking(null)}>
          <div className="field">
            <label>Title / Property Name</label>
            <input
              value={bookingForm.title}
              onChange={(e) => setBookingForm({ ...bookingForm, title: e.target.value })}
              autoFocus
            />
          </div>
          <div className="grid grid-2">
            <div className="field">
              <label>Provider / Company / Host</label>
              <input
                value={bookingForm.provider}
                onChange={(e) => setBookingForm({ ...bookingForm, provider: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Confirmation Reference</label>
              <input
                value={bookingForm.reference}
                onChange={(e) => setBookingForm({ ...bookingForm, reference: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-2">
            <div className="field">
              <label>{bookingForm.type === 'hotel' ? 'Check-in Date & Time' : bookingForm.type === 'flight' ? 'Departure Date & Time' : 'Starts (Date & Time)'}</label>
              <input
                type="datetime-local"
                value={bookingForm.startAt}
                onChange={(e) => {
                  const startAt = e.target.value;
                  setBookingForm({ ...bookingForm, startAt, endAt: endForStart(startAt, bookingForm.endAt) });
                }}
              />
            </div>
            <div className="field">
              <label>{bookingForm.type === 'hotel' ? 'Check-out Date & Time' : bookingForm.type === 'flight' ? 'Arrival Date & Time' : 'Ends (Date & Time)'}</label>
              <input
                type="datetime-local"
                min={bookingForm.startAt || undefined}
                value={bookingForm.endAt}
                onChange={(e) => setBookingForm({ ...bookingForm, endAt: e.target.value })}
              />
            </div>
          </div>
          <div className="modal-actions">
            <button className="btn primary" onClick={saveBookingForm} disabled={busy || !bookingForm.title}>
              {busy ? 'Saving…' : 'Save Changes'}
            </button>
            <button className="btn" onClick={() => setEditingBooking(null)}>Cancel</button>
          </div>
        </Modal>
      )}

      {/* INSPECTION MODAL */}
      {selectedItem && (
        <Modal title={selectedItem.title} onClose={() => setSelectedItem(null)} wide>
          {selectedItem.type === 'stay' && selectedItem.stay && (
            <div>
              <div className="row mb-3" style={{ gap: 8, alignItems: 'center' }}>
                <span className="badge accent"><Hotel size={13} style={{ marginRight: 4 }} /> Hotel / Stay</span>
                <span className="badge ok">{selectedItem.stay.nights} {selectedItem.stay.nights === 1 ? 'Night' : 'Nights'}</span>
                {selectedItem.stay.provider && <span className="badge">{selectedItem.stay.provider}</span>}
              </div>

              {selectedItem.stay.reference && (
                <div className="field mb-3">
                  <label>Confirmation Reference</label>
                  <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text)' }}>
                    {selectedItem.stay.reference}
                  </div>
                </div>
              )}

              {selectedItem.stay.booking?.startAt && (
                <div className="grid grid-2 mb-3">
                  <div>
                    <label className="small muted">Check-In</label>
                    <div style={{ fontWeight: 600 }}>{formatBookingDateTime(selectedItem.stay.booking.startAt)}</div>
                  </div>
                  {selectedItem.stay.booking?.endAt && (
                    <div>
                      <label className="small muted">Check-Out</label>
                      <div style={{ fontWeight: 600 }}>{formatBookingDateTime(selectedItem.stay.booking.endAt)}</div>
                    </div>
                  )}
                </div>
              )}

              {selectedItem.stay.place?.address && (
                <div className="field mb-3">
                  <label>Address</label>
                  <div className="row" style={{ gap: 6 }}>
                    <MapPin size={14} style={{ color: 'var(--accent)', marginTop: 2 }} />
                    <span>{selectedItem.stay.place.address}</span>
                  </div>
                </div>
              )}

              {selectedItem.stay.place?.description && (
                <div className="field mb-3">
                  <label>Description & Directions</label>
                  <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.88rem' }}>
                    {selectedItem.stay.place.description}
                  </div>
                </div>
              )}
            </div>
          )}

          {selectedItem.type === 'transit' && selectedItem.transit && (
            <div>
              <div className="row mb-3" style={{ gap: 8, alignItems: 'center' }}>
                <span className="badge" style={{ background: 'rgba(99, 102, 241, 0.15)', color: '#818cf8', borderColor: 'rgba(99, 102, 241, 0.3)' }}>
                  {getTransitIcon(selectedItem.transit.type)}
                  <span style={{ marginLeft: 4, textTransform: 'capitalize' }}>{selectedItem.transit.type} Leg</span>
                </span>
                {selectedItem.transit.provider && <span className="badge">{selectedItem.transit.provider}</span>}
              </div>

              {selectedItem.transit.reference && (
                <div className="field mb-3">
                  <label>Booking / Flight Reference</label>
                  <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text)' }}>
                    {selectedItem.transit.reference}
                  </div>
                </div>
              )}

              {selectedItem.transit.booking?.startAt && (
                <div className="grid grid-2 mb-3">
                  <div>
                    <label className="small muted">Departure</label>
                    <div style={{ fontWeight: 600 }}>{formatBookingDateTime(selectedItem.transit.booking.startAt)}</div>
                  </div>
                  {selectedItem.transit.booking?.endAt && (
                    <div>
                      <label className="small muted">Arrival</label>
                      <div style={{ fontWeight: 600 }}>{formatBookingDateTime(selectedItem.transit.booking.endAt)}</div>
                    </div>
                  )}
                </div>
              )}

              {selectedItem.transit.place?.description && (
                <div className="field mb-3">
                  <label>Route & Directions</label>
                  <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.88rem' }}>
                    {selectedItem.transit.place.description}
                  </div>
                </div>
              )}
            </div>
          )}

          {selectedItem.type === 'place' && selectedItem.place && (
            <div>
              <div className="row mb-3" style={{ gap: 8, alignItems: 'center' }}>
                {selectedItem.place.category && (
                  <span className="badge accent">
                    {getCategoryIcon(selectedItem.place.category, selectedItem.place.name)} {selectedItem.place.category}
                  </span>
                )}
                {selectedItem.place.startTime && (
                  <span className="badge">
                    <Clock size={12} style={{ marginRight: 3 }} /> {selectedItem.place.startTime} {selectedItem.place.endTime ? `– ${selectedItem.place.endTime}` : ''}
                  </span>
                )}
              </div>

              {selectedItem.place.address && (
                <div className="field mb-3">
                  <label>Address</label>
                  <div className="row" style={{ gap: 6 }}>
                    <MapPin size={14} style={{ color: 'var(--accent)', marginTop: 2 }} />
                    <span>{selectedItem.place.address}</span>
                  </div>
                </div>
              )}

              {selectedItem.place.description && (
                <div className="field mb-3">
                  <label>Description</label>
                  <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.88rem' }}>
                    {selectedItem.place.description}
                  </div>
                </div>
              )}

              {selectedItem.place.notes && (
                <div className="field mb-3">
                  <label>Notes</label>
                  <div style={{ whiteSpace: 'pre-wrap', fontSize: '0.88rem' }}>
                    ✏️ {selectedItem.place.notes}
                  </div>
                </div>
              )}

              {selectedItem.place.website && (
                <div className="field mb-3">
                  <label>Website</label>
                  <div>
                    <a href={selectedItem.place.website} target="_blank" rel="noreferrer" className="link small" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      {selectedItem.place.website} <ExternalLink size={12} />
                    </a>
                  </div>
                </div>
              )}

              {(selectedItem.place.createdBy || selectedItem.place.updatedBy) && (
                <div style={{ marginTop: 12, paddingTop: 8, borderTop: '1px solid var(--line)', display: 'flex', justifyContent: 'flex-end' }}>
                  <AuditBadge createdBy={selectedItem.place.createdBy} createdAt={selectedItem.place.createdAt} updatedBy={selectedItem.place.updatedBy} updatedAt={selectedItem.place.updatedAt} />
                </div>
              )}
            </div>
          )}

          <div className="modal-actions">
            {selectedItem.type === 'stay' && selectedItem.stay?.booking && (
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  const b = selectedItem.stay!.booking!;
                  setSelectedItem(null);
                  openEditBooking(b);
                }}
              >
                <Pencil size={13} style={{ marginRight: 4 }} /> Edit Stay
              </button>
            )}
            {selectedItem.type === 'transit' && selectedItem.transit?.booking && (
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  const b = selectedItem.transit!.booking!;
                  setSelectedItem(null);
                  openEditBooking(b);
                }}
              >
                <Pencil size={13} style={{ marginRight: 4 }} /> Edit Flight / Booking
              </button>
            )}
            <button type="button" className="btn" onClick={() => setSelectedItem(null)}>
              Close
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
