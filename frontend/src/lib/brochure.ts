import type { Trip } from './types';

const escapeHtml = (value?: string | null) => String(value || '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]!));
const date = (value?: string | null) => value ? new Date(value).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) : '';

export function printTripBrochure(trip: Trip) {
  const days = [...(trip.days || [])].sort((a, b) => +new Date(a.date) - +new Date(b.date));
  const daySections = days.map((day, index) => {
    const places = [...(day.places || [])].sort((a, b) => a.sortOrder - b.sortOrder).map((place) => `<li><strong>${escapeHtml(place.name)}</strong>${place.address ? `<br><span>${escapeHtml(place.address)}</span>` : ''}${place.notes ? `<br><span>${escapeHtml(place.notes)}</span>` : ''}</li>`).join('');
    return `<section><div class="day">Day ${index + 1}</div><h2>${escapeHtml(day.label || date(day.date))}</h2><p class="date">${date(day.date)}${day.location ? ` · ${escapeHtml(day.location)}` : ''}</p>${places ? `<ul>${places}</ul>` : '<p class="quiet">A day to explore at your own pace.</p>'}</section>`;
  }).join('');
  const bookings = (trip.bookings || []).filter((booking) => booking.type === 'hotel' || booking.type === 'flight').map((booking) => `<li><strong>${escapeHtml(booking.title)}</strong>${booking.provider ? ` · ${escapeHtml(booking.provider)}` : ''}${booking.startAt ? `<br><span>${date(booking.startAt)}${booking.endAt ? ` to ${date(booking.endAt)}` : ''}</span>` : ''}</li>`).join('');
  const popup = window.open('', '_blank', 'noopener,noreferrer');
  if (!popup) return;
  popup.document.write(`<!doctype html><html><head><title>${escapeHtml(trip.name)} itinerary</title><style>
    @page { size: letter; margin: .55in; } body{font-family:Georgia,serif;color:#18304d;margin:0;line-height:1.45} .cover{min-height:7.7in;background:linear-gradient(135deg,#0a4e88,#23a6b8);color:white;padding:.7in;box-sizing:border-box;display:flex;flex-direction:column;justify-content:end}.eyebrow{text-transform:uppercase;letter-spacing:.18em;font:700 10px Arial}.cover h1{font-size:42px;line-height:1.05;margin:14px 0}.cover p{font-size:18px;max-width:440px}.page{page-break-before:always;padding-top:8px}h2{font-size:22px;margin:3px 0}.date,.quiet,li span{color:#52677d}.day{font:700 11px Arial;color:#167e9d;text-transform:uppercase;letter-spacing:.1em;margin-top:25px}ul{padding-left:18px}li{margin:11px 0}.summary{background:#eff7f7;padding:20px;border-radius:10px}.footer{font:11px Arial;color:#789;margin-top:25px}@media print{.cover{min-height:9.8in}}</style></head><body>
    <div class="cover"><div class="eyebrow">A TravelApp itinerary</div><h1>${escapeHtml(trip.name)}</h1><p>${escapeHtml(trip.destination)}${trip.startDate ? `<br>${date(trip.startDate)}${trip.endDate ? ` through ${date(trip.endDate)}` : ''}` : ''}</p>${trip.description ? `<p>${escapeHtml(trip.description)}</p>` : ''}</div>
    <main class="page"><div class="summary"><div class="eyebrow">The trip at a glance</div><h2>${escapeHtml(trip.destination || trip.name)}</h2><p>${days.length} planned day${days.length === 1 ? '' : 's'}${bookings ? ` · ${bookings.match(/<li>/g)?.length || 0} key reservations` : ''}</p></div>${bookings ? `<h2>Key reservations</h2><ul>${bookings}</ul>` : ''}${daySections}<p class="footer">Prepared with TravelApp · Please verify reservations and opening times before travel.</p></main><script>window.onload=()=>window.print()</script></body></html>`);
  popup.document.close();
}
