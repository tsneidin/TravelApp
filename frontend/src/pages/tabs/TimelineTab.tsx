import { useMemo, useState } from 'react';
import {
  Calendar, Clock, MapPin, Plane, Hotel, Compass, AlertCircle,
  ZoomIn, ZoomOut, Filter, ExternalLink
} from 'lucide-react';
import type { Trip, Booking, Place, Day } from '../../lib/types';
import { Modal } from '../../components/Modal';
import { AuditBadge } from '../../components/AuditBadge';
import { getCategoryIcon } from '../../lib/icons';

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
}

interface TransitSpan {
  id: string;
  title: string;
  type: 'flight' | 'train' | 'car' | 'transit';
  provider?: string | null;
  reference?: string | null;
  startDayIndex: number;
  endDayIndex: number;
  startTime?: string | null;
  endTime?: string | null;
  booking?: Booking;
  place?: Place;
}

function parseDateKey(val?: string | null): string | null {
  if (!val) return null;
  const m = val.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

export function TimelineTab({ trip }: TimelineTabProps) {
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

      // Extract places for this day
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

  // 2. Map Stays / Accommodations across the timeline
  const staySpans = useMemo<StaySpan[]>(() => {
    if (timelineDays.length === 0) return [];
    const dateToIndex = new Map<string, number>();
    timelineDays.forEach((d, idx) => dateToIndex.set(d.dateStr, idx));

    const stays: StaySpan[] = [];

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
        stays.push({
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
          // Only add if not already captured by booking
          const exists = stays.some(
            (s) => s.title.toLowerCase().includes(p.name.toLowerCase()) || p.name.toLowerCase().includes(s.title.toLowerCase())
          );
          if (!exists) {
            stays.push({
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

    return stays;
  }, [timelineDays, trip.bookings]);

  // 3. Map Transit / Flights across the timeline
  const transitSpans = useMemo<TransitSpan[]>(() => {
    if (timelineDays.length === 0) return [];
    const dateToIndex = new Map<string, number>();
    timelineDays.forEach((d, idx) => dateToIndex.set(d.dateStr, idx));

    const transits: TransitSpan[] = [];

    // Check transit bookings (flight, car, train)
    for (const b of trip.bookings ?? []) {
      if (b.type === 'flight' || b.type === 'car' || b.type === 'activity') {
        const sKey = parseDateKey(b.startAt);
        const eKey = parseDateKey(b.endAt);

        const startIdx = sKey && dateToIndex.has(sKey) ? dateToIndex.get(sKey)! : 0;
        let endIdx = eKey && dateToIndex.has(eKey) ? dateToIndex.get(eKey)! : startIdx;
        endIdx = Math.min(Math.max(startIdx, endIdx), timelineDays.length - 1);

        transits.push({
          id: b.id,
          title: b.title,
          type: b.type === 'flight' ? 'flight' : b.type === 'car' ? 'car' : 'transit',
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

    // Check transport places
    for (const d of timelineDays) {
      const dIdx = dateToIndex.get(d.dateStr) ?? 0;
      for (const p of d.places) {
        const cat = (p.category || '').toLowerCase();
        if (cat === 'transport' || cat === 'transit' || cat === 'flight') {
          transits.push({
            id: p.id,
            title: p.name,
            type: p.name.toLowerCase().includes('flight') || p.name.toLowerCase().includes('air') ? 'flight' : 'transit',
            startDayIndex: dIdx,
            endDayIndex: dIdx,
            startTime: p.startTime,
            endTime: p.endTime,
            place: p,
          });
        }
      }
    }

    return transits;
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
              <div style={{ borderBottom: '1px solid var(--line)', padding: '12px 0' }}>
                <div style={{ padding: '0 12px 8px', display: 'flex', alignItems: 'center', gap: 6, color: 'var(--muted)', fontSize: '0.76rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  <Hotel size={13} style={{ color: 'var(--accent)' }} /> Stays & Accommodations
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(${timelineDays.length}, ${colWidth}px)`,
                    position: 'relative',
                    minHeight: 50,
                  }}
                >
                  {/* Grid background vertical lines */}
                  {timelineDays.map((d) => (
                    <div key={d.dateStr} style={{ borderRight: '1px solid rgba(255,255,255,0.05)', minHeight: 48 }} />
                  ))}

                  {/* Render Lodging Spanning Bars */}
                  {staySpans.map((stay) => {
                    const spanCols = Math.max(1, stay.endDayIndex - stay.startDayIndex);
                    const leftPos = stay.startDayIndex * colWidth + 6;
                    const width = spanCols * colWidth - 12;

                    return (
                      <div
                        key={stay.id}
                        onClick={() => setSelectedItem({ type: 'stay', title: stay.title, stay })}
                        style={{
                          position: 'absolute',
                          left: leftPos,
                          width,
                          top: 4,
                          height: 38,
                          background: 'linear-gradient(135deg, rgba(34, 211, 238, 0.22), rgba(56, 189, 248, 0.14))',
                          border: '1px solid var(--accent)',
                          borderRadius: 8,
                          padding: '4px 10px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                          zIndex: 2,
                          boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
                        }}
                        title={`${stay.title} (${stay.nights} nights)`}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                          <Hotel size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                          <span style={{ fontWeight: 700, fontSize: '0.84rem', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {stay.title}
                          </span>
                        </div>
                        <span className="badge accent" style={{ fontSize: '0.68rem', padding: '1px 6px', flexShrink: 0 }}>
                          {stay.nights} {stay.nights === 1 ? 'night' : 'nights'}
                        </span>
                      </div>
                    );
                  })}

                  {/* Lodging Gap Indicators */}
                  {lodgingGaps.map((gapDayIdx) => (
                    <div
                      key={`gap-${gapDayIdx}`}
                      style={{
                        position: 'absolute',
                        left: gapDayIdx * colWidth + 6,
                        width: colWidth - 12,
                        top: 4,
                        height: 38,
                        background: 'repeating-linear-gradient(45deg, rgba(245, 158, 11, 0.08), rgba(245, 158, 11, 0.08) 6px, rgba(245, 158, 11, 0.16) 6px, rgba(245, 158, 11, 0.16) 12px)',
                        border: '1px dashed var(--warning, #f59e0b)',
                        borderRadius: 8,
                        padding: '4px 8px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 4,
                        zIndex: 1,
                      }}
                      title={`No hotel booked for Day ${gapDayIdx + 1} night`}
                    >
                      <AlertCircle size={12} style={{ color: 'var(--warning, #f59e0b)' }} />
                      <span style={{ fontSize: '0.72rem', color: 'var(--warning, #f59e0b)', fontWeight: 600 }}>
                        No Lodging
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 3. TRACK: TRANSIT & FLIGHTS (✈️) */}
            {(trackFilter === 'all' || trackFilter === 'transit') && (
              <div style={{ borderBottom: '1px solid var(--line)', padding: '12px 0' }}>
                <div style={{ padding: '0 12px 8px', display: 'flex', alignItems: 'center', gap: 6, color: 'var(--muted)', fontSize: '0.76rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  <Plane size={13} style={{ color: '#38bdf8' }} /> Transit & Travel Legs
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(${timelineDays.length}, ${colWidth}px)`,
                    position: 'relative',
                    minHeight: 50,
                  }}
                >
                  {timelineDays.map((d) => (
                    <div key={d.dateStr} style={{ borderRight: '1px solid rgba(255,255,255,0.05)', minHeight: 48 }} />
                  ))}

                  {transitSpans.map((transit) => {
                    const spanCols = Math.max(1, transit.endDayIndex - transit.startDayIndex + 1);
                    const leftPos = transit.startDayIndex * colWidth + 6;
                    const width = spanCols * colWidth - 12;

                    return (
                      <div
                        key={transit.id}
                        onClick={() => setSelectedItem({ type: 'transit', title: transit.title, transit })}
                        style={{
                          position: 'absolute',
                          left: leftPos,
                          width,
                          top: 4,
                          height: 38,
                          background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.22), rgba(56, 189, 248, 0.16))',
                          border: '1px solid #818cf8',
                          borderRadius: 8,
                          padding: '4px 10px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                          zIndex: 2,
                          boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
                        }}
                        title={transit.title}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                          <Plane size={14} style={{ color: '#818cf8', flexShrink: 0 }} />
                          <span style={{ fontWeight: 700, fontSize: '0.84rem', color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {transit.title}
                          </span>
                        </div>
                        {transit.reference && (
                          <span className="badge" style={{ fontSize: '0.68rem', padding: '1px 6px', flexShrink: 0, opacity: 0.85 }}>
                            Ref: {transit.reference}
                          </span>
                        )}
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
                    <div>{new Date(selectedItem.stay.booking.startAt).toLocaleString()}</div>
                  </div>
                  {selectedItem.stay.booking?.endAt && (
                    <div>
                      <label className="small muted">Check-Out</label>
                      <div>{new Date(selectedItem.stay.booking.endAt).toLocaleString()}</div>
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
                  <Plane size={13} style={{ marginRight: 4 }} /> Transit Leg
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
                    <div>{new Date(selectedItem.transit.booking.startAt).toLocaleString()}</div>
                  </div>
                  {selectedItem.transit.booking?.endAt && (
                    <div>
                      <label className="small muted">Arrival</label>
                      <div>{new Date(selectedItem.transit.booking.endAt).toLocaleString()}</div>
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
            <button type="button" className="btn primary" onClick={() => setSelectedItem(null)}>
              Close
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
