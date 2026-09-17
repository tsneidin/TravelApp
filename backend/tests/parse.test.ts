import { describe, expect, it } from 'vitest';
import { detectType, parseConfirmation } from '../src/services/emailParser.js';

describe('detectType', () => {
  it('detects flight confirmations', () => {
    expect(detectType('Your flight confirmation', 'Flight Delta 787 departs tomorrow at 0800, eticket attached')).toBe('flight');
  });
  it('detects hotel confirmations', () => {
    expect(detectType('Reservation confirmed', 'Your hotel booking at the Marriott is confirmed, check-in 3pm, room 402')).toBe('hotel');
  });
  it('detects car rentals', () => {
    expect(detectType('Car rental agreement', 'Your rental car with Enterprise is confirmed, pickup 10am')).toBe('car');
  });
  it('detects activities/tours', () => {
    expect(detectType('Tour ticket', 'Your tour ticket is confirmed, attraction admission for 2 adults')).toBe('activity');
  });
  it('returns null for unrelated mail', () => {
    expect(detectType('Your invoice', 'Thank you for your recent purchase of office supplies')).toBeNull();
  });
});

describe('parseConfirmation', () => {
  it('extracts flight details', () => {
    const body =
      'Flight DL 489 from JFK departs 2026-10-01 at 08:00 AM. Arrival at NRT 12:30 PM. Confirmation number: D7K9L2.';
    const r = parseConfirmation('Your flight confirmation Delta', body);
    expect(r).not.toBeNull();
    expect(r!.type).toBe('flight');
    expect(r!.provider).toContain('Delta');
    expect(r!.reference).toBeTruthy();
    expect(r!.startAt).toBeInstanceOf(Date);
  });

  it('extracts hotel booking details', () => {
    const body =
      'Hilton Tokyo Bay check-in 2026-10-02, room 1204. Reservation confirmation number: HIL892. Address: 1-9-1 Maihama, Urayasu.';
    const r = parseConfirmation('Reservation confirmed: Hilton Tokyo Bay', body);
    expect(r).not.toBeNull();
    expect(r!.type).toBe('hotel');
    expect(r!.provider).toBeTruthy();
    expect(r!.reference).toBeTruthy();
  });

  it('keeps distinct Alaska hotel check-in and check-out wall times', () => {
    const body = 'Hotel stay confirmed. Check-in: Sunday, December 13, 2026 after 3:00 PM. Check-out: Tuesday, December 15, 2026 before 11:00 AM. Room for two guests.';
    const result = parseConfirmation('Alaska hotel booking confirmation', body);
    expect(result?.type).toBe('hotel');
    expect(result?.startAt?.toISOString()).toBe('2026-12-13T15:00:00.000Z');
    expect(result?.endAt?.toISOString()).toBe('2026-12-15T11:00:00.000Z');
    expect(result?.details).toMatchObject({ localStartAt: '2026-12-13T15:00', localEndAt: '2026-12-15T11:00' });
  });

  it('parses the captured Anchorage test-email format and its body confirmation number', () => {
    const body = `TEST DATA ONLY. NO RESERVATION EXISTS. This fictional confirmation is solely for testing TravelApp email importing. Do not use it for travel, payment, or check-in.
HOTEL BOOKING CONFIRMATION (TEST)
Confirmation number: TEST-AK-0917-02
Property: Aurora Harbor Hotel (fictional)
Address: 100 Example Avenue, Anchorage, AK 99501
Check-in: December 13, 2026 at 3:00 PM Alaska time
Check-out: December 15, 2026 at 11:00 AM Alaska time`;
    const result = parseConfirmation('[TEST DATA - NOT A RESERVATION] Anchorage hotel confirmation - Dec 13-15, 2026 - TEST-AK-0917-02', body);
    expect(result).toMatchObject({ type: 'hotel', title: 'Aurora Harbor Hotel', provider: 'Aurora Harbor Hotel', reference: 'TEST-AK-0917-02', address: '100 Example Avenue, Anchorage, AK 99501' });
    expect(result?.details).toMatchObject({ localStartAt: '2026-12-13T15:00', localEndAt: '2026-12-15T11:00' });
  });

  it('does not mistake Anchorage in a subject for the hotel confirmation number', () => {
    const body = `HOTEL BOOKING CONFIRMATION (TEST)
Hotel: Northern Lights Test Hotel (fictional property)
Location: Anchorage, Alaska, USA
Confirmation number: TESTAK2026 (invalid test reference)
Check-in: December 13, 2026 at 3:00 PM Alaska time
Check-out: December 15, 2026 at 11:00 AM Alaska time`;
    const result = parseConfirmation('Hotel booking confirmation - Anchorage, Alaska - Dec 13-15, 2026', body);
    expect(result?.reference).toBe('TESTAK2026');
    expect(result?.title).toBe('Northern Lights Test Hotel');
    expect(result?.details).toMatchObject({ localStartAt: '2026-12-13T15:00', localEndAt: '2026-12-15T11:00' });
  });

  it('keeps the checkout date when hotel times are omitted', () => {
    const result = parseConfirmation('Hotel booking confirmation', 'Check-in: 13/12/2026. Check-out: 15/12/2026.');
    expect(result?.details).toMatchObject({ localStartAt: '2026-12-13', localEndAt: '2026-12-15' });
  });

  it('extracts car rental details', () => {
    const body =
      'Your car rental with Enterprise pickup 2026-10-03 at Narita. Confirmation #: 55421-ENT.';
    const r = parseConfirmation('Car rental agreement', body);
    expect(r).not.toBeNull();
    expect(r!.type).toBe('car');
    expect(r!.provider).toBe('Enterprise');
  });

  it('parses mon-day-year format', () => {
    const r = parseConfirmation('Tour', 'Your tour is on Oct 15, 2026 at 10:00. Ticket 2 adults.');
    expect(r).not.toBeNull();
    expect(r!.type).toBe('activity');
    expect(r!.startAt!.getFullYear()).toBe(2026);
    expect(r!.startAt!.getMonth()).toBe(9); // October is month index 9
  });
});
