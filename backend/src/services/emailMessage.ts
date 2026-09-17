import { createHash } from 'node:crypto';
import { simpleParser } from 'mailparser';

export interface ParsedMessage {
  messageId: string;
  sentAt?: string;
  from: string;
  to: string;
  recipients: string[];
  subject: string;
  bodyText: string;
  bodyHtml: string;
}

const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export async function parseEmailMessage(source: Buffer): Promise<ParsedMessage> {
  const mail = await simpleParser(source, { skipImageLinks: true, skipTextToHtml: true });
  const recipientHeaders = new Set(['delivered-to', 'x-original-to', 'envelope-to']);
  const deliveryLines = mail.headerLines
    .filter(({ key }) => recipientHeaders.has(key.toLowerCase()))
    .map(({ line }) => line);
  const addressText = (value: typeof mail.to): string =>
    Array.isArray(value) ? value.map((item) => item.text).join(', ') : value?.text ?? '';
  const addresses = [addressText(mail.to), addressText(mail.cc), ...deliveryLines]
    .filter(Boolean)
    .flatMap((value) => String(value).match(emailPattern) ?? [])
    .map((value) => value.toLowerCase());

  return {
    messageId: mail.messageId || createHash('sha256').update(source).digest('hex'),
    sentAt: mail.date && !Number.isNaN(mail.date.getTime()) ? mail.date.toISOString() : undefined,
    from: addressText(mail.from),
    to: addressText(mail.to),
    recipients: [...new Set(addresses)],
    subject: mail.subject ?? '(no subject)',
    bodyText: mail.text?.trim() ?? '',
    bodyHtml: typeof mail.html === 'string' ? mail.html : '',
  };
}

export function matchesRecipient(message: ParsedMessage, recipient: string): boolean {
  return !recipient || message.recipients.includes(recipient.trim().toLowerCase());
}
