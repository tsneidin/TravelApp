import { describe, expect, it } from 'vitest';
import { extractLodgingReceipt } from '../src/services/emailReceipt.js';

describe('labeled lodging receipt fallback', () => {
  it('extracts the forwarded Booking.com receipt even with table separators', () => {
    const receipt = [
      '> From: Booking.com <noreply-payments@booking.com>',
      '> This is your receipt',
      '> | Booking number |', '> | -------------- |', '> | 9000001234 |',
      '> | Property name |', '> | ------------- |', '> | Example Harbor Hotel |',
      '> | Check-in |', '> | -------- |', '> | Wednesday, February 10, 2027 |',
      '> | Check-out |', '> | --------- |', '> | Friday, February 12, 2027 |',
      '> Amount paid on Jan 5, 2027', '> € 123.45',
    ].join('\n');
    expect(extractLodgingReceipt(receipt)).toMatchObject({
      source: 'email-evidence', type: 'hotel', title: 'Example Harbor Hotel',
      reference: '9000001234', startAt: '2027-02-10', endAt: '2027-02-12',
      price: 123.45, currency: 'EUR',
    });
  });

  it('does not treat an ordinary payment notice as a hotel reservation', () => {
    expect(extractLodgingReceipt('Booking.com\nAmount paid € 123.45')).toBeUndefined();
  });
});
