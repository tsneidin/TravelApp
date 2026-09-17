import type { Trip } from './types';
import { loadGoogleMaps } from '../components/TripMap';

const escapeHtml = (value?: string | null) => String(value || '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]!));
const date = (value?: string | null) => value ? new Date(value).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : '';

interface PlaceFeature { photo?: string; rating?: number; ratings?: number; name?: string; }
async function findPlaceFeatures(trip: Trip): Promise<Record<string, PlaceFeature>> {
  const places = [...(trip.places || [])].filter((place) => place.name).slice(0, 12);
  try {
    const maps = await loadGoogleMaps();
    const service = new maps.places.PlacesService(document.createElement('div'));
    const results = await Promise.all(places.map((place) => new Promise<[string, PlaceFeature]>((resolve) => {
      service.textSearch({ query: [place.name, place.address, trip.destination].filter(Boolean).join(', ') }, (hits: any[], status: any) => {
        const hit = status === maps.places.PlacesServiceStatus.OK ? hits?.[0] : undefined;
        resolve([place.id, { photo: hit?.photos?.[0]?.getUrl?.({ maxWidth: 1000, maxHeight: 700 }), rating: hit?.rating, ratings: hit?.user_ratings_total, name: hit?.name }]);
      });
    })));
    return Object.fromEntries(results);
  } catch { return {}; }
}

export async function printTripBrochure(trip: Trip) {
  const popup = window.open('', '_blank');
  if (!popup) return;
  popup.document.write('<title>Preparing your brochure</title><body style="font:16px system-ui;padding:40px;color:#17375e">Preparing your illustrated trip brochure…</body>');
  popup.document.close();
  const features = await findPlaceFeatures(trip);
  const days = [...(trip.days || [])].sort((a, b) => +new Date(a.date) - +new Date(b.date));
  const daySections = days.map((day, index) => {
    const dayPlaces = [...(day.places || [])].sort((a, b) => a.sortOrder - b.sortOrder);
    const hero = dayPlaces.find((place) => features[place.id]?.photo);
    const description = dayPlaces.length ? `A curated day built around ${escapeHtml(dayPlaces.slice(0, 2).map((place) => place.name).join(' and '))}${dayPlaces.length > 2 ? ', with room for spontaneous discoveries.' : '.'}` : 'A relaxed day with time to discover the destination at your own pace.';
    const hotel = dayPlaces.find((place) => /accommodation|hotel/i.test(place.category || ''));
    const hotelFeature = hotel ? features[hotel.id] : undefined;
    const hotelHighlight = hotel ? `<div class="hotel"><b>Stay highlight: ${escapeHtml(hotel.name)}</b>${hotelFeature?.rating ? ` · ${hotelFeature.rating.toFixed(1)} out of 5 from ${hotelFeature.ratings?.toLocaleString() || 'travelers'} Google reviewers` : ''}${hotel.address ? `<br><span>${escapeHtml(hotel.address)}</span>` : ''}</div>` : '';
    const highlights = dayPlaces.filter((place) => place.id !== hotel?.id).slice(0, 4).map((place) => `<li>${escapeHtml(place.name)}</li>`).join('');
    return `<section class="day-page">${hero ? `<img class="day-photo" src="${features[hero.id]?.photo || ''}" alt="${escapeHtml(hero.name)}">` : ''}<div class="day"><span>Day ${index + 1}</span> ${date(day.date)}</div><h2>${escapeHtml(day.label || day.location || `Discover ${trip.destination}`)}</h2><p class="lead">${description}</p>${hotelHighlight}${highlights ? `<h3>Highlights to enjoy</h3><ul>${highlights}</ul>` : ''}</section>`;
  }).join('');
  const bookings = (trip.bookings || []).filter((booking) => booking.type === 'hotel' || booking.type === 'flight').map((booking) => `<li><strong>${escapeHtml(booking.title)}</strong>${booking.provider ? ` · ${escapeHtml(booking.provider)}` : ''}${booking.startAt ? `<br><span>${date(booking.startAt)}${booking.endAt ? ` to ${date(booking.endAt)}` : ''}</span>` : ''}</li>`).join('');
  popup.document.write(`<!doctype html><html><head><title>${escapeHtml(trip.name)} itinerary</title><style>
    @page { size: letter; margin: .45in; } body{font-family:Georgia,serif;color:#18304d;margin:0;line-height:1.5;background:#f8f5ef}.cover{min-height:9.8in;background:linear-gradient(145deg,rgba(3,39,77,.87),rgba(9,121,137,.7)),url('${Object.values(features).find((entry) => entry.photo)?.photo || ''}') center/cover;color:white;padding:.75in;box-sizing:border-box;display:flex;flex-direction:column;justify-content:end}.eyebrow,.day{text-transform:uppercase;letter-spacing:.16em;font:700 10px Arial}.cover h1{font-size:48px;line-height:1.02;margin:14px 0}.cover p{font-size:19px;max-width:480px}.page{page-break-before:always;padding:8px}.summary{background:#e9e1d3;padding:28px;border-radius:3px}.summary h2,h2{font-size:27px;line-height:1.1;margin:6px 0}h3{font:700 12px Arial;text-transform:uppercase;letter-spacing:.08em;color:#a5681c;margin:18px 0 4px}.day-page{page-break-inside:avoid;border-top:4px solid #c38b3b;padding:20px 0 24px;margin-top:16px}.day{color:#b16f18}.lead{font-size:17px;max-width:570px}.day-photo{width:100%;height:250px;object-fit:cover;margin-bottom:14px}.hotel{background:#edf4f0;border-left:3px solid #42856d;padding:10px 13px;margin:15px 0}.hotel span{color:#52677d}ul{padding-left:19px;columns:2;column-gap:35px}li{break-inside:avoid;margin:10px 0}.footer{font:11px Arial;color:#789;margin-top:30px}@media print{.cover{min-height:9.8in}}</style></head><body>
    <div class="cover"><div class="eyebrow">TravelApp presents</div><h1>${escapeHtml(trip.name)}</h1><p>${escapeHtml(trip.destination)}${trip.startDate ? `<br>${date(trip.startDate)}${trip.endDate ? ` through ${date(trip.endDate)}` : ''}` : ''}</p>${trip.description ? `<p>${escapeHtml(trip.description)}</p>` : '<p>A thoughtfully planned escape, with memorable places and the freedom to enjoy the journey.</p>'}</div>
    <main class="page"><div class="summary"><div class="eyebrow">Your journey</div><h2>${escapeHtml(trip.destination || trip.name)}</h2><p>${days.length} days of handpicked experiences${bookings ? `, with ${bookings.match(/<li>/g)?.length || 0} key reservations in place` : ''}.</p></div>${bookings ? `<h2>Where you will stay and travel</h2><ul>${bookings}</ul>` : ''}${daySections}<p class="footer">Prepared with TravelApp · Please verify reservations and opening times before travel.</p></main><script>window.onload=()=>setTimeout(()=>window.print(),400)</script></body></html>`);
  popup.document.close();
  popup.opener = null;
}
