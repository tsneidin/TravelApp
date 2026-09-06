import { describe, expect, it } from 'vitest';

const SPAN_TAG_REGEX = /\[spanId:([a-zA-Z0-9_-]+)\]/g;

function extractSpanId(item?: { notes?: string | null; sourceText?: string | null } | null): string | null {
  if (!item) return null;
  const inNotes = item.notes?.match(/\[spanId:([a-zA-Z0-9_-]+)\]/);
  if (inNotes && inNotes[1]) return inNotes[1];
  const inSource = item.sourceText?.match(/\[spanId:([a-zA-Z0-9_-]+)\]/);
  if (inSource && inSource[1]) return inSource[1];
  return null;
}

function embedSpanId(text: string | null | undefined, spanId: string): string {
  const clean = stripSpanId(text);
  if (!clean) {
    return `[spanId:${spanId}]`;
  }
  return `${clean}\n[spanId:${spanId}]`;
}

function stripSpanId(text?: string | null): string {
  if (!text) return '';
  return text.replace(SPAN_TAG_REGEX, '').trim();
}

describe('Span Tag Utilities', () => {
  it('correctly embeds and extracts spanId', () => {
    const spanId = 'span_12345_abc';
    const notes = 'Great hotel in city center';
    const tagged = embedSpanId(notes, spanId);
    expect(tagged).toContain('[spanId:span_12345_abc]');
    expect(extractSpanId({ notes: tagged })).toBe('span_12345_abc');
    expect(stripSpanId(tagged)).toBe('Great hotel in city center');
  });

  it('handles empty notes when embedding spanId', () => {
    const spanId = 'span_9999_xyz';
    const tagged = embedSpanId('', spanId);
    expect(tagged).toBe('[spanId:span_9999_xyz]');
    expect(extractSpanId({ notes: tagged })).toBe('span_9999_xyz');
    expect(stripSpanId(tagged)).toBe('');
  });

  it('extracts spanId from sourceText if not in notes', () => {
    const spanId = 'span_555_src';
    const item = {
      notes: null,
      sourceText: `Check-in details\n[spanId:${spanId}]`,
    };
    expect(extractSpanId(item)).toBe(spanId);
  });
});
