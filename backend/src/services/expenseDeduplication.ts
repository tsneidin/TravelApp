export interface ExpenseIdentity {
  description: string;
  notes?: string | null;
  amount: number;
  currency?: string | null;
  date?: Date | string | null;
}

const GENERIC_WORDS = new Set([
  'booking', 'comfort', 'expense', 'payment', 'receipt', 'ticket', 'tickets',
  'total', 'train', 'transport', 'travel',
]);

function dateKey(value?: Date | string | null): string {
  if (!value) return '';
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

function tokens(value: ExpenseIdentity): Set<string> {
  return new Set(`${value.description} ${value.notes || ''}`
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 4 && !GENERIC_WORDS.has(word)));
}

function receiptIdentifiers(value: ExpenseIdentity): Set<string> {
  const text = `${value.description} ${value.notes || ''}`.toUpperCase();
  const identifiers = new Set<string>();
  const labeled = /\b(?:BOOKING|RECEIPT|CONFIRMATION|REFERENCE|REF|NUMBER|CODE)(?:\s+(?:NUMBER|NO))?\s*[:#-]?\s*([A-Z0-9]{5,20})\b/g;
  const parenthesized = /\(([A-Z0-9]{5,20})\)/g;

  for (const match of text.matchAll(labeled)) identifiers.add(match[1]);
  for (const match of text.matchAll(parenthesized)) identifiers.add(match[1]);
  return identifiers;
}

export function hasMatchingReceiptIdentifier(existing: ExpenseIdentity, incoming: ExpenseIdentity): boolean {
  const existingIdentifiers = receiptIdentifiers(existing);
  const incomingIdentifiers = receiptIdentifiers(incoming);
  return [...incomingIdentifiers].some((identifier) => existingIdentifiers.has(identifier));
}

/** Guard against an AI receipt flow logging the booking price a second time. */
export function isLikelyDuplicateExpense(existing: ExpenseIdentity, incoming: ExpenseIdentity): boolean {
  if (Math.round(Number(existing.amount) * 100) !== Math.round(Number(incoming.amount) * 100)) return false;
  if ((existing.currency || 'USD').toUpperCase() !== (incoming.currency || 'USD').toUpperCase()) return false;

  if (hasMatchingReceiptIdentifier(existing, incoming)) return true;

  const existingDate = dateKey(existing.date);
  const incomingDate = dateKey(incoming.date);
  if (existingDate && incomingDate && existingDate !== incomingDate) return false;

  const existingTokens = tokens(existing);
  const incomingTokens = tokens(incoming);
  return [...incomingTokens].some((token) => existingTokens.has(token));
}

export function isTransportReceipt(...values: Array<string | null | undefined>): boolean {
  return /\b(?:bus|coach|ferry|itabus|flixbus|metropark|rail|train|trenitalia)\b/i.test(values.filter(Boolean).join(' '));
}
