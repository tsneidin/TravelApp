import { describe, expect, it } from 'vitest';
import { sanitizeReceiptText, extractFlightLegs } from '../src/services/bookingHelper.js';

describe('sanitizeReceiptText', () => {
  it('cleans up doubled characters from PDF copy-paste', () => {
    const raw = 'RReecceeiipptt\nAAAA CCOONNFFIIRRMMAATTIIOONN CCOODDEE:: NNVVDDWWQQZZ';
    const cleaned = sanitizeReceiptText(raw);
    expect(cleaned).toContain('Receipt');
    expect(cleaned).toContain('AA CONFIRMATION CODE: NVDWQZ');
  });

  it('preserves normal single-character words and punctuation', () => {
    const normal = 'American Airlines flight from Chicago to Naples';
    expect(sanitizeReceiptText(normal)).toBe(normal);
  });
});

describe('extractFlightLegs', () => {
  const sampleReceipt = `
RReecceeiipptt
AAAA CCOONNFFIIRRMMAATTIIOONN CCOODDEE:: NNVVDDWWQQZZ Get your boarding pass faster!
Scan this barcode at any
American Airlines Self-Service
Machine.
Madison to Naples
22 AAdduullttss
Monday September 28, 2026 – Thursday October 22, 2026
Total Paid:
AAAA CCoonnfifirrmmaattiioonn CCooddee
NVDWQZ
Your confirmation code is your reservation confirmation number
and will be needed to retrieve or reference your reservation.
RReesseerrvvaattiioonn NNaammee
MSN/NAP
Status: Ticketed Sep 01, 2026
$2,054.66 USD
Flight Depart Arrive
American Airlines
6256
Operated by Envoy Air
Madison (MSN)
September 28, 2026 12:56 PM
Travel Time : 1 h 24 m
Class : Basic Economy
Seat : -- , --
Chicago (ORD)
September 28, 2026 02:20 PM
Booking Code : B
American Airlines
180 Chicago (ORD)
September 28, 2026 05:35 PM
Travel Time : 9 h 25 m
Class : Basic Economy
Seat : 27H , 27J
Naples (NAP)
September 29, 2026 10:00 AM
Booking Code : B
Flight Depart Arrive
American Airlines
181 Naples (NAP)
October 22, 2026 03:00 PM
Travel Time : 10 h 50 m
Class : Basic Economy
Seat : 28D , 28E
Chicago (ORD)
October 22, 2026 06:50 PM
Booking Code : B
American Airlines
4601
Operated by Envoy Air
Chicago (ORD)
October 22, 2026 10:00 PM
Travel Time : 1 h 12 m
Class : Basic Economy
Seat : -- , --
Madison (MSN)
October 22, 2026 11:12 PM
Booking Code : B
Basic Economy
(Non-refundable)
Flight Subtotal
$2,054.66 USD
`;

  it('extracts confirmation reference, provider, and total price', () => {
    const info = extractFlightLegs(sampleReceipt);
    expect(info.reference).toBe('NVDWQZ');
    expect(info.provider).toBe('American Airlines');
    expect(info.totalAmount).toBe(2054.66);
    expect(info.currency).toBe('USD');
  });

  it('extracts a confirmed total from compact confirmation text', () => {
    const info = extractFlightLegs('United Airlines\nConfirmation ABC123\nTotal paid: $1,234.56 USD');
    expect(info.totalAmount).toBe(1234.56);
    expect(info.currency).toBe('USD');
  });

  it('extracts all 4 flight legs with correct airports and dates', () => {
    const info = extractFlightLegs(sampleReceipt);
    expect(info.legs.length).toBe(4);

    // Leg 1: MSN -> ORD (Sep 28)
    expect(info.legs[0].flightNumber).toBe('6256');
    expect(info.legs[0].fromCode).toBe('MSN');
    expect(info.legs[0].toCode).toBe('ORD');

    // Leg 2: ORD -> NAP (Sep 28 -> Sep 29)
    expect(info.legs[1].flightNumber).toBe('180');
    expect(info.legs[1].fromCode).toBe('ORD');
    expect(info.legs[1].toCode).toBe('NAP');
    expect(info.legs[1].seat).toContain('27H');

    // Leg 3: NAP -> ORD (Oct 22)
    expect(info.legs[2].flightNumber).toBe('181');
    expect(info.legs[2].fromCode).toBe('NAP');
    expect(info.legs[2].toCode).toBe('ORD');
    expect(info.legs[2].fromCity).toBe('Naples');
    expect(info.legs[2].toCity).toBe('Chicago');
    expect(info.legs[2].seat).toContain('28D');

    // Leg 4: ORD -> MSN (Oct 22)
    expect(info.legs[3].flightNumber).toBe('4601');
    expect(info.legs[3].fromCode).toBe('ORD');
    expect(info.legs[3].toCode).toBe('MSN');
    expect(info.legs[3].fromCity).toBe('Chicago');
    expect(info.legs[3].toCity).toBe('Madison');
  });

  it('correctly records overnight flight dates where depart and arrive are on different days', () => {
    const info = extractFlightLegs(sampleReceipt);
    const ordToNap = info.legs[1];
    expect(ordToNap.departTime).toBeDefined();
    expect(ordToNap.arriveTime).toBeDefined();
    const departDay = ordToNap.departTime?.toISOString().slice(0, 10);
    const arriveDay = ordToNap.arriveTime?.toISOString().slice(0, 10);
    expect(departDay).toBe('2026-09-28');
    expect(arriveDay).toBe('2026-09-29');
  });
});

describe('cleanAirportCity', () => {
  it('strips OCR stray artifacts and carrier prefixes', async () => {
    const { cleanAirportCity } = await import('../src/services/dayReconciliation.js');
    expect(cleanAirportCity('E Chicago')).toBe('Chicago');
    expect(cleanAirportCity('Operated by Envoy Air Chicago')).toBe('Chicago');
    expect(cleanAirportCity('American Airlines Madison')).toBe('Madison');
    expect(cleanAirportCity('Arrive Naples Airport')).toBe('Naples');
    expect(cleanAirportCity('New York')).toBe('New York');
    expect(cleanAirportCity('San Francisco')).toBe('San Francisco');
  });
});

