import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { BookingType } from '@prisma/client';
import type { ParsedConfirmation } from './emailParser.js';

const execFileAsync = promisify(execFile);
const supportedExtensions = new Set(['eml', 'pdf', 'txt', 'html', 'htm', 'ics', 'pkpass', 'png', 'jpg', 'jpeg']);

type JsonRecord = Record<string, unknown>;

export interface KitineraryCandidate {
  type: BookingType;
  title: string;
  provider?: string;
  reference?: string;
  startAt?: string;
  endAt?: string;
  address?: string;
  price?: number;
  currency?: string;
  cancelled?: boolean;
  details: Record<string, string>;
  source: 'kitinerary' | 'llm';
}

export function needsEmailAiCompletion(candidates: KitineraryCandidate[]): boolean {
  return !candidates.length || candidates.some((candidate) => candidate.type === 'hotel' && (!candidate.startAt || !candidate.endAt));
}

export function completeKitineraryCandidates(candidates: KitineraryCandidate[], fallback: ParsedConfirmation | null): KitineraryCandidate[] {
  if (!fallback) return candidates;
  return candidates.map((candidate) => {
    if (candidate.type !== fallback.type) return candidate;
    const startMissing = !candidate.startAt || candidate.startAt.length === 10;
    const endMissing = !candidate.endAt || candidate.endAt.length === 10;
    return {
      ...candidate,
      startAt: startMissing ? fallback.startAt?.toISOString() || candidate.startAt : candidate.startAt,
      endAt: endMissing ? fallback.endAt?.toISOString() || candidate.endAt : candidate.endAt,
      details: {
        ...candidate.details,
        ...(startMissing && fallback.details.localStartAt ? { localStartAt: fallback.details.localStartAt } : {}),
        ...(endMissing && fallback.details.localEndAt ? { localEndAt: fallback.details.localEndAt } : {}),
      },
    };
  });
}

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
}

function string(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function name(value: unknown): string {
  return string(record(value).name) || string(value);
}

function dateTime(value: unknown): string | undefined {
  const raw = string(record(value)['@value']) || string(value);
  return raw && !Number.isNaN(Date.parse(raw)) ? raw : undefined;
}

function address(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  const location = record(value);
  const parts = [location.streetAddress, location.addressLocality, location.addressRegion, location.postalCode, location.addressCountry]
    .map(string).filter(Boolean);
  return parts.join(', ') || undefined;
}

function reservationType(value: string): BookingType | undefined {
  if (value === 'FlightReservation') return 'flight';
  if (value === 'LodgingReservation') return 'hotel';
  if (value === 'RentalCarReservation') return 'car';
  if (['BusReservation', 'TrainReservation', 'BoatReservation', 'TaxiReservation', 'FoodEstablishmentReservation', 'EventReservation'].includes(value)) return 'activity';
  return undefined;
}

export function normalizeKitineraryOutput(output: unknown): KitineraryCandidate[] {
  const entries = Array.isArray(output) ? output : record(output)['@graph'];
  if (!Array.isArray(entries)) return [];
  const seen = new Set<string>();
  const candidates: KitineraryCandidate[] = [];

  for (const value of entries) {
    const reservation = record(value);
    const kind = string(reservation['@type']);
    const type = reservationType(kind);
    if (!type) continue;

    const trip = record(reservation.reservationFor);
    const isHotel = type === 'hotel';
    const isTransport = ['FlightReservation', 'TrainReservation', 'BusReservation', 'BoatReservation'].includes(kind);
    const origin = name(trip.departureAirport || trip.departureStation || trip.departureBusStop || trip.departureBoatTerminal);
    const destination = name(trip.arrivalAirport || trip.arrivalStation || trip.arrivalBusStop || trip.arrivalBoatTerminal);
    const route = [origin, destination].filter(Boolean).join(' → ');
    const carrier = name(trip.airline || trip.trainCompany || trip.busCompany || trip.provider);
    const placeName = name(reservation.reservationFor);
    const provider = name(reservation.provider) || name(trip.rentalCompany) || (isHotel ? placeName : carrier) || undefined;
    const number = string(trip.flightNumber || trip.trainNumber || trip.busNumber);
    const label = kind.replace(/Reservation$/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
    const title = isHotel ? placeName || provider || 'Hotel stay'
      : type === 'car' ? [provider || 'Rental car', placeName].filter(Boolean).join(': ')
      : isTransport ? [label, carrier, number, route].filter(Boolean).join(' ').trim()
      : placeName || [label, provider].filter(Boolean).join(' ');
    const startAt = dateTime(reservation.checkinTime || reservation.pickupTime || trip.departureTime || trip.startDate || trip.startTime);
    const endAt = dateTime(reservation.checkoutTime || reservation.dropoffTime || trip.arrivalTime || trip.endDate || trip.endTime);
    const reference = string(reservation.reservationNumber) || undefined;
    const ticket = record(reservation.reservedTicket);
    const rawPrice = reservation.totalPrice ?? ticket.totalPrice;
    const price = typeof rawPrice === 'number' && Number.isFinite(rawPrice) && rawPrice >= 0 ? rawPrice : undefined;
    const rawCurrency = string(reservation.priceCurrency || ticket.priceCurrency).toUpperCase();
    const currency = /^[A-Z]{3}$/.test(rawCurrency) ? rawCurrency : undefined;
    const location = address(record(trip.location || reservation.pickupLocation).address || trip.address);
    const details = Object.fromEntries([
      ['kitineraryType', kind], ['origin', origin], ['destination', destination],
      ['number', number], ['timezone', string(record(reservation.checkinTime || trip.departureTime).timezone)],
      ['localStartAt', startAt?.slice(0, 16)], ['localEndAt', endAt?.slice(0, 16)],
    ].filter(([, item]) => Boolean(item)));
    const cancelled = string(reservation.reservationStatus).endsWith('ReservationCancelled');
    const key = [type, reference?.toLowerCase(), startAt, route.toLowerCase(), title.toLowerCase()].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ type, title, provider, reference, startAt, endAt, address: location, price, currency, cancelled, details, source: 'kitinerary' });
  }

  return candidates;
}

/** Run KDE's local extractor. An empty result lets the caller try AI extraction. */
export async function extractKitinerary(input: Buffer, filename: string, contextDate?: string): Promise<KitineraryCandidate[]> {
  const extractor = process.env.KITINERARY_BIN || '/usr/local/bin/kitinerary-extractor';
  if (!existsSync(extractor) || !input.length || input.length > 15 * 1024 * 1024) return [];
  const extension = filename.split('.').pop()?.toLowerCase() || 'txt';
  const suffix = supportedExtensions.has(extension) ? extension : 'txt';
  let dir: string | undefined;
  try {
    dir = await mkdtemp(path.join(tmpdir(), 'travelapp-kitinerary-'));
    const file = path.join(dir, `input.${suffix}`);
    await writeFile(file, input, { mode: 0o600 });
    const referenceDate = contextDate && !Number.isNaN(Date.parse(contextDate)) ? contextDate : new Date().toISOString();
    const { stdout } = await execFileAsync(extractor, ['--context-date', referenceDate, file], {
      timeout: 20_000,
      maxBuffer: 2 * 1024 * 1024,
      encoding: 'utf8',
    });
    const candidates = normalizeKitineraryOutput(JSON.parse(stdout));
    if (candidates.length) console.log(`[kitinerary] extracted ${candidates.length} reservation(s) from ${suffix}`);
    return candidates;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code || 'extractor-error';
    console.warn(`[kitinerary] extraction failed (${code}); using AI extraction`);
    return [];
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
