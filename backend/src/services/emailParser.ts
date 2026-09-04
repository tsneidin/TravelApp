import type { BookingType } from '@prisma/client';

export interface ParsedConfirmation {
  type: BookingType;
  title: string;
  provider?: string;
  reference?: string;
  startAt?: Date;
  endAt?: Date;
  address?: string;
  details: Record<string, string>;
  confidence: number; // 0..1
}

const MONTHS_SHORT = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec';

const DATE_PATTERNS: [string, RegExp][] = [
  ['ymd', /\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/],
  ['mdy', /\b(\d{1,2})[-/](\d{1,2})[-/](20\d{2})\b/],
  [
    'monDayY',
    new RegExp(
      `\\b(${MONTHS_SHORT})\\.?[ ]?(\\d{1,2})(?:st|nd|rd|th)?[,]?[ ]*(20\\d{2})\\b`,
      'i',
    ),
  ],
];

function parseDate(text: string): Date | undefined {
  for (const entry of DATE_PATTERNS) {
    const m = entry[1].exec(text);
    if (!m) continue;
    let d: Date | null = null;
    if (entry[0] === 'ymd') {
      d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    } else if (entry[0] === 'mdy') {
      d = new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
    } else {
      const mon = MONTHS_SHORT.split('|').indexOf(m[1].toLowerCase());
      d = new Date(Number(m[3]), mon, Number(m[2]));
    }
    if (d && !Number.isNaN(d.getTime())) return d;
  }
  return undefined;
}

function clean(s: string | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

const FLIGHT_HINTS = ['flight', 'boarding pass', 'eticket', 'e-ticket', 'airline', 'departure', 'arrival'];
const HOTEL_HINTS = ['hotel', 'reservation', 'booking confirmation', 'booking-confirmation', 'check-in', 'check in', 'stay at', 'room'];
const CAR_HINTS = ['rental agreement', 'car rental', 'rental car', 'vehicle', 'pick-up', 'pickup', 'hertz', 'enterprise', 'avis', 'budget'];
const ACTIVITY_HINTS = ['tour', 'ticket', 'attraction', 'reservation confirmed', 'restaurant', 'experience', 'activity', 'cruise', 'admission'];

export function detectType(subject: string, body: string): BookingType | null {
  const hay = `${subject} ${body}`.toLowerCase();
  const score: Record<string, number> = {};
  const add = (hints: string[], t: string) =>
    hints.forEach((h) => {
      if (hay.includes(h)) score[t] = (score[t] ?? 0) + 1;
    });
  add(FLIGHT_HINTS, 'flight');
  add(HOTEL_HINTS, 'hotel');
  add(CAR_HINTS, 'car');
  add(ACTIVITY_HINTS, 'activity');

  const sorted = Object.entries(score).sort((a, b) => b[1] - a[1]);
  if (!sorted.length || sorted[0][1] < 2) return null;
  return sorted[0][0] as BookingType;
}

const AIRLINES = /(airlines?|air\s?france|delta|lufthansa|emirates|united|american\s?airlines|southwest|british\s?airways|qatar|singapore\s?air|klm|ryanair|easyjet|jet\s?blue)/i;
const HOTELS = /(marriott|hilton|holiday\s?inn|ibis|accor|hyatt|airbnb|booking\.com|expedia|choice\s?hotels|best\s?western|fairfield|radisson)/i;
const CARS = /(hertz|enterprise|avis|budget|alamo|sixt|europcar|turo|national\s?car)\b/i;

function extractReference(text: string): string | undefined {
  const pats = [
    /\bconfirmation\s*(?:number|#|no\.?|code)?\s*[:\-]?\s*([A-Z0-9\-]{4,16})\b/i,
    /\b(?:reservation|booking|reference)\s*(?:number|#|no\.?|code)?\s*[:\-]?\s*([A-Z0-9]{4,16})\b/i,
    /\b(?:pnr|booking\s*ref)\s*[:\-]?\s*([A-Z0-9]{5,8})\b/i,
  ];
  for (const p of pats) {
    const m = p.exec(text);
    if (m && /[A-Z0-9]/.test(m[1]) && !/^(number|code|no|#)$/i.test(m[1])) {
      return m[1].toUpperCase();
    }
  }
  return undefined;
}

function capitalise(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function parseConfirmation(subject: string, body: string): ParsedConfirmation | null {
  const joined = clean(`${subject}\n${body}`);
  const lower = joined.toLowerCase();
  const text = joined;

  const type = detectType(subject, body);
  if (!type) return null;

  const details: Record<string, string> = {};
  let title = clean(subject);
  let provider: string | undefined;
  let reference = extractReference(text);
  let address: string | undefined;
  const date = parseDate(text);

  const addressMatch =
    /\b(\d{1,5}\s+[A-Z][\w\s]{3,60}?(?:street|st\.?|avenue|ave\.?|road|rd\.?|boulevard|blvd\.?|way|lane|ln\.?|drive|dr\.?|court|ct\.?))/i.exec(
      text,
    );
  if (addressMatch) address = addressMatch[1].trim();

  switch (type) {
    case 'flight': {
      const airline = AIRLINES.exec(lower);
      if (airline) provider = capitalise(airline[1]);
      const flightNo = /\b([A-Z]{2}\d{3,4})\b/.exec(text);
      if (flightNo) reference = reference ?? flightNo[1];
      const dep = /(?:depart|from)\s+([A-Z]{3}|\w[\w\s-]{1,28})/i.exec(text);
      const arr = /(?:arriv|to)\s+([A-Z]{3}|\w[\w\s-]{1,28})/i.exec(text);
      details['origin'] = dep ? dep[1].trim() : '';
      details['destination'] = arr ? arr[1].trim() : '';
      break;
    }
    case 'hotel': {
      const brand = HOTELS.exec(lower);
      if (brand) provider = capitalise(brand[1]);
      if (!lower.includes('hotel') && clean(subject).length > 3) {
        title = clean(subject);
      }
      break;
    }
    case 'car': {
      const brand = CARS.exec(lower);
      if (brand) provider = capitalise(brand[1]);
      break;
    }
    case 'activity': {
      const tix = /(\d{1,3})\s*(?:x\s*)?(?:tickets?|adults?|guests?|persons?)/i.exec(text);
      if (tix) details['tickets'] = tix[0].trim();
      break;
    }
  }

  const strong =
    (type === 'flight' && Boolean(reference || details['destination'])) ||
    (type === 'hotel' && Boolean(provider || date)) ||
    (type === 'car' && Boolean(provider || reference)) ||
    (type === 'activity' && Boolean(date || reference));
  const confidence = strong ? 0.7 : 0.4;

  return {
    type,
    title: title || type,
    provider,
    reference,
    startAt: date,
    endAt: date,
    address,
    details,
    confidence,
  };
}