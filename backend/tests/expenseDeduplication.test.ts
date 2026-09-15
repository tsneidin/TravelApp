import { describe, expect, it } from 'vitest';
import { hasMatchingReceiptIdentifier, isLikelyDuplicateExpense, isTransportReceipt } from '../src/services/expenseDeduplication.js';

describe('expense receipt deduplication', () => {
  it('matches the same ITABUS receipt even when AI chose different descriptions', () => {
    expect(isLikelyDuplicateExpense(
      { description: 'ITABUS (TEST12345)', amount: 39.98, currency: 'EUR', date: '2026-10-01' },
      { description: 'ITABUS Comfort tickets', notes: 'Booking number TEST12345', amount: 39.98, currency: 'EUR', date: '2026-09-15' },
    )).toBe(true);
  });

  it('does not merge equal prices from different vendors or dates', () => {
    expect(isLikelyDuplicateExpense(
      { description: 'ITABUS', amount: 39.98, currency: 'EUR', date: '2026-10-01' },
      { description: 'Dinner at Bari Vecchia', amount: 39.98, currency: 'EUR', date: '2026-10-01' },
    )).toBe(false);
    expect(isLikelyDuplicateExpense(
      { description: 'ITABUS', amount: 39.98, currency: 'EUR', date: '2026-10-01' },
      { description: 'ITABUS', amount: 39.98, currency: 'EUR', date: '2026-10-02' },
    )).toBe(false);
  });

  it('recognizes bus receipts as transport bookings', () => {
    expect(isTransportReceipt('ITABUS', 'Napoli to Bari')).toBe(true);
  });

  it('links the same receipt when a corrected amount no longer matches', () => {
    expect(hasMatchingReceiptIdentifier(
      { description: 'ITABUS (TEST12345)', amount: 3998, currency: 'USD' },
      { description: 'ITABUS', notes: 'Booking number TEST12345', amount: 39.98, currency: 'EUR' },
    )).toBe(true);
  });
});
