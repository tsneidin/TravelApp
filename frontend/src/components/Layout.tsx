import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Plane, LogOut } from 'lucide-react';
import { useAuth } from '../lib/auth';

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <>
      <nav className="topnav">
        <NavLink to="/" className="brand">
          <Plane size={20} /> TravelApp
        </NavLink>
        <div className="spacer" />
        <NavLink to="/calendar" className="nav-item">
          Calendar
        </NavLink>
        {user?.isAdmin && (
          <NavLink to="/email" className="nav-item">
            Email imports
          </NavLink>
        )}
        <span className="badge">{user?.name}</span>
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
      </nav>
      <Outlet />
    </>
  );
}