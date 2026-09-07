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
  value?: string;
  onChange?: (val: string) => void;
  allowCustom?: boolean;
}

function getCategoryIcon(category: string) {
  switch (category) {
    case 'City':
      return <MapPin size={14} className="cat-icon cat-city" />;
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
  value,
  onChange,
  allowCustom = true,
}: PlaceSearchInputProps) {
  const [query, setQuery] = useState(value ?? '');
  const [results, setResults] = useState<GeocodedPlace[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlightIdx, setHighlightIdx] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (value !== undefined) {
      setQuery(value);
    }
  }, [value]);

  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
    }
  }, [autoFocus]);

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
    if (value !== undefined) {
      const displayVal = place.category === 'City' ? (place.name || place.address) : (place.address || place.name);
      setQuery(displayVal);
      onChange?.(displayVal);
    } else {
      setQuery('');
    }
    setResults([]);
    setOpen(false);
  };

  const handleSelectCustom = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    let bestMatch = results.find((r) => r.name.toLowerCase() === trimmed.toLowerCase()) || results[0];
    if (!bestMatch) {
      try {
        const params = new URLSearchParams({ q: trimmed, limit: '1' });
        if (biasLat != null && biasLng != null) {
          params.set('biasLat', String(biasLat));
          params.set('biasLng', String(biasLng));
        }
        const res = await apiGet<{ places: GeocodedPlace[] }>(`/places/search?${params.toString()}`);
        if (res.places && res.places[0]) {
          bestMatch = res.places[0];
        }
      } catch {
        // ignore
      }
    }

    const customPlace: GeocodedPlace = {
      name: trimmed,
      address: bestMatch?.address || trimmed,
      lat: bestMatch?.lat ?? 0,
      lng: bestMatch?.lng ?? 0,
      category: 'City',
      country: bestMatch?.country,
    };
    handleSelect(customPlace);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const totalItems = (allowCustom ? 1 : 0) + results.length;
    if (!open || totalItems === 0) {
      if (e.key === 'Enter' && allowCustom && query.trim().length >= 2) {
        e.preventDefault();
        handleSelectCustom(query);
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx((prev) => (prev + 1) % totalItems);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx((prev) => (prev - 1 + totalItems) % totalItems);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (allowCustom && highlightIdx === 0) {
        handleSelectCustom(query);
      } else {
        const resultIdx = allowCustom ? highlightIdx - 1 : highlightIdx;
        if (results[resultIdx]) {
          handleSelect(results[resultIdx]);
        } else if (allowCustom) {
          handleSelectCustom(query);
        }
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
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            onChange?.(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => {
            if (results.length > 0 || (allowCustom && query.trim().length >= 2)) setOpen(true);
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
              onChange?.('');
              setResults([]);
              setOpen(false);
            }}
            title="Clear search"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {open && query.trim().length >= 2 && (
        <div className="place-autocomplete-dropdown">
          {allowCustom && (
            <div
              className={`place-autocomplete-item custom-location-item ${highlightIdx === 0 ? 'highlighted' : ''}`}
              onClick={() => handleSelectCustom(query)}
              onMouseEnter={() => setHighlightIdx(0)}
            >
              <div className="place-item-icon">
                <MapPin size={14} className="cat-icon cat-city" />
              </div>
              <div className="place-item-details">
                <div className="place-item-title">
                  <span>Use &quot;{query.trim()}&quot; as location</span>
                  <span className="place-item-cat">City / Location</span>
                </div>
                <div className="place-item-sub">
                  <MapPin size={11} />
                  <span>
                    {results.length > 0
                      ? `Select &quot;${query.trim()}&quot; as city location (matches ${results[0].name})`
                      : 'Pin custom city/location to map'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {loading && results.length === 0 && (
            <div className="place-autocomplete-empty">Searching Google Maps…</div>
          )}
          {!loading && results.length === 0 && !allowCustom && (
            <div className="place-autocomplete-empty">No places found for &quot;{query}&quot;</div>
          )}
          {results.map((p, idx) => {
            const itemIdx = allowCustom ? idx + 1 : idx;
            return (
              <div
                key={`${p.name}-${p.lat}-${p.lng}-${idx}`}
                className={`place-autocomplete-item ${itemIdx === highlightIdx ? 'highlighted' : ''}`}
                onClick={() => handleSelect(p)}
                onMouseEnter={() => setHighlightIdx(itemIdx)}
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
            );
          })}
        </div>
      )}
    </div>
  );
}
