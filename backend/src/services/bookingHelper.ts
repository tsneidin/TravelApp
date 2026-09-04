import { prisma } from '../db.js';

export interface ExtractedFlightLeg {
  carrier: string;
  flightNumber: string;
  fromCity: string;
  fromCode: string;
  toCity: string;
  toCode: string;
  departTime?: Date;
  arriveTime?: Date;
  seat?: string;
  flightClass?: string;
}

export interface ExtractedBookingInfo {
  provider: string;
  reference?: string;
  totalAmount?: number;
  currency?: string;
  legs: ExtractedFlightLeg[];
  startDate?: Date;
  endDate?: Date;
}

/**
 * Handle doubled characters from PDF / clipboard artifacts
 * e.g. "RReecceeiipptt" -> "Receipt", "AAAA" -> "AA", "NNVVDDWWQQZZ" -> "NVDWQZ"
 */
export function sanitizeReceiptText(text: string): string {
  if (!text) return '';

  return text
    .split('\n')
    .map((line) => {
      const tokens = line.split(/(\s+)/);
      return tokens
        .map((tok) => {
          if (!tok || /^\s+$/.test(tok)) return tok;
          // Check if token has an even length >= 4 and every pair of characters is identical
          if (tok.length >= 4 && tok.length % 2 === 0) {
            let allPairs = true;
            for (let i = 0; i < tok.length; i += 2) {
              if (tok[i].toLowerCase() !== tok[i + 1].toLowerCase()) {
                allPairs = false;
                break;
              }
            }
            if (allPairs) {
              let collapsed = '';
              for (let i = 0; i < tok.length; i += 2) {
                collapsed += tok[i];
              }
              return collapsed;
            }
          }
          return tok;
        })
        .join('');
    })
    .join('\n');
}

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

function parseDateTimeString(dateStr: string): Date | undefined {
  if (!dateStr) return undefined;
  const cleaned = dateStr.trim();
  const d = new Date(cleaned);
  if (!Number.isNaN(d.getTime())) return d;

  // Try regex for "September 28, 2026 12:56 PM"
  const m = /([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*([AP]M)?)?/i.exec(cleaned);
  if (m) {
    const monthIdx = MONTH_NAMES.indexOf(m[1].toLowerCase());
    if (monthIdx >= 0) {
      const day = parseInt(m[2], 10);
      const year = parseInt(m[3], 10);
      let hour = m[4] ? parseInt(m[4], 10) : 12;
      const min = m[5] ? parseInt(m[5], 10) : 0;
      const ampm = m[6]?.toUpperCase();
      if (ampm === 'PM' && hour < 12) hour += 12;
      if (ampm === 'AM' && hour === 12) hour = 0;
      return new Date(year, monthIdx, day, hour, min);
    }
  }
  return undefined;
}

function toDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function extractFlightLegs(rawText: string): ExtractedBookingInfo {
  const text = sanitizeReceiptText(rawText);

  // Extract confirmation code (e.g. NVDWQZ)
  let reference: string | undefined;
  const refMatch =
    /(?:confirmation\s*(?:code|number|#)?|record\s*locator|pnr|reservation\s*code)[\s:]*([A-Z0-9]{5,8})\b/i.exec(
      text,
    );
  if (refMatch) {
    reference = refMatch[1].toUpperCase();
  }

  // Extract total amount & currency
  let totalAmount: number | undefined;
  let currency = 'USD';
  const priceMatch = /(?:total(?:\s*paid)?|flight\s*subtotal)[\s:]*[$€£¥]?\s*([\d,]+\.\d{2})\s*([A-Z]{3})?/i.exec(
    text,
  );
  if (priceMatch) {
    totalAmount = parseFloat(priceMatch[1].replace(/,/g, ''));
    if (priceMatch[2]) currency = priceMatch[2].toUpperCase();
  }

  // Detect airline / provider
  let provider = 'Airline';
  if (/american\s*airlines/i.test(text)) provider = 'American Airlines';
  else if (/delta/i.test(text)) provider = 'Delta Air Lines';
  else if (/united/i.test(text)) provider = 'United Airlines';
  else if (/southwest/i.test(text)) provider = 'Southwest Airlines';
  else if (/lufthansa/i.test(text)) provider = 'Lufthansa';
  else if (/british\s*airways/i.test(text)) provider = 'British Airways';
  else if (/air\s*france/i.test(text)) provider = 'Air France';

  // Extract flight legs by finding airport city-code-datetime anchors
  const legs: ExtractedFlightLeg[] = [];

  const airportMatches = Array.from(
    text.matchAll(
      /([A-Za-z\s]+?)\s*\(([A-Z]{3})\)\s*([A-Za-z]+\s+\d{1,2},\s+\d{4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM)?)?)/gi,
    ),
  );

  for (let i = 0; i < airportMatches.length; i += 2) {
    const origin = airportMatches[i];
    const destination = airportMatches[i + 1];
    if (!origin || !destination) break;

    const fromCode = origin[2].toUpperCase();
    const toCode = destination[2].toUpperCase();
    if (fromCode === toCode) continue;

    const fromCity = origin[1].trim();
    const toCity = destination[1].trim();
    const departTime = parseDateTimeString(origin[3].trim());
    const arriveTime = parseDateTimeString(destination[3].trim());

    // Search text around the flight segment. Pick the closest (last) flight number before origin.
    const searchBefore = text.slice(Math.max(0, (origin.index ?? 0) - 300), origin.index ?? 0);
    const searchMiddle = text.slice(origin.index ?? 0, destination.index ?? 0);

    const flightNumMatches = Array.from(
      searchBefore.matchAll(/(?:American Airlines|Envoy Air|United|Delta|Flight|AA|UA|DL)\s*(\d{1,4})/gi),
    );
    const lastFlightMatch = flightNumMatches[flightNumMatches.length - 1];
    const flightNumber = lastFlightMatch ? lastFlightMatch[1] : '';

    let carrier = provider;
    if (/envoy\s*air/i.test(searchBefore.slice(-150)) || /envoy\s*air/i.test(searchMiddle)) {
      carrier = 'American Airlines (Envoy Air)';
    } else if (/american\s*airlines/i.test(searchBefore)) {
      carrier = 'American Airlines';
    }

    const classMatch = /Class\s*:\s*([A-Za-z\s]+?)(?:\n|Seat|Booking|$)/i.exec(searchMiddle);
    const flightClass = classMatch ? classMatch[1].trim() : undefined;

    const seatMatch = /Seat\s*:\s*([^,\n]+(?:,\s*[^,\n]+)*)/i.exec(searchMiddle);
    let seat = seatMatch ? seatMatch[1].trim() : undefined;
    if (seat && (seat.includes('--') || seat === '-')) seat = undefined;

    legs.push({
      carrier,
      flightNumber,
      fromCity,
      fromCode,
      toCity,
      toCode,
      departTime,
      arriveTime,
      flightClass,
      seat,
    });
  }

  // Determine overall start & end dates
  let startDate: Date | undefined;
  let endDate: Date | undefined;

  for (const leg of legs) {
    if (leg.departTime) {
      if (!startDate || leg.departTime < startDate) startDate = leg.departTime;
      if (!endDate || leg.departTime > endDate) endDate = leg.departTime;
    }
    if (leg.arriveTime) {
      if (!endDate || leg.arriveTime > endDate) endDate = leg.arriveTime;
    }
  }

  if (!startDate) {
    const rangeMatch =
      /(?:(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+)?([A-Za-z]+\s+\d{1,2},\s+\d{4})\s*–\s*(?:(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\s+)?([A-Za-z]+\s+\d{1,2},\s+\d{4})/i.exec(
        text,
      );
    if (rangeMatch) {
      startDate = parseDateTimeString(rangeMatch[1]);
      endDate = parseDateTimeString(rangeMatch[2]);
    }
  }

  return {
    provider,
    reference,
    totalAmount,
    currency,
    legs,
    startDate,
    endDate,
  };
}

export async function syncBookingToItinerary(
  tripId: string,
  userId: string,
  bookingId: string,
  rawSourceText: string,
  fallbackTitle = 'Flight Booking',
): Promise<{ daysAdded: number; placesAdded: number; expenseAdded: boolean }> {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: { days: { orderBy: { date: 'asc' } } },
  });
  if (!trip) return { daysAdded: 0, placesAdded: 0, expenseAdded: false };

  const info = extractFlightLegs(rawSourceText);
  let daysAdded = 0;
  let placesAdded = 0;
  let expenseAdded = false;

  const getOrCreateDay = async (date: Date): Promise<string> => {
    const key = toDayKey(date);
    const existing = await prisma.day.findMany({ where: { tripId }, orderBy: { date: 'asc' } });
    const hit = existing.find((d) => toDayKey(d.date) === key);
    if (hit) return hit.id;

    const count = existing.length;
    const label = `Day ${count + 1}`;
    const newDay = await prisma.day.create({
      data: { tripId, date, label, sortOrder: count },
    });
    daysAdded++;
    return newDay.id;
  };

  // 1. Process explicit flight legs
  if (info.legs.length > 0) {
    for (const leg of info.legs) {
      const legDate = leg.departTime || leg.arriveTime || info.startDate || new Date();
      const dayId = await getOrCreateDay(legDate);

      const flightTitle = leg.flightNumber
        ? `✈️ ${leg.carrier} ${leg.flightNumber}: ${leg.fromCity} (${leg.fromCode}) → ${leg.toCity} (${leg.toCode})`
        : `✈️ ${leg.carrier}: ${leg.fromCity} (${leg.fromCode}) → ${leg.toCity} (${leg.toCode})`;

      // Check if place already exists on this day
      const existingPlace = await prisma.place.findFirst({
        where: { tripId, dayId, name: flightTitle },
      });

      if (!existingPlace) {
        const count = await prisma.place.count({ where: { tripId } });
        const notesParts = [
          info.reference ? `Confirmation: ${info.reference}` : '',
          leg.seat ? `Seat: ${leg.seat}` : '',
          leg.flightClass ? `Class: ${leg.flightClass}` : '',
        ].filter(Boolean);

        await prisma.place.create({
          data: {
            tripId,
            dayId,
            name: flightTitle,
            category: 'Transport',
            address: `${leg.fromCity} Airport (${leg.fromCode})`,
            startTime: leg.departTime,
            endTime: leg.arriveTime,
            notes: notesParts.join(' · ') || undefined,
            sortOrder: count,
            sourceText: rawSourceText.slice(0, 10_000),
          },
        });
        placesAdded++;
      }
    }
  } else if (info.startDate) {
    // Fallback: Single departure place from booking dates
    const dayId = await getOrCreateDay(info.startDate);
    const existingPlace = await prisma.place.findFirst({
      where: { tripId, dayId, name: { contains: fallbackTitle } },
    });

    if (!existingPlace) {
      const count = await prisma.place.count({ where: { tripId } });
      await prisma.place.create({
        data: {
          tripId,
          dayId,
          name: `✈️ ${fallbackTitle}`,
          category: 'Transport',
          startTime: info.startDate,
          endTime: info.endDate,
          notes: info.reference ? `Confirmation: ${info.reference}` : undefined,
          sortOrder: count,
          sourceText: rawSourceText.slice(0, 10_000),
        },
      });
      placesAdded++;
    }

    if (info.endDate && toDayKey(info.endDate) !== toDayKey(info.startDate)) {
      const returnDayId = await getOrCreateDay(info.endDate);
      const count = await prisma.place.count({ where: { tripId } });
      await prisma.place.create({
        data: {
          tripId,
          dayId: returnDayId,
          name: `✈️ Return: ${fallbackTitle}`,
          category: 'Transport',
          startTime: info.endDate,
          sortOrder: count,
        },
      });
      placesAdded++;
    }
  }

  // 2. Automatically log expense if price is extracted
  if (info.totalAmount && info.totalAmount > 0) {
    const existingExpense = await prisma.expense.findFirst({
      where: {
        tripId,
        amount: info.totalAmount,
        category: 'transport',
      },
    });

    if (!existingExpense) {
      await prisma.expense.create({
        data: {
          tripId,
          userId,
          description: `${info.provider} ${info.reference ? `(${info.reference})` : 'Flights'}`,
          amount: info.totalAmount,
          currency: info.currency || 'USD',
          category: 'transport',
          date: info.startDate || new Date(),
        },
      });
      expenseAdded = true;
    }
  }

  // 3. Extend trip dates if booking dates exceed current trip bounds
  const updateData: Record<string, unknown> = {};
  if (info.startDate && (!trip.startDate || info.startDate < trip.startDate)) {
    updateData.startDate = info.startDate;
  }
  if (info.endDate && (!trip.endDate || info.endDate > trip.endDate)) {
    updateData.endDate = info.endDate;
  }
  if (Object.keys(updateData).length > 0) {
    await prisma.trip.update({
      where: { id: tripId },
      data: updateData,
    });
  }

  return { daysAdded, placesAdded, expenseAdded };
}
