import { prisma } from '../db.js';
import type { BookingType } from '@prisma/client';
import { cleanAirportCity, toDayKey, reconcileTripDays } from './dayReconciliation.js';

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
  address?: string;
  checkInTimeStr?: string;
  checkOutTimeStr?: string;
  host?: string;
  type?: BookingType;
  title?: string;
  notes?: string;
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

const MONTH_PREFIXES = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun',
  'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
];

export function parseDateTimeString(dateStr: string): Date | undefined {
  if (!dateStr) return undefined;
  const cleaned = dateStr.trim();

  // Try regex for "September 28, 2026 12:56 PM" or "Sep 28, 2026 05:35 PM" or "28 Sep 2026 12:56"
  const m = /([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?)?/i.exec(cleaned);
  if (m) {
    const monthPrefix = m[1].toLowerCase().slice(0, 3);
    const monthIdx = MONTH_PREFIXES.indexOf(monthPrefix);
    if (monthIdx >= 0) {
      const day = parseInt(m[2], 10);
      const year = parseInt(m[3], 10);
      let hour = m[4] ? parseInt(m[4], 10) : 12;
      const min = m[5] ? parseInt(m[5], 10) : 0;
      const sec = m[6] ? parseInt(m[6], 10) : 0;
      const ampm = m[7]?.toUpperCase();
      if (ampm === 'PM' && hour < 12) hour += 12;
      if (ampm === 'AM' && hour === 12) hour = 0;
      return new Date(Date.UTC(year, monthIdx, day, hour, min, sec));
    }
  }

  // Handle ISO strings e.g. "2026-09-28T12:56:00.000Z" or "2026-09-28 12:56"
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/i.exec(cleaned);
  if (isoMatch) {
    const y = parseInt(isoMatch[1], 10);
    const mo = parseInt(isoMatch[2], 10) - 1;
    const d = parseInt(isoMatch[3], 10);
    const h = isoMatch[4] ? parseInt(isoMatch[4], 10) : 12;
    const mi = isoMatch[5] ? parseInt(isoMatch[5], 10) : 0;
    const s = isoMatch[6] ? parseInt(isoMatch[6], 10) : 0;
    return new Date(Date.UTC(y, mo, d, h, mi, s));
  }

  const d = new Date(cleaned);
  return Number.isNaN(d.getTime()) ? undefined : d;
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

    const fromCity = cleanAirportCity(origin[1]);
    const toCity = cleanAirportCity(destination[1]);
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

export function extractHotelInfo(rawText: string): ExtractedBookingInfo {
  const text = sanitizeReceiptText(rawText);

  // 1. Reference / Confirmation code
  let reference: string | undefined;
  const refMatch =
    /(?:confirmation\s*(?:code|number|#)?|reservation\s*(?:code|number|#)|booking\s*(?:code|number|#|reference)|pin\s*code|pnr|record\s*locator)[\s:]*([A-Z0-9-]{5,15})\b/i.exec(
      text,
    );
  if (refMatch) {
    reference = refMatch[1].toUpperCase();
  }

  // 2. Dates & check-in / check-out times
  let startDate: Date | undefined;
  let endDate: Date | undefined;
  let checkInTimeStr: string | undefined;
  let checkOutTimeStr: string | undefined;

  const checkInDateMatch =
    /check-in[\s\S]*?(?:(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)[,\s]+)?([A-Za-z]+\s+\d{1,2},\s+\d{4})/i.exec(
      text,
    );
  const checkInTimeMatch =
    /check-in[\s\S]*?(?:After|From|at)?\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM))/i.exec(
      text,
    );

  if (checkInDateMatch) {
    const rawTime = checkInTimeMatch ? checkInTimeMatch[1].trim() : '';
    if (rawTime) checkInTimeStr = rawTime;
    const combined = rawTime ? `${checkInDateMatch[1]} ${rawTime}` : checkInDateMatch[1];
    startDate = parseDateTimeString(combined);
  }

  const checkOutDateMatch =
    /check-out[\s\S]*?(?:(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)[,\s]+)?([A-Za-z]+\s+\d{1,2},\s+\d{4})/i.exec(
      text,
    );
  const checkOutTimeMatch =
    /check-out[\s\S]*?(?:Before|Until|By|at)?\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM))/i.exec(
      text,
    );

  if (checkOutDateMatch) {
    const rawTime = checkOutTimeMatch ? checkOutTimeMatch[1].trim() : '';
    if (rawTime) checkOutTimeStr = rawTime;
    const combined = rawTime ? `${checkOutDateMatch[1]} ${rawTime}` : checkOutDateMatch[1];
    endDate = parseDateTimeString(combined);
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

  // 3. Address
  let address: string | undefined;
  const addrMatch =
    /(?:Property\s*address|Hotel\s*address|Address)[\s:]*\n+([\s\S]+?)(?=\n\s*(?:This is|Host|Price|Payment|Total|Guests|Cancellation|Directions|\n{2,}|$))/i.exec(
      text,
    );
  if (addrMatch) {
    address = addrMatch[1]
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !/^This is/i.test(l))
      .join(', ');
  }

  // 4. Host / Provider
  let host: string | undefined;
  const hostMatch = /Host[\s:]*\n+([^\n]+)/i.exec(text);
  if (hostMatch) {
    host = hostMatch[1].trim();
  }

  let provider = host || 'Accommodation';
  if (/airbnb/i.test(text)) provider = host ? `Airbnb (${host})` : 'Airbnb';
  else if (/booking\.com/i.test(text)) provider = 'Booking.com';
  else if (/vrbo/i.test(text)) provider = 'VRBO';
  else if (/marriott/i.test(text)) provider = 'Marriott';
  else if (/hilton/i.test(text)) provider = 'Hilton';
  else if (/hyatt/i.test(text)) provider = 'Hyatt';

  // 5. Total amount & currency
  let totalAmount: number | undefined;
  let currency = 'USD';
  const totalMatch =
    /(?:Total(?:\s*paid)?|Grand\s*total)[\s:]*([€$£¥]?)\s*([\d,]+(?:\.\d{2})?)\s*([A-Z]{3})?/i.exec(
      text,
    );
  if (totalMatch) {
    if (totalMatch[1] === '€' || totalMatch[3] === 'EUR') currency = 'EUR';
    else if (totalMatch[1] === '£' || totalMatch[3] === 'GBP') currency = 'GBP';
    else if (totalMatch[1] === '¥' || totalMatch[3] === 'JPY') currency = 'JPY';
    else if (totalMatch[3]) currency = totalMatch[3].toUpperCase();

    totalAmount = parseFloat(totalMatch[2].replace(/,/g, ''));
  }

  // 6. Property Title
  let title: string | undefined;
  const titleMatch =
    /(?:Your reservation is confirmed|Reservation confirmed|Booking confirmed)[\s\r\n]+([^\n\r]+)/i.exec(
      text,
    );
  if (titleMatch) {
    title = titleMatch[1].trim();
  }

  return {
    provider,
    reference,
    totalAmount,
    currency,
    legs: [],
    startDate,
    endDate,
    address,
    checkInTimeStr,
    checkOutTimeStr,
    host,
    type: 'hotel',
    title,
  };
}

export function extractBookingInfo(rawText: string): ExtractedBookingInfo {
  const flightInfo = extractFlightLegs(rawText);
  if (flightInfo.legs.length > 0) {
    return flightInfo;
  }

  const hotelInfo = extractHotelInfo(rawText);
  if (hotelInfo.startDate || hotelInfo.reference || hotelInfo.address || hotelInfo.totalAmount) {
    return hotelInfo;
  }

  return flightInfo;
}

export interface BookingSyncFallback {
  type?: BookingType;
  provider?: string;
  reference?: string;
  startAt?: Date;
  endAt?: Date;
  totalAmount?: number;
  currency?: string;
  legs?: ExtractedFlightLeg[];
  address?: string;
  notes?: string;
}

export async function syncBookingToItinerary(
  tripId: string,
  userId: string,
  bookingId: string,
  rawSourceText: string,
  fallbackTitle = 'Booking',
  fallback: BookingSyncFallback = {},
): Promise<{ daysAdded: number; placesAdded: number; expenseAdded: boolean }> {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: { days: { orderBy: { date: 'asc' } } },
  });
  if (!trip) return { daysAdded: 0, placesAdded: 0, expenseAdded: false };

  const info = extractBookingInfo(rawSourceText);

  // If fallback provided structured legs (e.g. from LLM extraction), use them or merge
  if (fallback.legs && fallback.legs.length > 0) {
    if (info.legs.length === 0) {
      info.legs = fallback.legs;
    } else {
      // Merge structured fields if regex missed any leg or seats
      info.legs = info.legs.map((leg, idx) => {
        const fbLeg = fallback.legs?.[idx];
        if (!fbLeg) return leg;
        return {
          ...leg,
          seat: leg.seat || fbLeg.seat,
          flightClass: leg.flightClass || fbLeg.flightClass,
          flightNumber: leg.flightNumber || fbLeg.flightNumber,
          carrier: leg.carrier === 'Airline' && fbLeg.carrier ? fbLeg.carrier : leg.carrier,
          departTime: leg.departTime || fbLeg.departTime,
          arriveTime: leg.arriveTime || fbLeg.arriveTime,
        };
      });
      if (fallback.legs.length > info.legs.length) {
        info.legs.push(...fallback.legs.slice(info.legs.length));
      }
    }
  }

  // The LLM has already extracted structured booking fields. Use them whenever
  // receipt regexes cannot understand a vendor's particular confirmation layout.
  if ((!info.provider || info.provider === 'Airline' || info.provider === 'Accommodation') && fallback.provider) {
    info.provider = fallback.provider;
  }
  if (!info.reference && fallback.reference) info.reference = fallback.reference;
  if (!info.startDate && fallback.startAt) info.startDate = fallback.startAt;
  if (!info.endDate && fallback.endAt) info.endDate = fallback.endAt;
  if (!info.address && fallback.address) info.address = fallback.address;
  if (!info.notes && fallback.notes) info.notes = fallback.notes;
  if ((!info.totalAmount || info.totalAmount <= 0) && fallback.totalAmount && fallback.totalAmount > 0) {
    info.totalAmount = fallback.totalAmount;
  }
  if (fallback.currency && (!info.currency || info.currency === 'USD')) {
    info.currency = fallback.currency.toUpperCase();
  }

  let daysAdded = 0;
  let placesAdded = 0;
  let expenseAdded = false;

  const getOrCreateDay = async (date: Date): Promise<string> => {
    const key = toDayKey(date);
    const existing = await prisma.day.findMany({ where: { tripId }, orderBy: { date: 'asc' } });
    const hit = existing.find((d) => toDayKey(d.date) === key);
    if (hit) return hit.id;

    const newDay = await prisma.day.create({
      data: { tripId, date, label: null, sortOrder: existing.length },
    });
    daysAdded++;
    return newDay.id;
  };

  const cleanTitle = fallbackTitle.replace(/^(?:🏨|✈️|🚗|🎟️|🛬|🏠|📍)\s*/, '').trim();

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

      // If flight arrives on the next day (overnight flight), add arrival place on arrival day
      if (leg.arriveTime && leg.departTime && toDayKey(leg.arriveTime) !== toDayKey(leg.departTime)) {
        const arrivalDayId = await getOrCreateDay(leg.arriveTime);
        const arrivalTitle = leg.flightNumber
          ? `🛬 Arrive ${leg.toCity} (${leg.toCode}) — ${leg.carrier} ${leg.flightNumber}`
          : `🛬 Arrive ${leg.toCity} (${leg.toCode}) — ${leg.carrier}`;

        const existingArrival = await prisma.place.findFirst({
          where: { tripId, dayId: arrivalDayId, name: arrivalTitle },
        });

        if (!existingArrival) {
          const count = await prisma.place.count({ where: { tripId } });
          const notesParts = [
            `Arrives ${leg.arriveTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
            info.reference ? `Confirmation: ${info.reference}` : '',
            leg.seat ? `Seat: ${leg.seat}` : '',
          ].filter(Boolean);

          await prisma.place.create({
            data: {
              tripId,
              dayId: arrivalDayId,
              name: arrivalTitle,
              category: 'Transport',
              address: `${leg.toCity} Airport (${leg.toCode})`,
              startTime: leg.arriveTime,
              endTime: leg.arriveTime,
              notes: notesParts.join(' · ') || undefined,
              sortOrder: count,
              sourceText: rawSourceText.slice(0, 10_000),
            },
          });
          placesAdded++;
        }
      }
    }
  } else if (
    fallback.type === 'hotel' ||
    info.type === 'hotel' ||
    /hotel|apartment|airbnb|hostel|villa|resort|accommodation|lodging/i.test(fallbackTitle) ||
    /check-in|property address/i.test(rawSourceText)
  ) {
    // Multi-day hotel / accommodation reservation: add entry for EVERY day of the stay
    const startDate = info.startDate || fallback.startAt || trip.startDate;
    const endDate = info.endDate || fallback.endAt;
    const address = fallback.address || info.address;

    if (startDate) {
      const stayDates: Date[] = [];
      if (endDate && toDayKey(endDate) >= toDayKey(startDate)) {
        const endKey = toDayKey(endDate);
        const curr = new Date(startDate);
        while (toDayKey(curr) <= endKey && stayDates.length < 60) {
          stayDates.push(new Date(curr));
          curr.setUTCDate(curr.getUTCDate() + 1);
        }
      } else {
        stayDates.push(new Date(startDate));
      }

      const baseNotesParts = [
        info.reference ? `Confirmation: ${info.reference}` : (fallback.reference ? `Confirmation: ${fallback.reference}` : ''),
        info.host ? `Host: ${info.host}` : '',
        info.notes || fallback.notes || '',
      ].filter(Boolean);

      for (let idx = 0; idx < stayDates.length; idx++) {
        const date = stayDates[idx];
        const dayId = await getOrCreateDay(date);
        const isFirstDay = idx === 0;
        const isLastDay = idx === stayDates.length - 1 && stayDates.length > 1;

        let name: string;
        let startTime: Date | undefined;
        let endTime: Date | undefined;
        const dayNotesParts = [...baseNotesParts];

        if (stayDates.length === 1) {
          name = `🏨 ${cleanTitle}`;
          startTime = startDate;
          endTime = endDate;
        } else if (isFirstDay) {
          name = `🏨 Check-in: ${cleanTitle}`;
          startTime = startDate;
          if (info.checkInTimeStr) dayNotesParts.push(`Check-in: ${info.checkInTimeStr}`);
        } else if (isLastDay) {
          name = `🏨 Check-out: ${cleanTitle}`;
          startTime = endDate;
          endTime = endDate;
          if (info.checkOutTimeStr) dayNotesParts.push(`Check-out: ${info.checkOutTimeStr}`);
        } else {
          name = `🏨 Stay: ${cleanTitle}`;
        }

        const existingPlace = await prisma.place.findFirst({
          where: {
            tripId,
            dayId,
            OR: [{ name }, { name: { contains: cleanTitle } }],
          },
        });

        if (!existingPlace) {
          const count = await prisma.place.count({ where: { tripId } });
          await prisma.place.create({
            data: {
              tripId,
              dayId,
              name,
              category: 'Accommodation',
              address: address || undefined,
              startTime,
              endTime,
              notes: dayNotesParts.join(' · ') || undefined,
              sortOrder: count,
              sourceText: rawSourceText.slice(0, 10_000),
            },
          });
          placesAdded++;
        }
      }
    }
  } else if (fallback.type === 'car') {
    // Rental car handling
    const startDate = info.startDate || fallback.startAt || trip.startDate;
    const endDate = info.endDate || fallback.endAt;
    const address = fallback.address || info.address;

    if (startDate) {
      const dayId = await getOrCreateDay(startDate);
      const isMultiDay = endDate && toDayKey(endDate) !== toDayKey(startDate);
      const pickupName = isMultiDay ? `🚗 Pick-up: ${cleanTitle}` : `🚗 ${cleanTitle}`;

      const existingPlace = await prisma.place.findFirst({
        where: { tripId, dayId, name: pickupName },
      });

      if (!existingPlace) {
        const count = await prisma.place.count({ where: { tripId } });
        await prisma.place.create({
          data: {
            tripId,
            dayId,
            name: pickupName,
            category: 'Transport',
            address: address || undefined,
            startTime: startDate,
            endTime: isMultiDay ? undefined : endDate,
            notes: info.reference ? `Confirmation: ${info.reference}` : (fallback.reference ? `Confirmation: ${fallback.reference}` : undefined),
            sortOrder: count,
            sourceText: rawSourceText.slice(0, 10_000),
          },
        });
        placesAdded++;
      }

      if (isMultiDay && endDate) {
        const dropoffDayId = await getOrCreateDay(endDate);
        const dropoffName = `🚗 Drop-off: ${cleanTitle}`;
        const existingDropoff = await prisma.place.findFirst({
          where: { tripId, dayId: dropoffDayId, name: dropoffName },
        });
        if (!existingDropoff) {
          const count = await prisma.place.count({ where: { tripId } });
          await prisma.place.create({
            data: {
              tripId,
              dayId: dropoffDayId,
              name: dropoffName,
              category: 'Transport',
              address: address || undefined,
              startTime: endDate,
              endTime: endDate,
              notes: info.reference ? `Confirmation: ${info.reference}` : (fallback.reference ? `Confirmation: ${fallback.reference}` : undefined),
              sortOrder: count,
              sourceText: rawSourceText.slice(0, 10_000),
            },
          });
          placesAdded++;
        }
      }
    }
  } else {
    // Fallback: create a useful itinerary item from structured dates
    const itineraryDate = info.startDate || fallback.startAt || trip.startDate;
    if (itineraryDate) {
      const dayId = await getOrCreateDay(itineraryDate);
      const icon = fallback.type === 'activity' ? '🎟️' : '📍';
      const category = fallback.type === 'activity' ? 'Activity' : 'Transport';
      const name = `${icon} ${cleanTitle}`;

      const existingPlace = await prisma.place.findFirst({
        where: { tripId, dayId, name: { contains: cleanTitle } },
      });

      if (!existingPlace) {
        const count = await prisma.place.count({ where: { tripId } });
        await prisma.place.create({
          data: {
            tripId,
            dayId,
            name,
            category,
            address: fallback.address || info.address || undefined,
            startTime: info.startDate || fallback.startAt,
            endTime: info.endDate || fallback.endAt,
            notes: info.reference ? `Confirmation: ${info.reference}` : (fallback.reference ? `Confirmation: ${fallback.reference}` : undefined),
            sortOrder: count,
            sourceText: rawSourceText.slice(0, 10_000),
          },
        });
        placesAdded++;
      }

      if (fallback.type === 'flight' && info.endDate && info.startDate && toDayKey(info.endDate) !== toDayKey(info.startDate)) {
        const returnDayId = await getOrCreateDay(info.endDate);
        const returnName = `✈️ Return: ${cleanTitle}`;
        const existingReturn = await prisma.place.findFirst({
          where: { tripId, dayId: returnDayId, name: returnName },
        });
        if (!existingReturn) {
          const count = await prisma.place.count({ where: { tripId } });
          await prisma.place.create({
            data: {
              tripId,
              dayId: returnDayId,
              name: returnName,
              category: 'Transport',
              startTime: info.endDate,
              sortOrder: count,
              sourceText: rawSourceText.slice(0, 10_000),
            },
          });
          placesAdded++;
        }
      }
    }
  }

  // 2. Automatically log expense if price is extracted
  if (info.totalAmount && info.totalAmount > 0) {
    const isHotelBooking =
      fallback.type === 'hotel' ||
      info.type === 'hotel' ||
      /hotel|apartment|airbnb|hostel|villa|resort|accommodation|lodging/i.test(fallbackTitle) ||
      /check-in|property address/i.test(rawSourceText);
    const isActivityBooking = fallback.type === 'activity';

    const expenseCategory = isHotelBooking
      ? 'lodging'
      : isActivityBooking
      ? 'activity'
      : 'transport';

    const existingExpense = await prisma.expense.findFirst({
      where: {
        tripId,
        amount: info.totalAmount,
        category: expenseCategory,
      },
    });

    if (!existingExpense) {
      const descProvider =
        info.provider && info.provider !== 'Airline' && info.provider !== 'Accommodation'
          ? info.provider
          : fallback.provider || cleanTitle;

      await prisma.expense.create({
        data: {
          tripId,
          userId,
          description: `${descProvider} ${info.reference ? `(${info.reference})` : ''}`.trim(),
          amount: info.totalAmount,
          currency: info.currency || 'USD',
          category: expenseCategory,
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

  const recon = await reconcileTripDays(tripId);
  daysAdded += recon.daysAdded;

  return { daysAdded, placesAdded, expenseAdded };
}
