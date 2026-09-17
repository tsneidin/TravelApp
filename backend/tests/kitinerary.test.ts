import { describe, expect, it, vi } from 'vitest';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { completeKitineraryCandidates, extractKitinerary, normalizeKitineraryOutput } from '../src/services/kitinerary.js';
import { parseConfirmation } from '../src/services/emailParser.js';

describe('KItinerary reservation mapping', () => {
  it('maps a hotel stay with local times and a numeric euro total', () => {
    const result = normalizeKitineraryOutput([{
      '@type': 'LodgingReservation',
      checkinTime: { '@value': '2026-10-03T15:00:00+02:00', timezone: 'Europe/Rome' },
      checkoutTime: { '@value': '2026-10-05T11:00:00+02:00' },
      reservationFor: { name: 'Test Hotel', address: { streetAddress: '1 Example St', addressLocality: 'Bari', addressCountry: 'IT' } },
      reservationNumber: 'EURO123',
      totalPrice: 39.98,
      priceCurrency: 'EUR',
    }]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: 'hotel', title: 'Test Hotel', reference: 'EURO123',
      startAt: '2026-10-03T15:00:00+02:00', endAt: '2026-10-05T11:00:00+02:00',
      price: 39.98, currency: 'EUR', address: '1 Example St, Bari, IT',
      details: { localStartAt: '2026-10-03T15:00', localEndAt: '2026-10-05T11:00' },
    });
  });

  it('fills hotel dates omitted by KItinerary from the email text', () => {
    const candidates = normalizeKitineraryOutput([{ '@type': 'LodgingReservation', reservationFor: { name: 'Alaska Lodge' } }]);
    const fallback = parseConfirmation('Alaska hotel booking', 'Check-in: December 13, 2026 at 3 PM. Check-out: December 15, 2026 at 11 AM.');
    const [result] = completeKitineraryCandidates(candidates, fallback);
    expect(result.startAt).toBe('2026-12-13T15:00:00.000Z');
    expect(result.endAt).toBe('2026-12-15T11:00:00.000Z');
    expect(result.details).toMatchObject({ localStartAt: '2026-12-13T15:00', localEndAt: '2026-12-15T11:00' });
  });

  it('keeps transport route, deduplicates passengers, and flags cancellations', () => {
    const ticket = {
      '@type': 'BusReservation',
      reservationNumber: 'JJIWYJ',
      reservationStatus: 'http://schema.org/ReservationCancelled',
      reservationFor: {
        departureBusStop: { name: 'Napoli Metropark' },
        arrivalBusStop: { name: 'Bari FS Park' },
        departureTime: '2026-10-01T12:45:00+02:00',
        arrivalTime: '2026-10-01T16:05:00+02:00',
      },
    };
    const result = normalizeKitineraryOutput([ticket, { ...ticket, underName: { name: 'Second Passenger' } }]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      type: 'activity', reference: 'JJIWYJ', cancelled: true,
      details: { origin: 'Napoli Metropark', destination: 'Bari FS Park' },
    });
    expect(result[0].title).toContain('Napoli Metropark → Bari FS Park');
  });

  it('maps rental pickup and dropoff fields', () => {
    const [rental] = normalizeKitineraryOutput([{
      '@type': 'RentalCarReservation', reservationNumber: 'CAR123',
      reservationFor: { name: 'Economy car', rentalCompany: { name: 'Hertz' } },
      pickupTime: '2026-10-04T10:00:00-08:00',
      dropoffTime: '2026-10-06T10:00:00-08:00',
      pickupLocation: { address: { addressLocality: 'Anchorage', addressRegion: 'AK' } },
    }]);
    expect(rental).toMatchObject({
      type: 'car', provider: 'Hertz', startAt: '2026-10-04T10:00:00-08:00',
      endAt: '2026-10-06T10:00:00-08:00', address: 'Anchorage, AK',
    });
  });

  it('runs the extractor on an isolated input file and reads its JSON output', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'kitinerary-test-'));
    const binary = path.join(dir, 'fake-extractor');
    const fixture = [{
      '@type': 'LodgingReservation', reservationNumber: 'MOCK123',
      reservationFor: { name: 'Mock Hotel' }, checkinTime: '2026-12-13T15:00:00-09:00',
    }];
    try {
      await writeFile(binary, `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(JSON.stringify(fixture))});\n`);
      await chmod(binary, 0o700);
      vi.stubEnv('KITINERARY_BIN', binary);
      const result = await extractKitinerary(Buffer.from('hotel reservation'), 'booking.eml');
      expect(result).toMatchObject([{ title: 'Mock Hotel', reference: 'MOCK123' }]);
    } finally {
      vi.unstubAllEnvs();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
