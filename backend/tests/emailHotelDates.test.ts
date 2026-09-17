import { describe, expect, it } from 'vitest';
import { completeHotelDatesFromEmail } from '../src/services/emailHotelDates.js';

describe('explicit hotel date evidence', () => {
  const hotel = [{ source: 'llm' as const, type: 'hotel' as const, title: 'Barirooms - Picca 24', details: {} }];

  it('fills local check-in and check-out from the forwarded Booking.com windows', () => {
    const body = 'Check-in\tThursday, October 1, 2026 (3:00 PM - 9:00 PM)\nCheck-out\tSaturday, October 3, 2026 (10:00 AM - 10:30 AM)';
    expect(completeHotelDatesFromEmail(hotel, body)[0]).toMatchObject({
      startAt: '2026-10-01T15:00', endAt: '2026-10-03T10:00',
      details: { localStartAt: '2026-10-01T15:00', localEndAt: '2026-10-03T10:00' },
    });
  });

  it('does not borrow a check-out time for a date-only check-in', () => {
    const body = 'Check-in October 1, 2026\nCheck-out October 3, 2026 (10:00 AM - 10:30 AM)';
    expect(completeHotelDatesFromEmail(hotel, body)[0]).toMatchObject({ startAt: '2026-10-01', endAt: '2026-10-03T10:00' });
  });
});
