import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownUp,
  Bookmark,
  Car,
  Check,
  ChevronDown,
  ChevronRight,
  Compass,
  Copy,
  Crosshair,
  Footprints,
  Layers,
  Navigation,
  Plus,
  Route,
  Train,
  X,
} from 'lucide-react';
import type { Day, GeocodedPlace, MapView, Place } from '../lib/types';
import { apiDelete, apiPost } from '../lib/api';

export interface PlaceWithStop extends Place { stopNumber?: number; }
type Coord = { lat: number; lng: number };

declare global {
  interface Window {
    google?: any;
    __travelGoogleMapsPromise?: Promise<any>;
  }
}

function loadGoogleMaps(): Promise<any> {
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (window.__travelGoogleMapsPromise) return window.__travelGoogleMapsPromise;
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  if (!key) return Promise.reject(new Error('VITE_GOOGLE_MAPS_API_KEY is not configured'));
  window.__travelGoogleMapsPromise = new Promise((resolve, reject) => {
    const callback = '__travelGoogleMapsReady';
    (window as any)[callback] = () => {
      delete (window as any)[callback];
      resolve(window.google.maps);
    };
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&libraries=places&callback=${callback}`;
    script.async = true;
    script.onerror = () => reject(new Error('Google Maps failed to load'));
    document.head.appendChild(script);
  });
  return window.__travelGoogleMapsPromise;
}

const geocodeCache = new Map<string, Coord>();

function categoryFromGoogleTypes(types: string[] = []): string {
  if (types.some((type) => ['restaurant', 'cafe', 'bar', 'bakery', 'meal_takeaway'].includes(type))) return 'Restaurant';
  if (types.some((type) => ['lodging', 'campground', 'rv_park'].includes(type))) return 'Accommodation';
  if (types.some((type) => ['airport', 'train_station', 'bus_station', 'transit_station', 'car_rental'].includes(type))) return 'Transport';
  if (types.some((type) => ['store', 'shopping_mall', 'supermarket'].includes(type))) return 'Shopping';
  if (types.some((type) => ['amusement_park', 'aquarium', 'zoo', 'movie_theater', 'stadium'].includes(type))) return 'Activity';
  return 'Sightseeing';
}

function isTransportation(place: PlaceWithStop): boolean {
  return /transport|flight|airport|train|rail|bus|coach|drive|driving|car rental|ferry|boat|transfer|taxi|rideshare/i.test(
    [place.category, place.name, place.notes].filter(Boolean).join(' '),
  );
}

function getGeocodeQueries(place: PlaceWithStop, destination?: string | null): string[] {
  const queries: string[] = [];
  const addr = place.address?.trim();
  if (addr) {
    queries.push(addr);
    if (destination && !addr.toLowerCase().includes(destination.toLowerCase())) {
      queries.push(`${addr}, ${destination}`);
    }
  }

  if (/→|->/.test(place.name)) {
    const originMatch = /:\s*([^→\-]+?)(?:\s*\([A-Z]{3}\))?\s*(?:→|->)/.exec(place.name) || /^([^→\-]+?)\s*(?:→|->)/.exec(place.name);
    if (originMatch?.[1]) {
      const originCity = originMatch[1].replace(/^[^\w]+/, '').trim();
      if (originCity) queries.push(`${originCity} Airport`);
    }
  }

  const cleanName = place.name.replace(/^[^\w]+/, '').trim();
  if (cleanName && !queries.includes(cleanName)) {
    queries.push(cleanName);
    if (destination && !cleanName.toLowerCase().includes(destination.toLowerCase())) {
      queries.push(`${cleanName}, ${destination}`);
    }
  }

  return queries;
}

export function TripMap({
  places,
  destination,
  fallbackLocation,
  focusPlaceId,
  activePlaceId,
  tripId,
  days,
  mapViews,
  onMapViewsChange,
  onPlaceClick,
  onMapClick,
  height = 480,
}: {
  places: PlaceWithStop[];
  destination?: string | null;
  fallbackLocation?: { coord?: Coord; address?: string; name?: string } | null;
  focusPlaceId?: string;
  activePlaceId?: string;
  tripId?: string;
  days?: Day[];
  mapViews?: MapView[];
  onMapViewsChange?: () => void | Promise<void>;
  onPlaceClick?: (placeId: string) => void;
  onMapClick?: (place: GeocodedPlace) => void;
  height?: number | string;
}) {
  const elementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const overlaysRef = useRef<any[]>([]);
  const markersMapRef = useRef<Map<string, { marker: any; coord: Coord; place: PlaceWithStop; infoContent: string }>>(new Map());
  const resolvedCoordsRef = useRef<Coord[]>([]);
  const transitLayerRef = useRef<any>(null);
  const directionsRendererRef = useRef<any>(null);
  const infoWindowRef = useRef<any>(null);
  const previewRef = useRef<any>(null);
  const mapClickRef = useRef(onMapClick);
  const [error, setError] = useState('');
  const [localViews, setLocalViews] = useState<MapView[]>(mapViews || []);
  const [isSavingView, setIsSavingView] = useState(false);
  const [newViewName, setNewViewName] = useState('');
  const [savingPending, setSavingPending] = useState(false);

  // Transit layer & route planner state
  const [showTransitLayer, setShowTransitLayer] = useState(false);
  const [showRouter, setShowRouter] = useState(false);
  const [originInput, setOriginInput] = useState('');
  const [destInput, setDestInput] = useState('');
  const [travelMode, setTravelMode] = useState<'TRANSIT' | 'DRIVING' | 'WALKING' | 'BICYCLING'>('TRANSIT');
  const [calculating, setCalculating] = useState(false);
  const [routeResult, setRouteResult] = useState<any>(null);
  const [routeError, setRouteError] = useState('');
  const [targetDayId, setTargetDayId] = useState('');
  const [savingRoute, setSavingRoute] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [showSteps, setShowSteps] = useState(false);

  // Right click context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; lat: number; lng: number; address?: string } | null>(null);
  const [copiedCoords, setCopiedCoords] = useState(false);

  const targetId = activePlaceId || focusPlaceId;

  useEffect(() => {
    if (mapViews) setLocalViews(mapViews);
  }, [mapViews]);

  useEffect(() => { mapClickRef.current = onMapClick; }, [onMapClick]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const signature = useMemo(
    () => places.map((p) => [p.id, p.name, p.address, p.lat, p.lng, p.stopNumber].join(':')).join('|'),
    [places],
  );

  const fallbackSig = useMemo(
    () => fallbackLocation ? `${fallbackLocation.address || ''}:${fallbackLocation.coord?.lat ?? ''}:${fallbackLocation.coord?.lng ?? ''}` : '',
    [fallbackLocation],
  );

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps().then(async (maps) => {
      if (cancelled || !elementRef.current) return;
      if (!mapRef.current) {
        mapRef.current = new maps.Map(elementRef.current, {
          center: { lat: 20, lng: 0 },
          zoom: 2,
          mapTypeControl: true,
          streetViewControl: false,
        });

        mapRef.current.addListener('contextmenu', async (event: any) => {
          if (!event.latLng) return;
          const lat = event.latLng.lat();
          const lng = event.latLng.lng();

          const rect = elementRef.current?.getBoundingClientRect();
          let x = 120;
          let y = 120;
          if (rect && event.domEvent) {
            event.domEvent.preventDefault?.();
            x = Math.max(10, Math.min(event.domEvent.clientX - rect.left, rect.width - 240));
            y = Math.max(10, Math.min(event.domEvent.clientY - rect.top, rect.height - 260));
          }

          setContextMenu({ x, y, lat, lng });
          setCopiedCoords(false);

          try {
            const geocoder = new maps.Geocoder();
            const response = await geocoder.geocode({ location: { lat, lng } });
            const formatted = response.results?.[0]?.formatted_address;
            if (formatted) {
              setContextMenu((prev) => (prev && prev.lat === lat && prev.lng === lng ? { ...prev, address: formatted } : prev));
            }
          } catch { /* ignore */ }
        });

        const clickedMarkerRef: { current: any } = { current: null };

        mapRef.current.addListener('click', async (event: any) => {
          setContextMenu(null);
          if (!event.latLng) return;
          event.stop?.();
          const geocoder = new maps.Geocoder();

          const showPreview = (place: GeocodedPlace, position: any) => {
            previewRef.current?.close();

            if (!clickedMarkerRef.current) {
              clickedMarkerRef.current = new maps.Marker({
                map: mapRef.current,
                position,
                animation: maps.Animation?.DROP,
              });
            } else {
              clickedMarkerRef.current.setPosition(position);
              clickedMarkerRef.current.setMap(mapRef.current);
            }

            const card = document.createElement('div');
            card.style.cssText = 'min-width:260px;max-width:320px;color:#111827;padding:2px;font-family:system-ui,-apple-system,sans-serif';

            // If photo available, show photo banner
            if (place.photoUrl) {
              const imgContainer = document.createElement('div');
              imgContainer.style.cssText = 'width:100%;height:130px;border-radius:6px;overflow:hidden;margin-bottom:8px;background:#e2e8f0;';
              const img = document.createElement('img');
              img.src = place.photoUrl;
              img.alt = place.name;
              img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
              imgContainer.appendChild(img);
              card.appendChild(imgContainer);
            }

            const title = document.createElement('strong');
            title.textContent = place.name;
            title.style.cssText = 'display:block;font-size:15px;font-weight:700;margin-bottom:4px;color:#0f172a;line-height:1.25';
            card.appendChild(title);

            // Rating & Status badge row
            const metaRow = document.createElement('div');
            metaRow.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px;margin-bottom:6px;color:#475569;';

            if (place.rating) {
              const ratingSpan = document.createElement('span');
              ratingSpan.style.cssText = 'display:inline-flex;align-items:center;gap:3px;font-weight:600;color:#d97706;';
              ratingSpan.innerHTML = `★ <span>${place.rating.toFixed(1)}</span>${place.userRatingsTotal ? `<span style="font-weight:400;color:#64748b;">(${place.userRatingsTotal.toLocaleString()})</span>` : ''}`;
              metaRow.appendChild(ratingSpan);
            }

            if (place.openNow !== undefined) {
              const openSpan = document.createElement('span');
              openSpan.style.cssText = `font-size:11px;font-weight:600;padding:1px 6px;border-radius:9999px;background:${place.openNow ? '#dcfce7' : '#fee2e2'};color:${place.openNow ? '#166534' : '#991b1b'};`;
              openSpan.textContent = place.openNow ? 'Open now' : 'Closed';
              metaRow.appendChild(openSpan);
            }

            if (place.category) {
              const catSpan = document.createElement('span');
              catSpan.style.cssText = 'font-size:11px;padding:1px 6px;border-radius:9999px;background:#f1f5f9;color:#475569;font-weight:500;';
              catSpan.textContent = place.category;
              metaRow.appendChild(catSpan);
            }

            if (metaRow.childNodes.length > 0) {
              card.appendChild(metaRow);
            }

            // Address
            if (place.address) {
              const address = document.createElement('div');
              address.textContent = place.address;
              address.style.cssText = 'font-size:12px;color:#64748b;margin-bottom:6px;line-height:1.35';
              card.appendChild(address);
            }

            // Phone
            if (place.phone) {
              const phone = document.createElement('div');
              phone.innerHTML = `<span style="font-size:11px;color:#64748b;">📞 ${place.phone}</span>`;
              phone.style.cssText = 'margin-bottom:6px;';
              card.appendChild(phone);
            }

            // Links (View on Google Maps + Website)
            const linksRow = document.createElement('div');
            linksRow.style.cssText = 'display:flex;align-items:center;gap:12px;font-size:12px;margin-bottom:10px;margin-top:2px;';

            if (place.mapUrl) {
              const gmapsLink = document.createElement('a');
              gmapsLink.href = place.mapUrl;
              gmapsLink.target = '_blank';
              gmapsLink.rel = 'noopener noreferrer';
              gmapsLink.textContent = '🌐 View on Google Maps ↗';
              gmapsLink.style.cssText = 'color:#0284c7;text-decoration:none;font-weight:600;display:inline-flex;align-items:center;';
              linksRow.appendChild(gmapsLink);
            }

            if (place.website) {
              const webLink = document.createElement('a');
              webLink.href = place.website;
              webLink.target = '_blank';
              webLink.rel = 'noopener noreferrer';
              webLink.textContent = '🔗 Website ↗';
              webLink.style.cssText = 'color:#0284c7;text-decoration:none;font-weight:500;';
              linksRow.appendChild(webLink);
            }

            if (linksRow.childNodes.length > 0) {
              card.appendChild(linksRow);
            }

            // Action buttons
            const actions = document.createElement('div');
            actions.style.cssText = 'display:flex;gap:6px;align-items:center;border-top:1px solid #e2e8f0;padding-top:8px;margin-top:4px';

            const dirButton = document.createElement('button');
            dirButton.type = 'button';
            dirButton.textContent = '🧭 Directions';
            dirButton.style.cssText = 'border:1px solid #cbd5e1;border-radius:6px;background:#f8fafc;color:#0f172a;padding:5px 10px;font-size:12px;font-weight:600;cursor:pointer';
            dirButton.addEventListener('click', () => {
              previewRef.current?.close();
              setShowRouter(true);
              setDestInput(place.address || place.name);
            });
            actions.appendChild(dirButton);

            const addButton = document.createElement('button');
            addButton.type = 'button';
            addButton.textContent = '+ Add to Itinerary';
            addButton.style.cssText = 'margin-left:auto;border:0;border-radius:6px;background:#0891b2;color:white;padding:5px 12px;font-size:12px;font-weight:600;cursor:pointer';
            addButton.addEventListener('click', () => {
              previewRef.current?.close();
              const callback = mapClickRef.current;
              callback?.(place);
            });
            actions.appendChild(addButton);
            card.appendChild(actions);

            previewRef.current = new maps.InfoWindow({ content: card, position });
            previewRef.current.addListener('closeclick', () => {
              clickedMarkerRef.current?.setMap(null);
            });
            previewRef.current.open({ map: mapRef.current, anchor: clickedMarkerRef.current });
          };

          const fetchPlaceDetails = async (placeId: string): Promise<any | null> => {
            if (!maps.places?.PlacesService) return null;
            const service = new maps.places.PlacesService(mapRef.current);
            return new Promise<any | null>((resolve) => {
              service.getDetails({
                placeId,
                fields: [
                  'name',
                  'formatted_address',
                  'geometry',
                  'website',
                  'url',
                  'types',
                  'rating',
                  'user_ratings_total',
                  'photos',
                  'opening_hours',
                  'formatted_phone_number',
                ],
              }, (place: any, status: any) => {
                resolve(status === maps.places.PlacesServiceStatus.OK ? place : null);
              });
            });
          };

          try {
            if (event.placeId) {
              const details = await fetchPlaceDetails(event.placeId);
              if (details) {
                const point = details.geometry?.location ?? event.latLng;
                const photoUrl = details.photos?.[0]?.getUrl?.({ maxWidth: 400, maxHeight: 240 });
                let openNow: boolean | undefined;
                try {
                  openNow = details.opening_hours?.isOpen?.();
                } catch { /* ignore */ }

                showPreview({
                  name: details.name || 'Pinned location',
                  address: details.formatted_address || details.name || 'Google Maps place',
                  lat: point.lat(),
                  lng: point.lng(),
                  category: categoryFromGoogleTypes(details.types),
                  placeId: event.placeId,
                  website: details.website || undefined,
                  mapUrl: details.url || `https://www.google.com/maps/search/?api=1&query=place_id:${encodeURIComponent(event.placeId)}`,
                  rating: details.rating,
                  userRatingsTotal: details.user_ratings_total,
                  photoUrl,
                  openNow,
                  phone: details.formatted_phone_number,
                }, point);
                return;
              }
            }

            const response = await geocoder.geocode({ location: event.latLng });
            const result = response.results?.[0];
            const point = result?.geometry?.location ?? event.latLng;

            if (result?.place_id) {
              const details = await fetchPlaceDetails(result.place_id);
              if (details) {
                const detPoint = details.geometry?.location ?? point;
                const photoUrl = details.photos?.[0]?.getUrl?.({ maxWidth: 400, maxHeight: 240 });
                let openNow: boolean | undefined;
                try {
                  openNow = details.opening_hours?.isOpen?.();
                } catch { /* ignore */ }

                showPreview({
                  name: details.name || result.formatted_address?.split(',')[0] || 'Pinned location',
                  address: details.formatted_address || result.formatted_address || 'Google Maps place',
                  lat: detPoint.lat(),
                  lng: detPoint.lng(),
                  category: categoryFromGoogleTypes(details.types || result.types),
                  placeId: result.place_id,
                  website: details.website || undefined,
                  mapUrl: details.url || `https://www.google.com/maps/search/?api=1&query=place_id:${encodeURIComponent(result.place_id)}`,
                  rating: details.rating,
                  userRatingsTotal: details.user_ratings_total,
                  photoUrl,
                  openNow,
                  phone: details.formatted_phone_number,
                }, detPoint);
                return;
              }
            }

            const fallbackName = result?.formatted_address?.split(',')[0] || 'Pinned location';
            showPreview({
              name: fallbackName,
              address: result?.formatted_address || fallbackName,
              lat: point.lat(),
              lng: point.lng(),
              category: categoryFromGoogleTypes(result?.types),
              placeId: result?.place_id,
              mapUrl: `https://www.google.com/maps/search/?api=1&query=${point.lat()},${point.lng()}`,
            }, point);
          } catch {
            const place = {
              name: 'Pinned location',
              address: `${event.latLng.lat().toFixed(6)}, ${event.latLng.lng().toFixed(6)}`,
              lat: event.latLng.lat(),
              lng: event.latLng.lng(),
              category: 'Sightseeing',
              mapUrl: `https://www.google.com/maps/search/?api=1&query=${event.latLng.lat()},${event.latLng.lng()}`,
            };
            showPreview(place, event.latLng);
          }
        });
      }

      overlaysRef.current.forEach((overlay) => overlay.setMap?.(null));
      overlaysRef.current = [];
      markersMapRef.current.clear();

      if (!infoWindowRef.current) {
        infoWindowRef.current = new maps.InfoWindow();
      }

      const geocoder = new maps.Geocoder();
      const resolved: { place: PlaceWithStop; coord: Coord }[] = [];

      for (const place of places) {
        let coord: Coord | undefined = place.lat != null && place.lng != null
          ? { lat: place.lat, lng: place.lng }
          : undefined;

        if (!coord) {
          const queries = getGeocodeQueries(place, destination);
          for (const query of queries) {
            coord = geocodeCache.get(query);
            if (!coord) {
              try {
                const response = await geocoder.geocode({ address: query });
                const point = response.results?.[0]?.geometry?.location;
                if (point) {
                  coord = { lat: point.lat(), lng: point.lng() };
                  geocodeCache.set(query, coord);
                  break;
                }
              } catch { /* Try next fallback query */ }
            } else {
              break;
            }
          }
        }
        if (coord) resolved.push({ place, coord });
      }
      if (cancelled) return;
      resolvedCoordsRef.current = resolved.map((r) => r.coord);

      const bounds = new maps.LatLngBounds();
      for (const { place, coord } of resolved) {
        bounds.extend(coord);
        const marker = new maps.Marker({
          map: mapRef.current,
          position: coord,
          label: place.stopNumber != null ? { text: String(place.stopNumber), color: '#fff' } : undefined,
          title: place.name,
        });

        const detail = [place.category, place.address, place.notes].filter(Boolean).join(' · ');
        const infoContent = `<div style="max-width:260px;color:#111827"><strong>${place.name}</strong><div style="font-size:12px;margin-top:4px;color:#4b5563">${detail}</div></div>`;

        marker.addListener('click', () => {
          infoWindowRef.current?.setContent(infoContent);
          infoWindowRef.current?.open({ map: mapRef.current, anchor: marker });
          onPlaceClick?.(place.id);
        });

        overlaysRef.current.push(marker);
        markersMapRef.current.set(place.id, { marker, coord, place, infoContent });
      }

      // Ordinary itinerary stops are independent pins. Draw a segment only
      // when the destination entry represents transportation from the prior stop.
      for (let index = 1; index < resolved.length; index += 1) {
        if (!isTransportation(resolved[index].place)) continue;
        overlaysRef.current.push(new maps.Polyline({
          map: mapRef.current,
          path: [resolved[index - 1].coord, resolved[index].coord],
          strokeColor: '#22d3ee',
          strokeOpacity: 0.85,
          strokeWeight: 3,
        }));
      }

      // Handle focus and centering
      const targetMarkerInfo = targetId ? markersMapRef.current.get(targetId) : undefined;
      if (targetMarkerInfo) {
        mapRef.current.setCenter(targetMarkerInfo.coord);
        mapRef.current.setZoom(15);
        infoWindowRef.current?.setContent(targetMarkerInfo.infoContent);
        infoWindowRef.current?.open({ map: mapRef.current, anchor: targetMarkerInfo.marker });
      } else if (resolved.length > 1) {
        infoWindowRef.current?.close();
        mapRef.current.fitBounds(bounds, 48);
      } else if (resolved.length === 1) {
        infoWindowRef.current?.close();
        mapRef.current.setCenter(resolved[0].coord);
        mapRef.current.setZoom(13);
      } else {
        infoWindowRef.current?.close();
        // Day has no places: use the previous day's location (fallbackLocation)
        let handledFallback = false;
        if (fallbackLocation) {
          if (fallbackLocation.coord) {
            mapRef.current.setCenter(fallbackLocation.coord);
            mapRef.current.setZoom(12);
            handledFallback = true;
          } else if (fallbackLocation.address) {
            let coord = geocodeCache.get(fallbackLocation.address);
            if (!coord) {
              try {
                const response = await geocoder.geocode({ address: fallbackLocation.address });
                const point = response.results?.[0]?.geometry?.location;
                if (point) {
                  coord = { lat: point.lat(), lng: point.lng() };
                  geocodeCache.set(fallbackLocation.address, coord);
                }
              } catch { /* Fall back to destination */ }
            }
            if (coord && !cancelled) {
              mapRef.current.setCenter(coord);
              mapRef.current.setZoom(12);
              handledFallback = true;
            }
          }
        }

        if (!handledFallback && destination) {
          let destCoord = geocodeCache.get(destination);
          if (!destCoord) {
            try {
              const response = await geocoder.geocode({ address: destination });
              const point = response.results?.[0]?.geometry?.location;
              if (point) {
                destCoord = { lat: point.lat(), lng: point.lng() };
                geocodeCache.set(destination, destCoord);
              }
            } catch { /* Retain world view. */ }
          }
          if (destCoord && !cancelled) {
            mapRef.current.setCenter(destCoord);
            mapRef.current.setZoom(8);
          }
        }
      }
      setError('');
    }).catch((e: Error) => setError(e.message));
    return () => { cancelled = true; };
  }, [signature, fallbackSig, destination, targetId, onPlaceClick]);

  const toggleTransitLayer = () => {
    if (!mapRef.current || !window.google?.maps) return;
    if (!transitLayerRef.current) {
      transitLayerRef.current = new window.google.maps.TransitLayer();
    }
    const nextState = !showTransitLayer;
    setShowTransitLayer(nextState);
    transitLayerRef.current.setMap(nextState ? mapRef.current : null);
  };

  const fitAllStops = () => {
    if (!mapRef.current || !window.google?.maps) return;
    infoWindowRef.current?.close();
    if (resolvedCoordsRef.current.length > 1) {
      const bounds = new window.google.maps.LatLngBounds();
      resolvedCoordsRef.current.forEach((coord) => bounds.extend(coord));
      mapRef.current.fitBounds(bounds, 48);
    } else if (resolvedCoordsRef.current.length === 1) {
      mapRef.current.panTo(resolvedCoordsRef.current[0]);
      mapRef.current.setZoom(13);
    } else if (destination) {
      const destCoord = geocodeCache.get(destination);
      if (destCoord) {
        mapRef.current.panTo(destCoord);
        mapRef.current.setZoom(8);
      }
    }
  };

  const jumpToView = (view: MapView) => {
    if (!mapRef.current) return;
    infoWindowRef.current?.close();
    mapRef.current.panTo({ lat: view.lat, lng: view.lng });
    mapRef.current.setZoom(view.zoom);
  };

  const handleSaveCurrentView = async () => {
    if (!mapRef.current || !tripId || !newViewName.trim()) return;
    const center = mapRef.current.getCenter();
    const zoom = mapRef.current.getZoom();
    if (!center || zoom == null) return;
    setSavingPending(true);
    try {
      const res = await apiPost<{ mapView: MapView }>(`/trips/${tripId}/map-views`, {
        name: newViewName.trim(),
        lat: center.lat(),
        lng: center.lng(),
        zoom,
      });
      setLocalViews((prev) => [...prev, res.mapView]);
      setIsSavingView(false);
      setNewViewName('');
      void onMapViewsChange?.();
    } catch (err: any) {
      alert(err.message || 'Failed to save map view');
    } finally {
      setSavingPending(false);
    }
  };

  const handleDeleteView = async (viewId: string) => {
    if (!tripId) return;
    setLocalViews((prev) => prev.filter((v) => v.id !== viewId));
    try {
      await apiDelete(`/trips/${tripId}/map-views/${viewId}`);
      void onMapViewsChange?.();
    } catch (err: any) {
      alert(err.message || 'Failed to delete map view');
    }
  };

  const calculateRoute = async () => {
    if (!mapRef.current || !window.google?.maps || !originInput.trim() || !destInput.trim()) return;
    setCalculating(true);
    setRouteError('');
    setRouteResult(null);

    try {
      const directionsService = new window.google.maps.DirectionsService();
      if (!directionsRendererRef.current) {
        directionsRendererRef.current = new window.google.maps.DirectionsRenderer({
          map: mapRef.current,
          suppressMarkers: false,
          polylineOptions: {
            strokeColor: '#0891b2',
            strokeWeight: 5,
            strokeOpacity: 0.85,
          },
        });
      } else {
        directionsRendererRef.current.setMap(mapRef.current);
      }

      const mode = (window.google.maps.TravelMode as any)[travelMode] || window.google.maps.TravelMode.TRANSIT;
      const request: any = {
        origin: originInput.trim(),
        destination: destInput.trim(),
        travelMode: mode,
      };

      const result = await new Promise<any>((resolve, reject) => {
        directionsService.route(request, (res: any, status: any) => {
          if (status === window.google.maps.DirectionsStatus.OK) {
            resolve(res);
          } else {
            reject(new Error(`Routing calculation: ${status}`));
          }
        });
      });

      directionsRendererRef.current.setDirections(result);

      const leg = result.routes?.[0]?.legs?.[0];
      if (leg) {
        const transitLines: string[] = [];
        const steps: { instruction: string; distance?: string; duration?: string; lineName?: string }[] = [];

        leg.steps?.forEach((step: any) => {
          const cleanInstruction = (step.instructions || '').replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim();
          if (step.transit) {
            const line = step.transit.line;
            const lineName = line.short_name || line.name || line.vehicle?.name || 'Transit';
            transitLines.push(lineName);
            steps.push({
              instruction: `${line.vehicle?.name || 'Transit'} ${lineName}: ${step.transit.departure_stop?.name || ''} → ${step.transit.arrival_stop?.name || ''} (${step.transit.num_stops || 1} stops)`,
              distance: step.distance?.text,
              duration: step.duration?.text,
              lineName,
            });
          } else {
            steps.push({
              instruction: cleanInstruction,
              distance: step.distance?.text,
              duration: step.duration?.text,
            });
          }
        });

        const startAddr = leg.start_address || originInput;
        const endAddr = leg.end_address || destInput;

        setRouteResult({
          durationText: leg.duration?.text || '',
          distanceText: leg.distance?.text || '',
          startAddress: startAddr,
          endAddress: endAddr,
          startLocation: leg.start_location,
          endLocation: leg.end_location,
          transitLines: Array.from(new Set(transitLines)),
          steps,
        });
      }
    } catch (err: any) {
      setRouteError(err.message || 'No route found between selected points.');
    } finally {
      setCalculating(false);
    }
  };

  const saveTransitToItinerary = async () => {
    if (!tripId || !routeResult) return;
    setSavingRoute(true);
    try {
      const modeLabel = travelMode === 'TRANSIT'
        ? (routeResult.transitLines.length ? `Transit (${routeResult.transitLines.join(', ')})` : 'Transit')
        : travelMode === 'DRIVING'
        ? 'Drive'
        : travelMode === 'WALKING'
        ? 'Walk'
        : 'Bike';

      const originName = originInput.split(',')[0].trim();
      const destName = destInput.split(',')[0].trim();
      const title = `${modeLabel}: ${originName} → ${destName}`;

      const notesParts = [
        `${routeResult.durationText} (${routeResult.distanceText})`,
        routeResult.transitLines.length ? `Lines: ${routeResult.transitLines.join(', ')}` : null,
      ].filter(Boolean);

      const notes = notesParts.join(' · ');

      const endLat = routeResult.endLocation ? routeResult.endLocation.lat() : undefined;
      const endLng = routeResult.endLocation ? routeResult.endLocation.lng() : undefined;

      await apiPost(`/trips/${tripId}/places`, {
        name: title,
        category: 'Transport',
        address: `${routeResult.startAddress} to ${routeResult.endAddress}`,
        notes,
        lat: endLat,
        lng: endLng,
        dayId: targetDayId || undefined,
      });

      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3500);
      void onMapViewsChange?.();
    } catch (err: any) {
      alert(err.message || 'Failed to save transit leg to itinerary');
    } finally {
      setSavingRoute(false);
    }
  };

  const clearRoute = () => {
    directionsRendererRef.current?.setMap(null);
    setRouteResult(null);
    setRouteError('');
    setShowSteps(false);
  };

  const swapOriginDest = () => {
    const temp = originInput;
    setOriginInput(destInput);
    setDestInput(temp);
  };

  const sortedDays = useMemo(() => {
    return [...(days || [])].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime() || a.sortOrder - b.sortOrder);
  }, [days]);

  return (
    <div style={{ position: 'relative', width: '100%', height: typeof height === 'number' ? `${height}px` : height }}>
      <div className="map-views-bar">
        <button
          type="button"
          className="map-view-chip map-view-chip-standalone"
          onClick={fitAllStops}
          title="Fit all itinerary stops on screen"
        >
          <Compass size={13} /> Fit All
        </button>

        <button
          type="button"
          className={`map-view-chip map-view-chip-standalone ${showTransitLayer ? 'active-layer-btn' : ''}`}
          onClick={toggleTransitLayer}
          title="Toggle Google Maps Transit Layer (trains, subways, transit lines)"
        >
          <Layers size={13} /> {showTransitLayer ? '🚊 Transit ON' : '🚊 Transit'}
        </button>

        <button
          type="button"
          className={`map-view-chip map-view-chip-standalone ${showRouter ? 'active-layer-btn' : ''}`}
          onClick={() => setShowRouter(!showRouter)}
          title="Open Transit & Directions Route Planner"
        >
          <Route size={13} /> Directions & Transit
        </button>

        {localViews.map((view) => (
          <div key={view.id} className="map-view-chip-group">
            <button
              type="button"
              className="map-view-chip"
              onClick={() => jumpToView(view)}
              title={`Jump to ${view.name} (zoom ${view.zoom})`}
            >
              <Bookmark size={12} style={{ opacity: 0.85 }} /> {view.name}
            </button>
            {tripId && (
              <button
                type="button"
                className="map-view-chip-del"
                onClick={(e) => {
                  e.stopPropagation();
                  void handleDeleteView(view.id);
                }}
                title="Delete saved view"
              >
                <X size={11} />
              </button>
            )}
          </div>
        ))}

        {tripId && (
          isSavingView ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleSaveCurrentView();
              }}
              className="map-view-save-form"
            >
              <input
                autoFocus
                type="text"
                className="map-view-input"
                value={newViewName}
                onChange={(e) => setNewViewName(e.target.value)}
                placeholder="View name..."
              />
              <button
                type="submit"
                className="map-view-chip map-view-save-confirm"
                disabled={savingPending || !newViewName.trim()}
              >
                {savingPending ? '…' : 'Save'}
              </button>
              <button
                type="button"
                className="map-view-chip map-view-cancel"
                onClick={() => setIsSavingView(false)}
              >
                <X size={11} />
              </button>
            </form>
          ) : (
            <button
              type="button"
              className="map-view-chip map-view-save-btn"
              onClick={() => {
                setIsSavingView(true);
                setNewViewName(`View ${localViews.length + 1}`);
              }}
              title="Save current camera position & zoom"
            >
              <Plus size={12} /> Save View
            </button>
          )
        )}
      </div>

      {/* Interactive Transit & Directions Route Planner Drawer */}
      {showRouter && (
        <div className="map-transit-drawer">
          <div className="row between mb" style={{ marginBottom: 10 }}>
            <div className="row" style={{ gap: 6 }}>
              <Navigation size={15} style={{ color: 'var(--accent)' }} />
              <strong style={{ fontSize: '0.9rem', color: '#fff' }}>Route & Transit Planner</strong>
            </div>
            <button
              type="button"
              className="btn sm ghost"
              style={{ padding: '2px 6px', color: '#94a3b8' }}
              onClick={() => setShowRouter(false)}
            >
              <X size={14} />
            </button>
          </div>

          {/* Travel Mode Selector */}
          <div className="map-mode-selector mb">
            <button
              type="button"
              className={`mode-btn ${travelMode === 'TRANSIT' ? 'active' : ''}`}
              onClick={() => setTravelMode('TRANSIT')}
              title="Public Transit (Train, Subway, Bus)"
            >
              <Train size={13} /> Transit
            </button>
            <button
              type="button"
              className={`mode-btn ${travelMode === 'DRIVING' ? 'active' : ''}`}
              onClick={() => setTravelMode('DRIVING')}
              title="Driving"
            >
              <Car size={13} /> Drive
            </button>
            <button
              type="button"
              className={`mode-btn ${travelMode === 'WALKING' ? 'active' : ''}`}
              onClick={() => setTravelMode('WALKING')}
              title="Walking"
            >
              <Footprints size={13} /> Walk
            </button>
          </div>

          {/* Origin & Destination */}
          <div className="mb" style={{ display: 'grid', gap: 6 }}>
            <div className="row" style={{ gap: 6 }}>
              <span className="dot-label" style={{ background: '#22c55e' }}>A</span>
              <input
                list="map-stops-origin"
                className="map-route-input grow"
                placeholder="Origin stop or address..."
                value={originInput}
                onChange={(e) => setOriginInput(e.target.value)}
              />
              <datalist id="map-stops-origin">
                {places.map((p) => (
                  <option key={p.id} value={p.address || p.name}>
                    {p.name}
                  </option>
                ))}
              </datalist>
            </div>

            <div className="row" style={{ justifyContent: 'center', margin: '-2px 0' }}>
              <button
                type="button"
                className="btn sm ghost"
                style={{ padding: '2px 8px', fontSize: '0.75rem', color: '#94a3b8' }}
                onClick={swapOriginDest}
                title="Swap origin and destination"
              >
                <ArrowDownUp size={12} /> Swap
              </button>
            </div>

            <div className="row" style={{ gap: 6 }}>
              <span className="dot-label" style={{ background: '#ef4444' }}>B</span>
              <input
                list="map-stops-dest"
                className="map-route-input grow"
                placeholder="Destination stop or address..."
                value={destInput}
                onChange={(e) => setDestInput(e.target.value)}
              />
              <datalist id="map-stops-dest">
                {places.map((p) => (
                  <option key={p.id} value={p.address || p.name}>
                    {p.name}
                  </option>
                ))}
              </datalist>
            </div>
          </div>

          <div className="row" style={{ gap: 6, marginBottom: 10 }}>
            <button
              type="button"
              className="btn sm primary grow"
              onClick={calculateRoute}
              disabled={calculating || !originInput.trim() || !destInput.trim()}
            >
              {calculating ? 'Calculating route…' : 'Find Route'}
            </button>
            {routeResult && (
              <button type="button" className="btn sm ghost" onClick={clearRoute}>
                Clear
              </button>
            )}
          </div>

          {routeError && (
            <div className="small" style={{ color: 'var(--danger)', marginBottom: 8 }}>
              {routeError}
            </div>
          )}

          {/* Route Summary & Save to Itinerary */}
          {routeResult && (
            <div className="map-route-summary">
              <div className="row between mb" style={{ marginBottom: 6 }}>
                <div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--accent)' }}>
                    {routeResult.durationText}
                  </div>
                  <div className="small muted">{routeResult.distanceText}</div>
                </div>

                {routeResult.transitLines.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, justifyContent: 'flex-end', maxWidth: 160 }}>
                    {routeResult.transitLines.map((line: string) => (
                      <span key={line} className="badge accent" style={{ fontSize: '0.72rem', padding: '2px 6px' }}>
                        {line}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Save Transit Leg Card */}
              {tripId && (
                <div style={{ background: 'rgba(255, 255, 255, 0.06)', borderRadius: 7, padding: '8px 10px', marginTop: 8 }}>
                  <div className="small font-semibold mb" style={{ marginBottom: 6, color: '#e2e8f0' }}>
                    Save Transit Leg to Itinerary:
                  </div>
                  <div className="row" style={{ gap: 6 }}>
                    <select
                      className="grow"
                      value={targetDayId}
                      onChange={(e) => setTargetDayId(e.target.value)}
                      style={{ fontSize: '0.78rem', padding: '4px 6px', background: 'rgba(0,0,0,0.5)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 5 }}
                    >
                      <option value="">Unassigned (No Day)</option>
                      {sortedDays.map((d, idx) => (
                        <option key={d.id} value={d.id}>
                          Day {idx + 1} ({new Date(d.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })})
                        </option>
                      ))}
                    </select>

                    <button
                      type="button"
                      className="btn sm primary"
                      style={{ whiteSpace: 'nowrap', fontSize: '0.78rem' }}
                      onClick={saveTransitToItinerary}
                      disabled={savingRoute}
                    >
                      {savingRoute ? 'Saving…' : savedSuccess ? '✓ Saved!' : '+ Save Leg'}
                    </button>
                  </div>
                  {savedSuccess && (
                    <div className="small mt" style={{ color: 'var(--success, #10b981)', fontSize: '0.74rem' }}>
                      ✓ Transit route saved to your itinerary!
                    </div>
                  )}
                </div>
              )}

              {/* Step-by-Step Instructions Toggle */}
              {routeResult.steps?.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <button
                    type="button"
                    className="btn sm ghost"
                    style={{ width: '100%', justifyContent: 'space-between', padding: '4px 6px', fontSize: '0.78rem', color: '#94a3b8' }}
                    onClick={() => setShowSteps(!showSteps)}
                  >
                    <span>{showSteps ? 'Hide' : 'Show'} step-by-step directions ({routeResult.steps.length})</span>
                    {showSteps ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  </button>

                  {showSteps && (
                    <div style={{ maxHeight: 180, overflowY: 'auto', display: 'grid', gap: 4, marginTop: 6 }}>
                      {routeResult.steps.map((st: any, sIdx: number) => (
                        <div key={sIdx} className="transit-step-row">
                          <div style={{ color: '#e2e8f0', fontSize: '0.78rem' }}>{st.instruction}</div>
                          {(st.duration || st.distance) && (
                            <div className="small muted" style={{ fontSize: '0.7rem' }}>
                              {[st.duration, st.distance].filter(Boolean).join(' · ')}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Google Maps Right-Click Context Menu */}
      {contextMenu && (
        <div
          className="map-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Coordinates Header / Copy Item */}
          <button
            type="button"
            className="map-context-item map-context-coords"
            onClick={() => {
              const text = `${contextMenu.lat.toFixed(6)}, ${contextMenu.lng.toFixed(6)}`;
              navigator.clipboard.writeText(text);
              setCopiedCoords(true);
              setTimeout(() => {
                setCopiedCoords(false);
                setContextMenu(null);
              }, 1200);
            }}
            title="Click to copy coordinates"
          >
            {copiedCoords ? <Check size={13} style={{ color: 'var(--success, #10b981)' }} /> : <Copy size={13} />}
            <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>
              {contextMenu.lat.toFixed(6)}, {contextMenu.lng.toFixed(6)}
            </span>
            {copiedCoords && <span className="badge" style={{ marginLeft: 'auto', fontSize: '0.68rem', background: 'rgba(16, 185, 129, 0.2)', color: '#10b981' }}>Copied!</span>}
          </button>

          <div className="map-context-divider" />

          {/* Directions from here */}
          <button
            type="button"
            className="map-context-item"
            onClick={() => {
              setShowRouter(true);
              setOriginInput(contextMenu.address || `${contextMenu.lat.toFixed(6)}, ${contextMenu.lng.toFixed(6)}`);
              setContextMenu(null);
            }}
          >
            <Navigation size={13} style={{ color: '#22c55e' }} />
            <span>Directions from here</span>
          </button>

          {/* Directions to here */}
          <button
            type="button"
            className="map-context-item"
            onClick={() => {
              setShowRouter(true);
              setDestInput(contextMenu.address || `${contextMenu.lat.toFixed(6)}, ${contextMenu.lng.toFixed(6)}`);
              setContextMenu(null);
            }}
          >
            <Navigation size={13} style={{ color: '#ef4444' }} />
            <span>Directions to here</span>
          </button>

          <div className="map-context-divider" />

          {/* Add place to itinerary */}
          <button
            type="button"
            className="map-context-item"
            onClick={() => {
              const fallbackName = contextMenu.address?.split(',')[0] || 'Pinned location';
              onMapClick?.({
                name: fallbackName,
                address: contextMenu.address || `${contextMenu.lat.toFixed(6)}, ${contextMenu.lng.toFixed(6)}`,
                lat: contextMenu.lat,
                lng: contextMenu.lng,
                category: 'Sightseeing',
                mapUrl: `https://www.google.com/maps/search/?api=1&query=${contextMenu.lat},${contextMenu.lng}`,
              });
              setContextMenu(null);
            }}
          >
            <Plus size={13} style={{ color: 'var(--accent)' }} />
            <span>Add place to itinerary</span>
          </button>

          {/* Center map here */}
          <button
            type="button"
            className="map-context-item"
            onClick={() => {
              mapRef.current?.panTo({ lat: contextMenu.lat, lng: contextMenu.lng });
              setContextMenu(null);
            }}
          >
            <Crosshair size={13} />
            <span>Center map here</span>
          </button>
        </div>
      )}

      <div ref={elementRef} style={{ width: '100%', height: '100%', borderRadius: 10 }} />
      {error && <div className="empty-state" style={{ position: 'absolute', inset: 12 }}><b>Google Map unavailable</b><div className="small muted">{error}</div></div>}
    </div>
  );
}

