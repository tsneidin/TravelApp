import { describe, expect, it } from 'vitest';
import { classifyCategory, searchPlaces } from '../src/services/geocoding.js';

describe('classifyCategory', () => {
  it('maps restaurant/food OSM tags', () => {
    expect(classifyCategory('amenity', 'restaurant')).toBe('Restaurant');
    expect(classifyCategory('amenity', 'cafe')).toBe('Restaurant');
    expect(classifyCategory('amenity', 'bar')).toBe('Restaurant');
    expect(classifyCategory('amenity', 'ice_cream')).toBe('Restaurant');
  });

  it('maps accommodation OSM tags', () => {
    expect(classifyCategory('tourism', 'hotel')).toBe('Accommodation');
    expect(classifyCategory('tourism', 'hostel')).toBe('Accommodation');
    expect(classifyCategory('tourism', 'guest_house')).toBe('Accommodation');
  });

  it('maps transport OSM tags', () => {
    expect(classifyCategory('aeroway', 'aerodrome')).toBe('Transport');
    expect(classifyCategory('railway', 'station')).toBe('Transport');
    expect(classifyCategory('amenity', 'bus_station')).toBe('Transport');
  });

  it('maps shopping OSM tags', () => {
    expect(classifyCategory('shop', 'mall')).toBe('Shopping');
    expect(classifyCategory('shop', 'supermarket')).toBe('Shopping');
  });

  it('maps activity OSM tags', () => {
    expect(classifyCategory('tourism', 'theme_park')).toBe('Activity');
    expect(classifyCategory('leisure', 'water_park')).toBe('Activity');
    expect(classifyCategory('amenity', 'cinema')).toBe('Activity');
  });

  it('maps sights and museums to Sightseeing', () => {
    expect(classifyCategory('tourism', 'museum')).toBe('Sightseeing');
    expect(classifyCategory('tourism', 'attraction')).toBe('Sightseeing');
    expect(classifyCategory('tourism', 'viewpoint')).toBe('Sightseeing');
    expect(classifyCategory('historic', 'monument')).toBe('Sightseeing');
  });

  it('defaults unknown tags to Sightseeing', () => {
    expect(classifyCategory('unknown', 'unknown')).toBe('Sightseeing');
    expect(classifyCategory(undefined, undefined)).toBe('Sightseeing');
  });
});

describe('searchPlaces', () => {
  it('returns empty array for blank query', async () => {
    const res = await searchPlaces('   ');
    expect(res).toEqual([]);
  });

  it('parses coordinate queries directly', async () => {
    const res = await searchPlaces('40.7128, -74.0060');
    expect(res).toHaveLength(1);
    expect(res[0].lat).toBe(40.7128);
    expect(res[0].lng).toBe(-74.006);
    expect(res[0].address).toBe('40.7128, -74.006');
  });
});
