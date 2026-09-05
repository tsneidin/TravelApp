/**
 * Service for inferring and normalizing travel categories and icons.
 */

export const STANDARD_CATEGORIES = [
  'Flight',
  'Train',
  'Transport',
  'Accommodation',
  'Restaurant',
  'Sightseeing',
  'Activity',
  'Shopping',
  'Nature',
  'Other',
] as const;

export type StandardCategory = typeof STANDARD_CATEGORIES[number];

/**
 * Infer the travel category from place name, address, description, or notes.
 */
export function inferCategoryFromText(text: string): string {
  const t = (text || '').toLowerCase();

  // 1. Flights / Airports / Air travel
  if (/✈|flight|airport|\bterminal\b|\bboarding\b|\bairline\b|\b[a-z]{3}\s*(?:→|->|to)\s*[a-z]{3}\b/i.test(t)) {
    return 'Flight';
  }

  // 2. Trains / Rail
  if (/\b(?:train|rail|eurostar|italo|frecciarossa|tgv|ice|amtrak|station|stazione|gare|bahnhof)\b/i.test(t)) {
    return 'Train';
  }

  // 3. Ferry / Boat
  if (/\b(?:ferry|boat|cruise|port|hydrofoil|aliscafi|traghetto)\b/i.test(t)) {
    return 'Transport';
  }

  // 4. Car / Rental / Transit
  if (/\b(?:car rental|rent-a-car|enterprise|hertz|avis|sixt|budget|alamo|europcar|driving|taxi|uber|cab|lyft|bus|coach|transit|subway|metro)\b/i.test(t)) {
    return 'Transport';
  }

  // 5. Lodging / Accommodations
  if (/\b(?:hotel|albergo|b&b|bed & breakfast|hostel|resort|villa|inn|motel|suites|airbnb|guesthouse|lodge|campsite|campground|stay)\b/i.test(t)) {
    return 'Accommodation';
  }

  // 6. Food & Dining / Cafes / Bars
  if (/\b(?:restaurant|ristorante|trattoria|osteria|pizzeria|taverna|bistro|cafe|café|bar|pub|bakery|pasticceria|gelateria|wine bar|brewery|diner|brunch|dinner|lunch|breakfast|food)\b/i.test(t)) {
    return 'Restaurant';
  }

  // 7. Sightseeing / Historical / Cultural
  if (/\b(?:museum|museo|monument|statue|cathedral|duomo|basilica|church|chiesa|castle|castello|palace|palazzo|ruins|archaeological|tower|torre|bridge|ponte|viewpoint|lookout|square|piazza|historic|sightseeing|landmark)\b/i.test(t)) {
    return 'Sightseeing';
  }

  // 8. Activities / Tours / Entertainment
  if (/\b(?:tour|guided tour|excursion|experience|kayak|diving|snorkeling|hike|hiking|trail|trek|ski|skiing|theme park|waterpark|aquarium|zoo|spa|massage|theater|theatre|concert|show|cooking class|wine tasting)\b/i.test(t)) {
    return 'Activity';
  }

  // 9. Shopping
  if (/\b(?:shopping|mall|market|mercato|bazaar|outlet|boutique|store|shop)\b/i.test(t)) {
    return 'Shopping';
  }

  // 10. Nature / Outdoors / Beach
  if (/\b(?:beach|spiaggia|park|parco|garden|giardino|lake|lago|waterfall|cascata|canyon|gorge|mountain|monte|peak|forest|cliff)\b/i.test(t)) {
    return 'Nature';
  }

  return 'Sightseeing';
}
