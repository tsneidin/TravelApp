/**
 * Category & Type Icon mapping for places, bookings, and calendar events.
 */

export function getCategoryIcon(
  category?: string | null,
  name?: string | null,
  type?: 'place' | 'booking' | string | null,
  bookingType?: string | null,
): string {
  if (type === 'booking' || bookingType) {
    const bt = (bookingType || '').toLowerCase();
    if (bt === 'flight') return '✈';
    if (bt === 'hotel' || bt === 'lodging') return '🛏';
    if (bt === 'car' || bt === 'rental') return '🚗';
    if (bt === 'activity' || bt === 'tour') return '🎟';
    return '🗓';
  }

  if (type === 'todo') return '☑️';

  const cat = (category || '').toLowerCase();
  const title = (name || '').toLowerCase();
  const text = `${cat} ${title}`;

  if (/todo|task|mail\s*hold|prescription|passport/i.test(text)) return '☑️';
  if (/flight|airport|✈|\bterminal\b|[a-z]{3}\s*(?:→|->)\s*[a-z]{3}/i.test(text)) return '✈';
  if (/train|rail|eurostar|italo|frecciarossa|amtrak|station|stazione|gare/i.test(text)) return '🚆';
  if (/ferry|boat|cruise|hydrofoil|port|traghetto|aliscafi/i.test(text)) return '⛴️';
  if (/car rental|rent-a-car|enterprise|hertz|avis|sixt|drive|driving|taxi|uber|lyft|bus|coach|transit|transport/i.test(text)) return '🚗';
  if (/hotel|lodging|accommodation|albergo|b&b|hostel|resort|villa|inn|airbnb|motel|stay/i.test(text)) return '🛏';
  if (/restaurant|food|dining|ristorante|trattoria|osteria|pizzeria|bistro|cafe|café|bar|pub|bakery|gelateria|breakfast|lunch|dinner/i.test(text)) return '🍽';
  if (/museum|museo|monument|cathedral|duomo|basilica|church|chiesa|castle|castello|palace|palazzo|ruins|sightseeing|landmark|tower/i.test(text)) return '🏛';
  if (/tour|activity|excursion|hike|hiking|trail|snorkeling|kayak|ski|experience|theater|theatre|concert|tickets|spa/i.test(text)) return '🎟';
  if (/shopping|mall|market|mercato|store|shop|boutique|outlet/i.test(text)) return '🛍';
  if (/beach|spiaggia|park|parco|garden|lake|waterfall|mountain|nature|peak/i.test(text)) return '🌲';

  return '📍';
}
