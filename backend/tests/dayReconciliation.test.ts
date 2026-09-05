import { describe, expect, it } from 'vitest';
import {
  cleanAirportCity,
  isGenericDayLabel,
  toDayKey,
  tripDates,
} from '../src/services/dayReconciliation.js';

describe('dayReconciliation', () => {
  describe('cleanAirportCity', () => {
    it('strips "Operated by Envoy Air" on a separate line', () => {
      expect(cleanAirportCity('Operated by Envoy Air\nChicago')).toBe('Chicago');
    });

    it('strips "Operated by Envoy Air" on the same line', () => {
      expect(cleanAirportCity('Operated by Envoy Air Chicago')).toBe('Chicago');
    });

    it('strips stray OCR single letter prefixes like "E Chicago"', () => {
      expect(cleanAirportCity('E Chicago')).toBe('Chicago');
    });

    it('strips words like Arrive, Depart, From, To', () => {
      expect(cleanAirportCity('Arrive Chicago')).toBe('Chicago');
      expect(cleanAirportCity('Depart Naples')).toBe('Naples');
      expect(cleanAirportCity('To Madison')).toBe('Madison');
    });

    it('preserves normal city names', () => {
      expect(cleanAirportCity('Naples')).toBe('Naples');
      expect(cleanAirportCity('Chicago')).toBe('Chicago');
      expect(cleanAirportCity('Madison')).toBe('Madison');
      expect(cleanAirportCity('New York')).toBe('New York');
    });
  });

  describe('isGenericDayLabel', () => {
    it('identifies default placeholder day labels', () => {
      expect(isGenericDayLabel('Day 1')).toBe(true);
      expect(isGenericDayLabel('Day 2')).toBe(true);
      expect(isGenericDayLabel('Day 24')).toBe(true);
      expect(isGenericDayLabel('day 99')).toBe(true);
      expect(isGenericDayLabel('Day2')).toBe(true);
      expect(isGenericDayLabel('')).toBe(true);
      expect(isGenericDayLabel(null)).toBe(true);
      expect(isGenericDayLabel(undefined)).toBe(true);
    });

    it('preserves custom user titles', () => {
      expect(isGenericDayLabel('Naples to Chicago')).toBe(false);
      expect(isGenericDayLabel('Tokyo Arrival')).toBe(false);
      expect(isGenericDayLabel('Day 1: Arrival')).toBe(false);
      expect(isGenericDayLabel('Amalfi Coast Drive')).toBe(false);
    });
  });

  describe('tripDates', () => {
    it('generates a complete continuous date sequence without missing days', () => {
      const dates = tripDates(new Date('2026-10-20'), new Date('2026-10-22'));
      expect(dates.length).toBe(3);
      expect(toDayKey(dates[0])).toBe('2026-10-20');
      expect(toDayKey(dates[1])).toBe('2026-10-21');
      expect(toDayKey(dates[2])).toBe('2026-10-22');
    });

    it('handles single day trip', () => {
      const dates = tripDates(new Date('2026-10-20'), new Date('2026-10-20'));
      expect(dates.length).toBe(1);
      expect(toDayKey(dates[0])).toBe('2026-10-20');
    });
  });
});
