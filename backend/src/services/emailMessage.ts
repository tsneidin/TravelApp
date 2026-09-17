import { createHash } from 'node:crypto';
import { simpleParser } from 'mailparser';
import { extractText } from 'unpdf';
import { stripHtmlToText } from './fileParser.js';

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
const attachmentLimit = 5 * 1024 * 1024;

async function messageText(mail: Awaited<ReturnType<typeof simpleParser>>, depth = 0): Promise<string> {
  const plainText = mail.text?.trim() || '';
  const htmlText = typeof mail.html === 'string' ? stripHtmlToText(mail.html) : '';
  // Prefer the rendering that retains more booking evidence. Mailparser's
  // generated plain text sometimes joins adjacent HTML table cells.
  const score = (value: string) => (value.match(/\b(?:booking number|property name|check[ -]?in|check[ -]?out|amount paid|total price)\s+\S|[€£$]/gi) || []).length;
  const plainScore = score(plainText);
  const htmlScore = score(htmlText);
  const parts = [htmlText && (!plainText || htmlScore > plainScore || (htmlScore === plainScore && htmlText.length > plainText.length * 1.5)) ? htmlText : plainText];
  if (depth >= 2) return parts.filter(Boolean).join('\n\n');
  for (const attachment of mail.attachments.slice(0, 5)) {
    const content = attachment.content as Buffer;
    if (!Buffer.isBuffer(content) || content.length > attachmentLimit) continue;
    const filename = attachment.filename || 'attachment';
    const mime = attachment.contentType.toLowerCase();
    try {
      let text = '';
      if (mime === 'message/rfc822' || /\.eml$/i.test(filename)) {
        const forwarded = await simpleParser(content, { skipImageLinks: true, skipTextToHtml: true });
        text = `Subject: ${forwarded.subject || filename}\n${await messageText(forwarded, depth + 1)}`;
      } else if (mime === 'application/pdf' || /\.pdf$/i.test(filename)) {
        const pdf = await extractText(new Uint8Array(content), { mergePages: true });
        text = Array.isArray(pdf.text) ? pdf.text.join('\n') : String(pdf.text || '');
      } else if (/^(text\/plain|text\/html|text\/calendar)$/.test(mime) || /\.(txt|html?|ics)$/i.test(filename)) {
        text = mime === 'text/html' || /\.html?$/i.test(filename) ? stripHtmlToText(content.toString('utf8')) : content.toString('utf8');
      }
      if (text.trim()) parts.push(`Attached ${filename}:\n${text.trim()}`);
    } catch {
      // Keep the outer email available for review when one attachment is unreadable.
    }
  }
  const combined = parts.filter(Boolean).join('\n\n');
  return combined.length > 60_000
    ? `${combined.slice(0, 1_000)}\n\n[Earlier forwarding text omitted]\n\n${combined.slice(-58_000)}`
    : combined;
}

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
    bodyText: await messageText(mail),
    bodyHtml: typeof mail.html === 'string' ? mail.html : '',
  };
}

export function matchesRecipient(message: ParsedMessage, recipient: string): boolean {
  return !recipient || message.recipients.includes(recipient.trim().toLowerCase());
}
