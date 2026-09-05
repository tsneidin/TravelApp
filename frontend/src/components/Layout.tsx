import { useEffect, useState } from 'react';
import { NavLink, Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Plane, CalendarDays, Inbox, LogOut, User, Plus,
  ChevronRight, ChevronDown,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { APP_VERSION } from '../lib/version';
import { apiGet } from '../lib/api';
import { AIChat } from './AIChat';
import type { Trip } from '../lib/types';

const TRIP_TABS: { key: string; label: string }[] = [
  { key: 'itinerary', label: 'Itinerary' },
  { key: 'map', label: 'Map' },
  { key: 'budget', label: 'Budget' },
  { key: 'photos', label: 'Photos & journal' },
  { key: 'packing', label: 'Packing' },
  { key: 'bookings', label: 'Bookings' },
];

function hashHue(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

function cleanCityToken(tok: string): string | null {
  if (!tok) return null;
  let c = tok.trim();

  // Strip leading postal codes (e.g. "84091 Battipaglia SA" -> "Battipaglia SA", "75001 Paris" -> "Paris", "I-84091 Battipaglia" -> "Battipaglia")
  c = c.replace(/^(?:[A-Z]{1,2}-)?\d{4,6}\s+/, '');
  // Strip trailing postal codes (e.g. "Chicago 60613" -> "Chicago")
  c = c.replace(/\s+\d{5}(?:-\d{4})?$/, '');
  // Strip trailing 2-letter state / province codes (e.g. "Battipaglia SA" -> "Battipaglia", "Chicago IL" -> "Chicago")
  c = c.replace(/\s+[A-Z]{2}$/, '');
  // Strip leading numbers e.g. "1060 W Addison"
  c = c.replace(/^\d+[\s\w]*\s+/, '');

  c = c.trim();
  if (c.length >= 2 && c.length <= 35 && !/^\d+$/.test(c)) {
    return c;
  }
  return null;
}

function extractCityFromLocation(raw?: string | null): string | null {
  if (!raw) return null;
  let s = raw.trim();
  if (!s) return null;

  // Ignore raw coordinates e.g. "40.853, 14.268" or "40.85321,-73.9872"
  if (/^-?\d+\.\d+,\s*-?\d+\.\d+$/.test(s)) return null;

  // If contains flight arrow "A -> B" or "A → B", take the destination
  if (/→|->/.test(s)) {
    const parts = s.split(/→|->/);
    s = parts[parts.length - 1].trim();
  }

  // Remove airport / station suffixes like "Naples Airport (NAP)" -> "Naples"
  s = s.replace(/\s*\([A-Z]{3}\)/g, '');
  s = s.replace(/\s+(?:International\s+)?Airport\b/gi, '');
  s = s.replace(/\s+(?:Central\s+)?Station\b/gi, '');
  s = s.replace(/\s+Terminal\b/gi, '');

  // Strip carrier prefixes and action words like "Operated by Envoy Air Chicago" -> "Chicago"
  s = s.replace(/^Operated\s+by[^\n]*\n+/i, '');
  s = s.replace(/^Operated\s+by\s+(?:Envoy\s+Air|SkyWest|American\s+Eagle|[A-Za-z\s]+?)\s+(?=[A-Z][a-z]+)/i, '');
  s = s.replace(/^(?:Arrive|Arrival|Depart|Departure|From|To|At|In)\s+/i, '');
  s = s.replace(/^[A-Za-z]\s+/i, ''); // stray single letter OCR artifact

  // Comma separated e.g. "Via Spineta, 84091 Battipaglia SA, Italy" or "Naples, Italy"
  const tokens = s.split(',').map((t) => t.trim()).filter(Boolean);

  if (tokens.length >= 2) {
    if (tokens.length === 2) {
      const city = cleanCityToken(tokens[0]);
      if (city) return city;
    }

    // If 3+ tokens, e.g. ["Via Spineta", "84091 Battipaglia SA", "Italy"]
    // Inspect tokens starting from penultimate backwards (skipping country)
    for (let i = tokens.length - 2; i >= 0; i--) {
      // Don't treat street names (e.g. "Via Spineta", "123 Main St") as city
      if (/^(?:via|viale|corso|piazza|strada|rue|calle|street|st|ave|avenue|blvd|rd|road|\d+)\b/i.test(tokens[i])) {
        continue;
      }
      const city = cleanCityToken(tokens[i]);
      if (city) return city;
    }

    // Fallback to cleaning the penultimate token
    const fallback = cleanCityToken(tokens[tokens.length - 2]);
    if (fallback) return fallback;
  }

  // Single token: only return if it looks like a city, not a business/hotel name
  if (tokens.length === 1) {
    if (/\b(hotel|b&b|albergo|resort|hostel|inn|motel|restaurant|ristorante|bar|cafe|pizzeria|trattoria|shop|store|museum|park)\b/i.test(tokens[0])) {
      return null;
    }
    const clean = cleanCityToken(tokens[0]);
    if (clean && !/^\d+/.test(clean)) return clean;
  }

  return null;
}

function getLastCityForDay(day?: { places?: { name?: string; address?: string | null }[] }): string | null {
  if (!day?.places || day.places.length === 0) return null;
  for (let i = day.places.length - 1; i >= 0; i--) {
    const p = day.places[i];
    const fromAddr = extractCityFromLocation(p.address);
    if (fromAddr && fromAddr.length >= 2 && fromAddr.length <= 30) return fromAddr;

    const fromName = extractCityFromLocation(p.name);
    if (fromName && fromName.length >= 2 && fromName.length <= 30) return fromName;
  }
  return null;
}

function formatSidebarDate(dateVal: string | Date): string {
  const str = typeof dateVal === 'string' ? dateVal : dateVal.toISOString();
  const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(str);
  const d = ymd
    ? new Date(parseInt(ymd[1], 10), parseInt(ymd[2], 10) - 1, parseInt(ymd[3], 10), 12, 0, 0)
    : new Date(dateVal);
  const weekday = d.toLocaleDateString(undefined, { weekday: 'short' });
  const month = d.toLocaleDateString(undefined, { month: 'short' });
  const dayNum = d.getDate();
  return `${weekday} ${month} ${dayNum}`;
}

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [trips, setTrips] = useState<Trip[]>([]);

  const routeMatch = location.pathname.match(/^\/trips\/([^/]+)/);
  const activeTripId = routeMatch?.[1];
  const activeTab = new URLSearchParams(location.search).get('tab') ?? 'itinerary';
  const activeDayId = location.hash.startsWith('#day-') ? location.hash.slice(5) : null;

  const [collapsedItineraries, setCollapsedItineraries] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('travelapp_collapsed_itin');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const toggleItineraryCollapse = (tripId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setCollapsedItineraries((prev) => {
      const next = { ...prev, [tripId]: !prev[tripId] };
      try {
        localStorage.setItem('travelapp_collapsed_itin', JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  // Refresh the trip folder list whenever the route changes or data mutates so the tree stays current.
  useEffect(() => {
    let alive = true;
    const fetchTrips = () => {
      apiGet<{ trips: Trip[] }>('/trips')
        .then((r) => alive && setTrips(r.trips))
        .catch(() => alive && setTrips([]));
    };
    fetchTrips();

    const onTripUpdated = (e: Event) => {
      const detail = (e as CustomEvent).detail as { trip?: Trip } | undefined;
      if (detail?.trip && alive) {
        setTrips((prev) => prev.map((t) => (t.id === detail.trip!.id ? { ...t, ...detail.trip } : t)));
      }
    };

    window.addEventListener('travelapp:trip-updated', onTripUpdated);
    window.addEventListener('travelapp:mutated', fetchTrips);
    return () => {
      alive = false;
      window.removeEventListener('travelapp:trip-updated', onTripUpdated);
      window.removeEventListener('travelapp:mutated', fetchTrips);
    };
  }, [location.key]);

  return (
    <div className="app-frame">
      {/* ---------- Left folder tree (Wanderlog-style) ---------- */}
      <aside className="side-nav">
        <div className="side-brand">
          <Plane size={22} />
          <span>TravelApp</span>
        </div>

        <div className="side-section-label">Browse</div>
        <nav className="side-links">
          <NavLink to="/calendar" className={({ isActive }) => (isActive ? 'side-link active' : 'side-link')}>
            <CalendarDays size={18} />
            <span>Calendar</span>
          </NavLink>
          {user?.isAdmin && (
            <NavLink to="/email" className={({ isActive }) => (isActive ? 'side-link active' : 'side-link')}>
              <Inbox size={18} />
              <span>Email imports</span>
            </NavLink>
          )}
        </nav>

        <div className="side-section-label">
          <span>Trips</span>
          <button className="side-add-btn" title="New trip" onClick={() => navigate('/?new=1')}>
            <Plus size={14} />
          </button>
        </div>

        <div className="trip-tree">
          {trips.map((t) => {
            const expanded = t.id === activeTripId;
            return (
              <div className="trip-node" key={t.id}>
                <Link to={`/trips/${t.id}`} className={`trip-row ${expanded ? 'active' : ''}`}>
                  {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  <span className="trip-dot" style={{ background: `hsl(${hashHue(t.id)} 72% 55%)` }} />
                  <span className="trip-name">{t.name}</span>
                </Link>
                {expanded && (
                  <div className="trip-subnav">
                    {TRIP_TABS.map((tb) => (
                      <div key={tb.key}>
                        {tb.key === 'itinerary' ? (
                          <div className="side-tab-group">
                            <div className={`side-tab side-tab-parent ${activeTab === tb.key && !activeDayId ? 'active' : ''}`}>
                              <Link
                                to={`/trips/${t.id}?tab=${tb.key}`}
                                className="side-tab-link"
                              >
                                <span className="side-tab-dot" />
                                {tb.label}
                              </Link>
                              {(t.days ?? []).length > 0 && (
                                <button
                                  type="button"
                                  className="side-tab-collapse-btn"
                                  onClick={(e) => toggleItineraryCollapse(t.id, e)}
                                  title={collapsedItineraries[t.id] ? 'Expand itinerary days' : 'Collapse itinerary days'}
                                  aria-label={collapsedItineraries[t.id] ? 'Expand itinerary days' : 'Collapse itinerary days'}
                                >
                                  {collapsedItineraries[t.id] ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                                </button>
                              )}
                            </div>
                            {!collapsedItineraries[t.id] && (() => {
                              const sorted = [...(t.days ?? [])].sort(
                                (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime() || a.sortOrder - b.sortOrder,
                              );
                              const deduped: typeof sorted = [];
                              const seen = new Set<string>();
                              for (const day of sorted) {
                                const key = String(day.date).slice(0, 10);
                                if (!seen.has(key)) {
                                  seen.add(key);
                                  deduped.push(day);
                                }
                              }
                              let currentCity: string | null = null;
                              return deduped.map((day, index) => {
                                const dateStr = formatSidebarDate(day.date);
                                const explicitCity = getLastCityForDay(day);
                                if (explicitCity) {
                                  currentCity = explicitCity;
                                }
                                const displayCity = explicitCity || currentCity || t.destination || null;
                                return (
                                  <Link
                                    key={day.id}
                                    to={`/trips/${t.id}?tab=itinerary#day-${day.id}`}
                                    className={`side-tab side-day ${activeDayId === day.id ? 'active' : ''}`}
                                    title={`Day ${index + 1} · ${dateStr}${displayCity ? ` · ${displayCity}` : ''}`}
                                  >
                                    <span className="side-tab-dot" />
                                    <span className="side-day-num">{index + 1}</span>
                                    <span className="side-day-date">{dateStr}</span>
                                    {displayCity && <span className="side-day-city">{displayCity}</span>}
                                  </Link>
                                );
                              });
                            })()}
                          </div>
                        ) : (
                          <Link
                            to={`/trips/${t.id}?tab=${tb.key}`}
                            className={`side-tab ${activeTab === tb.key ? 'active' : ''}`}
                          >
                            <span className="side-tab-dot" />
                            {tb.label}
                          </Link>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {trips.length === 0 && (
            <div className="trip-empty muted small">No trips yet — use + to create one.</div>
          )}
        </div>

        <div className="side-spacer" />
        <div className="side-version" title={`Build ${APP_VERSION}`}>v{APP_VERSION}</div>

        <div className="side-user">
          <div className="side-avatar">{user?.name?.charAt(0)?.toUpperCase() ?? <User size={16} />}</div>
          <div className="side-user-info">
            <div className="side-user-name">{user?.name}</div>
            <div className="side-user-role">{user?.isAdmin ? 'Admin' : 'Member'}</div>
          </div>
          <button
            className="btn ghost icon-only sm"
            title="Log out"
            onClick={() => {
              logout();
              navigate('/login');
            }}
          >
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      {/* ---------- Content ---------- */}
      <main className="side-content">
        <Outlet />
      </main>

      {/* ---------- Right-side AI assistant ---------- */}
      <AIChat tripId={activeTripId ?? null} />
    </div>
  );
}