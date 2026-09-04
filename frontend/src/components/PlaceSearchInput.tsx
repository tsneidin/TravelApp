import { useState, useEffect, useRef } from 'react';
import {
  Search, MapPin, Loader2, Utensils, Bed, Car, ShoppingBag,
  Sparkles, Landmark, X
} from 'lucide-react';
import { apiGet } from '../lib/api';
import type { GeocodedPlace } from '../lib/types';

interface PlaceSearchInputProps {
  onSelect: (place: GeocodedPlace) => void;
  biasLat?: number;
  biasLng?: number;
  placeholder?: string;
  autoFocus?: boolean;
}

function getCategoryIcon(category: string) {
  switch (category) {
    case 'Restaurant':
      return <Utensils size={14} className="cat-icon cat-restaurant" />;
    case 'Accommodation':
      return <Bed size={14} className="cat-icon cat-hotel" />;
    case 'Transport':
      return <Car size={14} className="cat-icon cat-transport" />;
    case 'Shopping':
      return <ShoppingBag size={14} className="cat-icon cat-shopping" />;
    case 'Activity':
      return <Sparkles size={14} className="cat-icon cat-activity" />;
    case 'Sightseeing':
    default:
      return <Landmark size={14} className="cat-icon cat-sight" />;
  }
}

export function PlaceSearchInput({
  onSelect,
  biasLat,
  biasLng,
  placeholder = 'Search a place or paste a Google Maps URL…',
  autoFocus = false,
}: PlaceSearchInputProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodedPlace[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Debounced search
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    timerRef.current = window.setTimeout(async () => {
      try {
        const isMapUrl = /^https:\/\/(?:maps\.app\.goo\.gl|goo\.gl|(?:www\.|maps\.)?google\.com)\//i.test(q);
        if (isMapUrl) {
          const params = new URLSearchParams({ url: q });
          const res = await apiGet<{ place: GeocodedPlace }>(`/places/resolve-map-url?${params.toString()}`);
          setResults(res.place ? [res.place] : []);
        } else {
          const params = new URLSearchParams({ q });
          if (biasLat != null && biasLng != null) {
            params.set('biasLat', String(biasLat));
            params.set('biasLng', String(biasLng));
          }
          const res = await apiGet<{ places: GeocodedPlace[] }>(`/places/search?${params.toString()}`);
          setResults(res.places || []);
        }
        setHighlightIdx(0);
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 280);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, biasLat, biasLng]);

  const handleSelect = (place: GeocodedPlace) => {
    onSelect(place);
    setQuery('');
    setResults([]);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx((prev) => (prev + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx((prev) => (prev - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[highlightIdx]) {
        handleSelect(results[highlightIdx]);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="place-search-wrapper" ref={containerRef}>
      <div className="place-search-input-box">
        <Search size={16} className="search-icon muted" />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => {
            if (results.length > 0) setOpen(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className="place-search-field"
        />
        {loading && <Loader2 size={16} className="spinner-icon spin" />}
        {!loading && query && (
          <button
            type="button"
            className="clear-btn"
            onClick={() => {
              setQuery('');
              setResults([]);
              setOpen(false);
            }}
          >
            <X size={14} />
          </button>
        )}
      </div>

      {open && query.trim().length >= 2 && (
        <div className="place-autocomplete-dropdown">
          {loading && results.length === 0 && (
            <div className="place-autocomplete-empty">Searching Google Maps…</div>
          )}
          {!loading && results.length === 0 && (
            <div className="place-autocomplete-empty">No places found for &quot;{query}&quot;</div>
          )}
          {results.map((p, idx) => (
            <div
              key={`${p.name}-${p.lat}-${p.lng}-${idx}`}
              className={`place-autocomplete-item ${idx === highlightIdx ? 'highlighted' : ''}`}
              onClick={() => handleSelect(p)}
              onMouseEnter={() => setHighlightIdx(idx)}
            >
              <div className="place-item-icon">{getCategoryIcon(p.category)}</div>
              <div className="place-item-details">
                <div className="place-item-title">
                  <span>{p.name}</span>
                  <span className="place-item-cat">{p.category}</span>
                </div>
                <div className="place-item-sub">
                  <MapPin size={11} />
                  <span>{p.address}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
