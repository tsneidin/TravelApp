import { describe, expect, it } from 'vitest';
import { cleanFallbackTitleAndDescription } from '../src/services/ai.js';

describe('cleanFallbackTitleAndDescription', () => {
  it('handles empty input gracefully', () => {
    const res = cleanFallbackTitleAndDescription('');
    expect(res.title).toBe('New Activity');
    expect(res.description).toBe('');
  });

  it('preserves already concise titles', () => {
    const res = cleanFallbackTitleAndDescription('Louvre Museum');
    expect(res.title).toBe('Louvre Museum');
    expect(res.description).toBe('');
  });

  it('splits on delimiter like hyphen or colon', () => {
    const res = cleanFallbackTitleAndDescription(
      'Colosseum Tour - Guided access to the underground hypogeum and arena floor with skip-the-line ticket',
    );
    expect(res.title).toBe('Colosseum Tour');
    expect(res.description).toContain('Guided access');
  });

  it('shortens lengthy verbose strings and preserves full text in description', () => {
    const input =
      'Guided walking tour of the historic Roman Forum and Palatine Hill including ancient ruins and archaeological guides';
    const res = cleanFallbackTitleAndDescription(input);
    expect(res.title.length).toBeLessThanOrEqual(35);
    expect(res.description).toBe(input);
  });
});
