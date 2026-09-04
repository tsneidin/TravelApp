import { ImapFlow } from 'imapflow';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { parseConfirmation } from './emailParser.js';
import { Prisma } from '@prisma/client';
import type { BookingType, ImportStatus } from '@prisma/client';

interface ParsedMessage {
  messageId: string;
  from: string;
  to: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
}

/** Parse a raw RFC822 message string into headers + text/plain body. */
function parseRfc822(raw: string): ParsedMessage {
  const headerEnd = raw.indexOf('\r\n\r\n');
  const headerBlock = headerEnd >= 0 ? raw.slice(0, headerEnd) : raw;
  const bodyBlock = headerEnd >= 0 ? raw.slice(headerEnd + 4) : '';

  const headers: Record<string, string> = {};
  for (const line of headerBlock.split('\r\n')) {
    if (/^[ \t]/.test(line) || !line.includes(':')) continue;
    const idx = line.indexOf(':');
    const name = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    headers[name] = headers[name] ? `${headers[name]} ${value}` : value;
  }

  const unescapeQp = (s: string): string =>
    s.replace(/=([0-9A-F]{2})/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)));
  const decode = (s: string): string =>
    (s || '').replace(/=\?([^?]+)\?([A-Za-z])\?([^?]+)\?=/g, (_m, _charset, enc, body) => {
      try {
        if (enc.toLowerCase() === 'b') return Buffer.from(body, 'base64').toString('utf8');
        return unescapeQp(body);
      } catch {
        return '';
      }
    });

  let bodyText = '';
  let bodyHtml = '';
  if (bodyBlock.includes('text/plain')) {
    const after = bodyBlock.slice(bodyBlock.indexOf('text/plain'));
    bodyText = after.slice(after.indexOf('\r\n\r\n') + 4).trim();
  }
  if (bodyBlock.includes('text/html')) {
    const after = bodyBlock.slice(bodyBlock.indexOf('text/html'));
    bodyHtml = after.slice(after.indexOf('\r\n\r\n') + 4).trim();
  }
  if (!bodyText) {
    bodyText = bodyBlock.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  return {
    messageId: decode(headers['message-id'] ?? `${Date.now()}-${Math.random()}`),
    from: decode(headers['from'] ?? ''),
    to: decode(headers['to'] ?? ''),
    subject: decode(headers['subject'] ?? '(no subject)'),
    bodyText,
    bodyHtml,
  };
}

export async function pollOnce(): Promise<{ processed: number; imported: number }> {
  if (!config.email.enabled) return { processed: 0, imported: 0 };
  if (!config.email.user || !config.email.pass) {
    console.warn('[email] EMAIL_ENABLED=true but IMAP_USER/IMAP_PASS missing; skipping.');
    return { processed: 0, imported: 0 };
  }

  const client = new ImapFlow({
    host: config.email.host,
    port: config.email.port,
    secure: true,
    auth: { user: config.email.user, pass: config.email.pass },
    logger: false,
  });

  let processed = 0;
  let imported = 0;

  try {
    await client.connect();
    await client.mailboxOpen(config.email.folder);
    const query = config.email.unseenFirst ? { seen: false } : { all: true };
    const uids = (await client.search(query, { uid: true })) as number[] | false;
    if (!uids) return { processed, imported };

    for (const uid of uids) {
      const msg = await client.fetchOne(uid, { source: true }, { uid: true });
      if (!msg || !msg.source) continue;
      const parsed = parseRfc822(msg.source.toString('utf8'));
      processed++;
      if (await ingest(parsed)) imported++;
      try {
        await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
      } catch {
        /* non-fatal */
      }
    }
  } finally {
    try {
      await client.logout();
    } catch {
      /* ignore */
    }
  }

  return { processed, imported };
}

async function ingest(p: ParsedMessage): Promise<boolean> {
  const existing = await prisma.emailImport.findUnique({ where: { messageId: p.messageId } });
  if (existing) return false;

  if (config.email.allowlist.length) {
    const from = p.from.toLowerCase();
    if (!config.email.allowlist.some((d) => from.includes(d))) return false;
  }

  const parsed = parseConfirmation(p.subject, p.bodyText);
  let status: ImportStatus = 'pending';
  let type: BookingType | undefined;
  let parsedPayload: Record<string, unknown> | undefined;

  if (parsed) {
    type = parsed.type;
    status = parsed.confidence >= 0.7 ? 'parsed' : 'needs_review';
    parsedPayload = {
      title: parsed.title,
      provider: parsed.provider,
      reference: parsed.reference,
      startAt: parsed.startAt?.toISOString(),
      address: parsed.address,
      details: parsed.details,
      confidence: parsed.confidence,
    };
  }

  await prisma.emailImport.create({
    data: {
      messageId: p.messageId,
      from: p.from,
      to: p.to,
      subject: p.subject,
      bodyText: p.bodyText.slice(0, 60_000),
      bodyHtml: p.bodyHtml.slice(0, 200_000),
      status,
      type,
      parsedPayload: parsedPayload as Prisma.InputJsonValue | undefined,
    },
  });
  return true;
}

export function startEmailWorker(): void {
  if (!config.email.enabled) return;
  const intervalMs = Math.max(config.email.pollMinutes, 1) * 60_000;
  const run = async () => {
    try {
      const r = await pollOnce();
      console.log(`[email] polled ${r.processed}, imported ${r.imported}`);
    } catch (e) {
      console.error('[email] poll error', e);
    }
  };
  void run();
  setInterval(run, intervalMs);
}