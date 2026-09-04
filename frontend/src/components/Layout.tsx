import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Plane, LayoutDashboard, CalendarDays, Inbox, LogOut, User } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { APP_VERSION } from '../lib/version';

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="app-frame">
      {/* ---------- Left vertical sidebar (Wanderlog-style) ---------- */}
      <aside className="side-nav">
        <div className="side-brand">
          <Plane size={22} />
          <span>TravelApp</span>
        </div>

        <nav className="side-links">
          <NavLink to="/" className={({ isActive }) => (isActive ? 'side-link active' : 'side-link')}>
            <LayoutDashboard size={18} />
            <span>Trips</span>
          </NavLink>
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
    </div>
  );
}