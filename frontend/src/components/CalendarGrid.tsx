import type { CalendarEvent } from '../lib/types';

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function iso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
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
              const dot = e.type === 'place' ? 'P' : e.bookingType === 'flight' ? '✈' : e.bookingType === 'hotel' ? '🛏' : e.bookingType === 'car' ? '🚗' : '🗓';
              return (
                <div
                  key={e.id}
                  className={`cal-event ${e.type === 'place' ? 'place' : 'booking'}`}
                  draggable
                  onClick={(ev) => ev.stopPropagation()}
                  onDragStart={(ev) => {
                    ev.dataTransfer.setData('text/plain', e.id);
                    ev.dataTransfer.effectAllowed = 'move';
                  }}
                  title={tripNames.get(e.tripId) ?? e.tripId}
                >
                  <span className="pill">{dot}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.title}</span>
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