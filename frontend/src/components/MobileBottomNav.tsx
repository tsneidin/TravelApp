import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Calendar, Map as MapIcon, DollarSign, Ticket, MoreHorizontal,
  Camera, CheckSquare, Luggage, X, ChevronRight
} from 'lucide-react';
import type { Trip } from '../lib/types';

interface MobileBottomNavProps {
  tripId: string;
  activeTab: string;
  trip?: Trip | null;
}

export function MobileBottomNav({ tripId, activeTab, trip }: MobileBottomNavProps) {
  const [moreOpen, setMoreOpen] = useState(false);

  const primaryTabs = [
    { key: 'itinerary', label: 'Itinerary', icon: Calendar },
    { key: 'map', label: 'Map', icon: MapIcon },
    { key: 'budget', label: 'Budget', icon: DollarSign },
    { key: 'bookings', label: 'Bookings', icon: Ticket, count: trip?.bookings?.length },
  ];

  const secondaryTabs = [
    { key: 'photos', label: 'Photos & Journal', icon: Camera, desc: 'Photos, notes, and memory log' },
    { key: 'todos', label: "To-Do's", icon: CheckSquare, desc: 'Tasks and pre-trip checklists', count: trip?.todos?.length },
    { key: 'packing', label: 'Packing List', icon: Luggage, desc: 'Gear, baggage, and clothing', count: trip?.packing?.length },
  ];

  const isSecondaryActive = secondaryTabs.some((t) => t.key === activeTab);

  return (
    <>
      <nav className="mobile-bottom-nav" aria-label="Trip navigation">
        {primaryTabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <Link
              key={tab.key}
              to={`/trips/${tripId}?tab=${tab.key}`}
              className={`mobile-nav-item ${isActive ? 'active' : ''}`}
            >
              <div className="mobile-nav-icon-wrap">
                <Icon size={20} />
                {typeof tab.count === 'number' && tab.count > 0 && (
                  <span className="mobile-nav-badge">{tab.count}</span>
                )}
              </div>
              <span className="mobile-nav-label">{tab.label}</span>
            </Link>
          );
        })}

        {/* More Button */}
        <button
          type="button"
          className={`mobile-nav-item ${isSecondaryActive ? 'active' : ''}`}
          onClick={() => setMoreOpen(true)}
          aria-expanded={moreOpen}
          aria-label="More trip sections"
        >
          <div className="mobile-nav-icon-wrap">
            <MoreHorizontal size={20} />
            {isSecondaryActive && <span className="mobile-nav-dot" />}
          </div>
          <span className="mobile-nav-label">More</span>
        </button>
      </nav>

      {/* Slide-Up "More" Sheet */}
      {moreOpen && (
        <div className="mobile-more-overlay" onClick={() => setMoreOpen(false)}>
          <div
            className="mobile-more-sheet"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mobile-sheet-header">
              <div className="mobile-sheet-handle" />
              <div className="mobile-sheet-title-row">
                <h3>More Trip Sections</h3>
                <button
                  type="button"
                  className="mobile-sheet-close-btn"
                  onClick={() => setMoreOpen(false)}
                  aria-label="Close menu"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="mobile-more-list">
              {secondaryTabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.key;
                return (
                  <Link
                    key={tab.key}
                    to={`/trips/${tripId}?tab=${tab.key}`}
                    className={`mobile-more-item ${isActive ? 'active' : ''}`}
                    onClick={() => setMoreOpen(false)}
                  >
                    <div className="mobile-more-icon-box">
                      <Icon size={20} />
                    </div>
                    <div className="mobile-more-text">
                      <div className="mobile-more-name-row">
                        <span className="mobile-more-name">{tab.label}</span>
                        {typeof tab.count === 'number' && tab.count > 0 && (
                          <span className="badge sm accent">{tab.count}</span>
                        )}
                      </div>
                      <span className="mobile-more-desc">{tab.desc}</span>
                    </div>
                    <ChevronRight size={16} className="mobile-more-arrow" />
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
