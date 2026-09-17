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
});
