import type { KitineraryCandidate } from './kitinerary.js';

const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const datePattern = new RegExp(`\\b(${months.join('|')})\\s+(\\d{1,2}),?\\s+(20\\d{2})\\b`, 'i');

function localDateTime(line: string): string | undefined {
  const date = line.match(datePattern);
  if (!date) return undefined;
  const month = months.indexOf(date[1].toLowerCase()) + 1;
  const day = Number(date[2]);
  const year = Number(date[3]);
  const valid = new Date(Date.UTC(year, month - 1, day));
  if (valid.getUTCFullYear() !== year || valid.getUTCMonth() !== month - 1 || valid.getUTCDate() !== day) return undefined;
  const prefix = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const window = line.slice(date.index! + date[0].length);
  const time = window.match(/\b(\d{1,2}):(\d{2})\s*(AM|PM)\b/i);
  if (!time) return prefix;
  const hour = Number(time[1]) % 12 + (time[3].toUpperCase() === 'PM' ? 12 : 0);
  const minute = Number(time[2]);
  if (hour > 23 || minute > 59) return undefined;
  return `${prefix}T${String(hour).padStart(2, '0')}:${time[2]}`;
}

function evidenceLine(line: string): string {
  return line
    .replace(/^\s*(?:>\s?)+/, '')
    .replace(/^\s*\|\s*/, '').replace(/\s*\|\s*$/, '')
    .replace(/^[-:|\s]+$/, '')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ').trim();
}

function labeledDate(body: string, label: 'in' | 'out'): string | undefined {
  const lines = body.split('\n').map(evidenceLine);
  const values: string[] = [];
  const labelPattern = label === 'in' ? /^check[ -]?in\b/i : /^check[ -]?out\b/i;
  for (let index = 0; index < lines.length; index++) {
    if (!labelPattern.test(lines[index])) continue;
    let value = localDateTime(lines[index]);
    // Gmail's text rendering inserts separator rows between a table header and
    // its value, so inspect the nearby non-empty rows rather than only one.
    for (let offset = 1; (!value || value.length === 10) && offset <= 8; offset++) {
      const next = lines[index + offset] || '';
      if (/^check[ -]?(?:in|out)\b/i.test(next)) break;
      value = localDateTime(`${lines[index]} ${next}`) || value;
    }
    if (value) values.push(value);
  }
  return values.length && values.every((value) => value === values[0]) ? values[0] : undefined;
}

/** Use explicit check-in/out lines as evidence when an AI hotel preview lacks dates. */
export function completeHotelDatesFromEmail(candidates: KitineraryCandidate[], body: string): KitineraryCandidate[] {
  if (candidates.length !== 1 || candidates[0].type !== 'hotel') return candidates;
  const checkin = labeledDate(body, 'in');
  const checkout = labeledDate(body, 'out');
  if (!checkin && !checkout) return candidates;
  const candidate = candidates[0];
  return [{
    ...candidate,
    // Labeled source text is authoritative. Never retain a model date that
    // contradicts an explicit Check-in or Check-out in the message.
    startAt: checkin || candidate.startAt,
    endAt: checkout || candidate.endAt,
    details: {
      ...candidate.details,
      ...(checkin ? { localStartAt: checkin.slice(0, 16) } : {}),
      ...(checkout ? { localEndAt: checkout.slice(0, 16) } : {}),
    },
  }];
}
