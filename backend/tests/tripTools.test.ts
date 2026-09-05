import { describe, expect, it } from 'vitest';
import {
  TRIP_TOOLS,
  cleanFallbackTitleAndDescription,
  parseArgs,
  toDate,
  toDayKey,
  BOOKING_TYPES,
  EXPENSE_CATEGORIES,
} from '../src/services/tripTools.js';

describe('TRIP_TOOLS definitions', () => {
  it('defines all required CRUD and utility tools', () => {
    const names = TRIP_TOOLS.map((t) => t.function.name);

    // Trip
    expect(names).toContain('get_trip_details');
    expect(names).toContain('update_trip');

    // Days
    expect(names).toContain('list_days');
    expect(names).toContain('add_day');
    expect(names).toContain('update_day');
    expect(names).toContain('delete_day');

    // Places
    expect(names).toContain('get_places');
    expect(names).toContain('add_place');
    expect(names).toContain('update_place');
    expect(names).toContain('delete_place');

    // Bookings
    expect(names).toContain('list_bookings');
    expect(names).toContain('add_booking');
    expect(names).toContain('update_booking');
    expect(names).toContain('delete_booking');

    // Expenses
    expect(names).toContain('list_expenses');
    expect(names).toContain('add_expense');
    expect(names).toContain('update_expense');
    expect(names).toContain('delete_expense');

    // Packing
    expect(names).toContain('list_packing_items');
    expect(names).toContain('add_packing_item');
    expect(names).toContain('update_packing_item');
    expect(names).toContain('delete_packing_item');

    // Journal
    expect(names).toContain('list_journal_entries');
    expect(names).toContain('add_journal_entry');
    expect(names).toContain('update_journal_entry');
    expect(names).toContain('delete_journal_entry');

    // Suggestions
    expect(names).toContain('get_suggestions');
  });

  it('all tools have valid names, descriptions, and parameter objects', () => {
    for (const tool of TRIP_TOOLS) {
      expect(tool.type).toBe('function');
      expect(tool.function.name).toMatch(/^[a-z_]+$/);
      expect(tool.function.description.length).toBeGreaterThan(10);
      expect(tool.function.parameters.type).toBe('object');
      expect(tool.function.parameters.properties).toBeDefined();
    }
  });

  it('declares booking types and expense categories properly', () => {
    expect(BOOKING_TYPES).toContain('flight');
    expect(BOOKING_TYPES).toContain('hotel');
    expect(BOOKING_TYPES).toContain('car');
    expect(BOOKING_TYPES).toContain('activity');

    expect(EXPENSE_CATEGORIES).toContain('transport');
    expect(EXPENSE_CATEGORIES).toContain('food');
    expect(EXPENSE_CATEGORIES).toContain('lodging');
    expect(EXPENSE_CATEGORIES).toContain('activity');
  });
});

describe('tripTools helpers', () => {
  it('parses JSON string args safely', () => {
    expect(parseArgs('{"name":"Tokyo Tower","date":"2026-05-12"}')).toEqual({
      name: 'Tokyo Tower',
      date: '2026-05-12',
    });
    expect(parseArgs('invalid json')).toEqual({});
    expect(parseArgs({ direct: 'object' })).toEqual({ direct: 'object' });
  });

  it('converts date strings correctly', () => {
    const d = toDate('2026-05-12');
    expect(d).toBeInstanceOf(Date);
    expect(toDayKey(d!)).toBe('2026-05-12');
    expect(toDate('not-a-date')).toBeUndefined();
    expect(toDate(undefined)).toBeUndefined();
  });

  it('cleans fallback title and description', () => {
    expect(cleanFallbackTitleAndDescription('')).toEqual({ title: 'New Activity', description: '' });
    expect(cleanFallbackTitleAndDescription('Shinjuku Gyoen National Garden')).toEqual({
      title: 'Shinjuku Gyoen National Garden',
      description: '',
    });

    const verbose = 'Visit the famous Meiji Jingu Shrine located in Shibuya with forested grounds';
    const cleaned = cleanFallbackTitleAndDescription(verbose);
    expect(cleaned.title.length).toBeLessThanOrEqual(35);
    expect(cleaned.description).toBe(verbose);
  });
});
