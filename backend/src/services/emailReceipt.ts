import type { KitineraryCandidate } from './kitinerary.js';
import { completeHotelDatesFromEmail } from './emailHotelDates.js';

function cleanLine(line: string): string {
  return line.replace(/^\s*(?:>\s?)+/, '').replace(/^\s*\|\s*/, '').replace(/\s*\|\s*$/, '')
    .replace(/\*\*/g, '').trim();
}

function labeledValue(lines: string[], label: string): string | undefined {
  const pattern = new RegExp(`^${label}\\b\\s*:?\\s*(.*)$`, 'i');
  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].match(pattern);
    if (!match) continue;
    const value = match[1] || lines[index + 1] || '';
    if (value && !/^[-:|\s]+$/.test(value)) return value;
  }
  return undefined;
}

function paidAmount(lines: string[]): number | undefined {
  const index = lines.findIndex((line) => /^amount paid\b/i.test(line));
  if (index < 0) return undefined;
  const nearby = lines.slice(index, index + 6).join(' ');
  const match = nearby.match(/€\s*([\d.,]+)/);
  if (!match) return undefined;
  const raw = match[1];
  const amount = Number(raw.lastIndexOf(',') > raw.lastIndexOf('.')
    ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, ''));
  return Number.isFinite(amount) && amount >= 0 ? amount : undefined;
}

/** Recognize a labeled lodging receipt only after the AI extractor found nothing. */
export function extractLodgingReceipt(body: string): KitineraryCandidate | undefined {
  if (!/booking\.com/i.test(body)) return undefined;
  const lines = body.split(/\r?\n/).map(cleanLine).filter((line) => Boolean(line) && !/^[-:|\s]+$/.test(line));
  const reference = labeledValue(lines, 'Booking number');
  const title = labeledValue(lines, 'Property name');
  if (!reference || !/^\d{6,16}$/.test(reference) || !title || title.length > 160) return undefined;
  const base: KitineraryCandidate = {
    source: 'email-evidence', type: 'hotel', title, provider: 'Booking.com', reference, details: {},
  };
  const candidate = completeHotelDatesFromEmail([base], lines.join('\n'))[0];
  if (!candidate.startAt || !candidate.endAt) return undefined;
  const price = paidAmount(lines);
  if (price !== undefined) { candidate.price = price; candidate.currency = 'EUR'; }
  return candidate;
}
