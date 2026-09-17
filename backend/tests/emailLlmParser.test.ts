import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/settings.service.js', () => ({ getAiConfig: vi.fn() }));
import { getAiConfig } from '../src/services/settings.service.js';
import { extractEmailWithLlm } from '../src/services/emailLlmParser.js';

describe('email AI fallback', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    vi.mocked(getAiConfig).mockResolvedValue({ enabled: true, provider: 'custom', baseUrl: 'http://localhost:8080', model: 'test', timeoutMs: 5000 });
  });

  it('accepts a validated Schema.org hotel with local check-in and check-out', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ '@context': 'https://schema.org', '@graph': [{ '@type': 'LodgingReservation', reservationFor: { name: 'Alaska Lodge' }, reservationNumber: 'TEST-AK-0917-02', checkinTime: '2026-12-13T15:00', checkoutTime: '2026-12-15T11:00', totalPrice: 399.98, priceCurrency: 'USD' }] }) } }] }) } as Response);
    const result = await extractEmailWithLlm('Hotel confirmation', 'Check-in Dec 13 3pm, check-out Dec 15 11am.');
    expect(result.error).toBeUndefined();
    expect(result.candidates[0]).toMatchObject({ source: 'llm', type: 'hotel', reference: 'TEST-AK-0917-02', startAt: '2026-12-13T15:00', endAt: '2026-12-15T11:00', price: 399.98 });
    expect(fetch).toHaveBeenCalledWith('http://localhost:8080/v1/chat/completions', expect.objectContaining({ method: 'POST' }));
  });

  it('leaves the email for review when AI is disabled', async () => {
    vi.mocked(getAiConfig).mockResolvedValue({ enabled: false, provider: 'custom', baseUrl: '', model: '', timeoutMs: 5000 });
    const result = await extractEmailWithLlm('Hotel', 'Booking');
    expect(result.candidates).toEqual([]);
    expect(result.error).toMatch(/disabled/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects unstructured model output', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: '{"hotel":"guess"}' } }] }) } as Response);
    const result = await extractEmailWithLlm('Hotel', 'Booking');
    expect(result.candidates).toEqual([]);
    expect(result.error).toMatch(/invalid Schema.org/);
  });

  it('keeps a booking at the end of a long inline forward', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: '{"@context":"https://schema.org","@graph":[]}' } }] }) } as Response);
    await extractEmailWithLlm('Fwd: confirmation', `${'older messages '.repeat(3_000)}\nOriginal hotel confirmation TEST-AK-0917-02`);
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string) as { messages: Array<{ content: string }> };
    expect(body.messages[1].content).toContain('Original hotel confirmation TEST-AK-0917-02');
    expect(body.messages[1].content.length).toBeLessThan(30_100);
  });

  it('handles the quoted Booking.com forward and a common model response format', async () => {
    const forwarded = [
      'Sent from my iPhone',
      'Begin forwarded message:',
      '> From: noreply@booking.com',
      '> Subject: Thanks! Your booking is confirmed at Barirooms - Picca 24',
      '> Confirmation: 5126038442',
      '> Your apartment in Bari is confirmed.',
      '> Reservation details',
      '> Check-in Thursday, October 1, 2026 (3:00 PM - 9:00 PM)',
      '> Check-out Saturday, October 3, 2026 (10:00 AM - 10:30 AM)',
      '> Location 24 Piazza Luigi di Savoia Duca Degli Abruzzi, 70121 Bari, Italy',
      '> Cancellation cost until October 1: € 288.91',
      '> Price details',
      '> 1 Deluxe Apartment € 255.37',
      '> VAT € 25.54',
      '> Booking.com will pay - € 23.05',
      '> Total Price € 265.86',
      '> Total paid € 265.86',
      '> The property invoice will show € 288.91.',
      '> <mime-attachment.gif>',
    ].join('\n');
    const modelJson = JSON.stringify({
      '@type': 'LodgingReservation', reservationFor: 'Barirooms - Picca 24',
      reservationNumber: '5126038442', checkinTime: '2026-10-01T15:00', checkoutTime: '2026-10-03T10:00',
      totalPrice: '€ 265,86', priceCurrency: '€',
    });
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: `Here is the reservation:\n\x60\x60\x60json\n${modelJson}\n\x60\x60\x60` } }] }) } as Response);
    const result = await extractEmailWithLlm('Fwd: Barirooms confirmation', forwarded);
    expect(result.error).toBeUndefined();
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ type: 'hotel', title: 'Barirooms - Picca 24', reference: '5126038442', startAt: '2026-10-01T15:00', endAt: '2026-10-03T10:00', price: 265.86, currency: 'EUR' });
    const request = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string) as { messages: Array<{ content: string }> };
    expect(request.messages[1].content).toContain('Total Price € 265.86');
    expect(request.messages[1].content).not.toContain('> Check-in');
    expect(request.messages[1].content).not.toContain('<mime-attachment.gif>');
  });

  it('uses a single explicitly labeled total instead of a cancellation amount selected by the model', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ '@context': 'https://schema.org', '@graph': [{ '@type': 'LodgingReservation', reservationFor: { name: 'Barirooms' }, checkinTime: '2026-10-01T15:00', checkoutTime: '2026-10-03T10:00', totalPrice: 288.91, priceCurrency: 'EUR' }] }) } }] }) } as Response);
    const result = await extractEmailWithLlm('Fwd: hotel', 'Cancellation cost € 288.91\nTotal Price\n€ 265.86\nProperty invoice € 288.91');
    expect(result.candidates[0]).toMatchObject({ price: 265.86, currency: 'EUR' });
  });
});
