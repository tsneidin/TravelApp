import { useNavigate } from 'react-router-dom';
import type { CalendarEvent } from '../lib/types';
import { getCategoryIcon } from '../lib/icons';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function iso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatCalendarTitle(rawTitle: string, type?: 'place' | 'booking' | 'todo' | string, bookingType?: string): string {
  let title = (rawTitle || '').trim();
  if (!title) return type === 'booking' ? 'Reservation' : type === 'todo' ? 'To-Do' : 'Place';

  // 1. Remove leading unicode symbols/emojis
  title = title.replace(/^[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1FA00}-\u{1FAFF}\s]+/u, '').trim();

  // 2. Remove common redundant prefixes
  title = title.replace(/^(?:flight|hotel|lodging|stay|car\s+rental|train|ferry|tour|activity|reservation|booking|ticket|visit|dinner\s+at|lunch\s+at|breakfast\s+at)\s*(?::|-|–|—|at|for|to|\b)\s*/i, '').trim();

  // 3. Remove trailing confirmation codes / references
  title = title.replace(/\s*[-–—|]\s*(?:conf(?:irmation)?|ref(?:erence)?|booking|code|pnr|res|id|ticket)?\s*#?\s*[A-Z0-9]{4,}\s*$/i, '').trim();
  title = title.replace(/\s*\((?:conf(?:irmation)?|ref(?:erence)?|booking|code|pnr|ticket)?\s*#?\s*[A-Z0-9]{4,}\)\s*$/i, '').trim();

  // 4. Flight airport routes: ORD -> FCO or ORD → FCO or ORD to FCO
  const airportRouteMatch = title.match(/\b([A-Z]{3})\s*(?:→|->|to|-)\s*([A-Z]{3})\b/i);
  if (airportRouteMatch) {
    return `${airportRouteMatch[1].toUpperCase()} → ${airportRouteMatch[2].toUpperCase()}`;
  }

  // 5. City-to-city flight routes: "Chicago to Rome"
  const cityRouteMatch = title.match(/^([A-Za-z\s]+?)\s*(?:→|->|to)\s*([A-Za-z\s]+?)(?:\s*\((?:[A-Z]{3})\))?$/i);
  if (cityRouteMatch && (bookingType === 'flight' || /flight/i.test(rawTitle))) {
    const origin = cityRouteMatch[1].trim();
    const dest = cityRouteMatch[2].trim();
    if (origin.length <= 15 && dest.length <= 15) {
      return `${origin} → ${dest}`;
    }
  }

  // 6. Strip street address details if present after a comma
  if (title.includes(',') && !/\b(?:LLC|Inc|SA|SRL)\b/i.test(title)) {
    const parts = title.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length > 1 && parts[0].length >= 3 && !/^\d+/.test(parts[0])) {
      title = parts[0];
    }
  }

  // 7. Strip leading "to " if remaining (e.g. "to Naples (NAP)")
  title = title.replace(/^to\s+/i, '').trim();

  // 8. Truncate cleanly if still long (> 28 chars)
  if (title.length > 28) {
    const segments = title.split(/\s*[:–—|-]\s*/);
    if (segments.length > 1 && segments[0].length >= 4 && segments[0].length <= 26) {
      return segments[0].trim();
    }
    return title.slice(0, 27).trim() + '…';
  }

  return title;
}

export function CalendarGrid({
  year,
  month,
  events,
  tripNames,
  onSelectDate,
  onMoveEvent,
}: {
  year: number;
  month: number;
  events: CalendarEvent[];
  tripNames: Map<string, string>;
  onSelectDate: (date: string) => void;
  onMoveEvent: (ev: CalendarEvent, targetDate: string) => void;
}) {
  const navigate = useNavigate();
  const first = new Date(year, month, 1);
  const startDow = first.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayIso = iso(new Date());

  const byDate: Record<string, CalendarEvent[]> = {};
  for (const e of events) (byDate[e.date] ??= []).push(e);
  for (const k in byDate) byDate[k].sort((a, b) => a.sortOrder - b.sortOrder);

  const cells: (string | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(iso(new Date(year, month, d)));

  const handleEventClick = (ev: React.MouseEvent, e: CalendarEvent) => {
    ev.stopPropagation();
    if (e.type === 'todo') {
      navigate(`/trips/${e.tripId}?tab=todos`);
    } else if (e.type === 'place' && e.placeId) {
      navigate(`/trips/${e.tripId}?tab=itinerary#place-${e.placeId}`);
    } else if (e.type === 'booking') {
      if (e.dayId) {
        navigate(`/trips/${e.tripId}?tab=itinerary#day-${e.dayId}`);
      } else {
        const bookingId = e.id.replace(/^b-/, '');
        navigate(`/trips/${e.tripId}?tab=bookings#booking-${bookingId}`);
      }
    } else if (e.dayId) {
      navigate(`/trips/${e.tripId}?tab=itinerary#day-${e.dayId}`);
    } else {
      navigate(`/trips/${e.tripId}?tab=itinerary`);
    }
  };

  return (
    <div className="cal-grid">
      {DOW.map((d) => (
        <div key={d} className="cal-dow">
          {d}
        </div>
      ))}
      {cells.map((date, i) =>
        date === null ? (
          <div key={`e${i}`} className="cal-cell empty" />
        ) : (
          <div
            key={date}
            className={`cal-cell ${date === todayIso ? 'today' : ''}`}
            onClick={() => onSelectDate(date)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData('text/plain');
              const ev = events.find((x) => x.id === id);
              if (ev && ev.date !== date) onMoveEvent(ev, date);
            }}
            style={{ cursor: 'pointer' }}
          >
            <div className="day-num">{Number(date.slice(8))}</div>
            {(byDate[date] ?? []).slice(0, 5).map((e) => {
              const dot = getCategoryIcon(e.category, e.title, e.type, e.bookingType);
              const displayTitle = formatCalendarTitle(e.title, e.type, e.bookingType);
              const tripName = tripNames.get(e.tripId);
              const tooltip = tripName ? `${tripName} • ${e.title}` : e.title;

              return (
                <div
                  key={e.id}
                  className={`cal-event ${e.type === 'place' ? 'place' : 'booking'}`}
                  draggable
                  onClick={(ev) => handleEventClick(ev, e)}
                  onDragStart={(ev) => {
                    ev.dataTransfer.setData('text/plain', e.id);
                    ev.dataTransfer.effectAllowed = 'move';
                  }}
                  title={`${tooltip} (Click to open in itinerary)`}
                >
                  <span className="pill">{dot}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayTitle}</span>
                </div>
              );
            })}
            {(byDate[date] ?? []).length > 5 && (
              <div className="small muted">+{(byDate[date] ?? []).length - 5} more</div>
            )}
          </div>
        ),
      )}
    </div>
  );
}