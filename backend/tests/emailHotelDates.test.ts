import { describe, expect, it } from 'vitest';
import { completeHotelDatesFromEmail } from '../src/services/emailHotelDates.js';

describe('explicit hotel date evidence', () => {
  const hotel = [{ source: 'llm' as const, type: 'hotel' as const, title: 'Example Harbor Hotel', details: {} }];

  it('fills local check-in and check-out from the forwarded Booking.com windows', () => {
    const body = 'Check-in\tWednesday, February 10, 2027 (3:00 PM - 9:00 PM)\nCheck-out\tFriday, February 12, 2027 (10:00 AM - 10:30 AM)';
    expect(completeHotelDatesFromEmail(hotel, body)[0]).toMatchObject({
      startAt: '2027-02-10T15:00', endAt: '2027-02-12T10:00',
      details: { localStartAt: '2027-02-10T15:00', localEndAt: '2027-02-12T10:00' },
    });
  });

  it('does not borrow a check-out time for a date-only check-in', () => {
    const body = 'Check-in February 10, 2027\nCheck-out February 12, 2027 (10:00 AM - 10:30 AM)';
    expect(completeHotelDatesFromEmail(hotel, body)[0]).toMatchObject({ startAt: '2027-02-10', endAt: '2027-02-12T10:00' });
  });
});
