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