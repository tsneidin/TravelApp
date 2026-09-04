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

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [trips, setTrips] = useState<Trip[]>([]);

  const routeMatch = location.pathname.match(/^\/trips\/([^/]+)/);
  const activeTripId = routeMatch?.[1];
  const activeTab = new URLSearchParams(location.search).get('tab') ?? 'itinerary';
  const activeDayId = location.hash.startsWith('#day-') ? location.hash.slice(5) : null;

  // Refresh the trip folder list whenever the route changes so the tree stays current.
  useEffect(() => {
    let alive = true;
    apiGet<{ trips: Trip[] }>('/trips')
      .then((r) => alive && setTrips(r.trips))
      .catch(() => alive && setTrips([]));
    return () => {
      alive = false;
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
                        <Link
                          to={`/trips/${t.id}?tab=${tb.key}`}
                          className={`side-tab ${activeTab === tb.key && !(tb.key === 'itinerary' && activeDayId) ? 'active' : ''}`}
                        >
                          <span className="side-tab-dot" />
                          {tb.label}
                        </Link>
                        {tb.key === 'itinerary' && [...(t.days ?? [])].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime() || a.sortOrder - b.sortOrder).map((day, index) => (
                          <Link
                            key={day.id}
                            to={`/trips/${t.id}?tab=itinerary#day-${day.id}`}
                            className={`side-tab side-day ${activeDayId === day.id ? 'active' : ''}`}
                          >
                            <span className="side-tab-dot" />
                            <span>Day {index + 1}</span>
                            <span className="muted small">
                              {new Date(day.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                            </span>
                          </Link>
                        ))}
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