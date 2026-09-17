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

  it('reports a blank captured message body without sending its subject to AI', async () => {
    const result = await extractEmailWithLlm('Fwd: This is your receipt', '');
    expect(result.error).toMatch(/No readable email body/);
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
      '> Subject: Thanks! Your booking is confirmed at Example Harbor Hotel',
      '> Confirmation: 9000001234',
      '> Your apartment in Sample City is confirmed.',
      '> Reservation details',
      '> Check-in Wednesday, February 10, 2027 (3:00 PM - 9:00 PM)',
      '> Check-out Friday, February 12, 2027 (10:00 AM - 10:30 AM)',
      '> Location 1 Example Lane, Sample City, Italy',
      '> Cancellation cost until February 10: € 145.67',
      '> Price details',
      '> 1 Deluxe Apartment € 111.11',
      '> VAT € 11.11',
      '> Booking.com will pay - € 12.34',
      '> Total Price € 123.45',
      '> Total paid € 123.45',
      '> The property invoice will show € 145.67.',
      '> <mime-attachment.gif>',
    ].join('\n');
    const modelJson = JSON.stringify({
      '@type': 'LodgingReservation', reservationFor: 'Example Harbor Hotel',
      reservationNumber: '9000001234', checkinTime: '2027-02-10T15:00', checkoutTime: '2027-02-12T10:00',
      totalPrice: '€ 123,45', priceCurrency: '€',
    });
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: `Here is the reservation:\n\x60\x60\x60json\n${modelJson}\n\x60\x60\x60` } }] }) } as Response);
    const result = await extractEmailWithLlm('Fwd: Example Harbor Hotel confirmation', forwarded);
    expect(result.error).toBeUndefined();
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ type: 'hotel', title: 'Example Harbor Hotel', reference: '9000001234', startAt: '2027-02-10T15:00', endAt: '2027-02-12T10:00', price: 123.45, currency: 'EUR' });
    const request = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string) as { messages: Array<{ content: string }> };
    expect(request.messages[1].content).toContain('Total Price € 123.45');
    expect(request.messages[1].content).not.toContain('> Check-in');
    expect(request.messages[1].content).not.toContain('<mime-attachment.gif>');
  });

  it('uses a single explicitly labeled total instead of a cancellation amount selected by the model', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ '@context': 'https://schema.org', '@graph': [{ '@type': 'LodgingReservation', reservationFor: { name: 'Example Harbor Hotel' }, checkinTime: '2027-02-10T15:00', checkoutTime: '2027-02-12T10:00', totalPrice: 145.67, priceCurrency: 'EUR' }] }) } }] }) } as Response);
    const result = await extractEmailWithLlm('Fwd: hotel', 'Cancellation cost € 145.67\nTotal Price\n€ 123.45\nProperty invoice € 145.67');
    expect(result.candidates[0]).toMatchObject({ price: 123.45, currency: 'EUR' });
  });

  it('completes missing hotel dates from explicit email lines without another model call', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ '@context': 'https://schema.org', '@graph': [{ '@type': 'LodgingReservation', reservationFor: { name: 'Example Harbor Hotel' }, reservationNumber: '9000001234' }] }) } }] }) } as Response);
    const result = await extractEmailWithLlm('Fwd: Example Harbor Hotel', 'Check-in Wednesday, February 10, 2027 (3:00 PM - 9:00 PM)\nCheck-out Friday, February 12, 2027 (10:00 AM - 10:30 AM)');
    expect(result.candidates[0]).toMatchObject({ startAt: '2027-02-10T15:00', endAt: '2027-02-12T10:00' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retries an incomplete hotel extraction with focused date instructions', async () => {
    const first = { '@context': 'https://schema.org', '@graph': [{ '@type': 'LodgingReservation', reservationFor: { name: 'Example hotel' }, reservationNumber: 'ABC123' }] };
    const second = { '@context': 'https://schema.org', '@graph': [{ '@type': 'LodgingReservation', reservationFor: { name: 'Example hotel' }, checkinTime: '2027-02-10T15:00', checkoutTime: '2027-02-12T10:00' }] };
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(first) } }] }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(second) } }] }) } as Response);
    const result = await extractEmailWithLlm('Fwd: hotel', 'Hotel dates are February 10 through February 12, 2027. Arrive at 3 PM, leave at 10 AM.');
    expect(result.candidates[0]).toMatchObject({ reference: 'ABC123', startAt: '2027-02-10T15:00', endAt: '2027-02-12T10:00' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('uses labeled receipt evidence for review when AI returns no reservation', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: '{"@context":"https://schema.org","@graph":[]}' } }] }) } as Response);
    const result = await extractEmailWithLlm('Fwd: This is your receipt', 'Booking.com\nBooking number 9000001234\nProperty name Example Harbor Hotel\nCheck-in Wednesday, February 10, 2027\nCheck-out Friday, February 12, 2027\nAmount paid on Jan 5, 2027\n€ 123.45');
    expect(result.error).toBeUndefined();
    expect(result.candidates[0]).toMatchObject({ source: 'email-evidence', type: 'hotel', reference: '9000001234', startAt: '2027-02-10', endAt: '2027-02-12', price: 123.45 });
  });

  it('retains a clearly labeled lodging receipt when the AI endpoint is unavailable', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 503 } as Response);
    const result = await extractEmailWithLlm('Fwd: This is your receipt', 'Booking.com\nBooking number 9000001234\nProperty name Example Harbor Hotel\nCheck-in Wednesday, February 10, 2027\nCheck-out Friday, February 12, 2027\nAmount paid € 123.45');
    expect(result.candidates[0]).toMatchObject({ source: 'email-evidence', reference: '9000001234' });
  });

  it('uses the receipt amount paid when AI selects a different number', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ '@context': 'https://schema.org', '@graph': [{ '@type': 'LodgingReservation', reservationFor: { name: 'Example Harbor Hotel' }, checkinTime: '2027-02-10', checkoutTime: '2027-02-12', totalPrice: 145.67, priceCurrency: 'EUR' }] }) } }] }) } as Response);
    const result = await extractEmailWithLlm('Fwd: This is your receipt', 'Booking.com\nAmount paid on Jan 5, 2027\n\n€ 123.45\nThis is not an invoice.');
    expect(result.candidates[0]).toMatchObject({ price: 123.45, currency: 'EUR' });
  });
});
