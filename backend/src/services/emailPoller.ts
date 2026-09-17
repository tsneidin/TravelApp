import { ImapFlow } from 'imapflow';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { parseConfirmation } from './emailParser.js';
import { Prisma } from '@prisma/client';
import type { BookingType, ImportStatus } from '@prisma/client';
import { matchesRecipient, parseEmailMessage } from './emailMessage.js';
import type { ParsedMessage } from './emailMessage.js';
import { extractKitinerary } from './kitinerary.js';

export async function pollOnce(): Promise<{ processed: number; imported: number }> {
  if (!config.email.enabled) return { processed: 0, imported: 0 };
  if (!config.email.user || !config.email.pass || !config.email.recipient) {
    console.warn('[email] EMAIL_ENABLED=true but IMAP_USER, IMAP_PASS, or EMAIL_RECIPIENT missing; skipping.');
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
      const parsed = await parseEmailMessage(msg.source);
      processed++;
      if (!matchesRecipient(parsed, config.email.recipient)) continue;
      if (await ingest(parsed, msg.source)) imported++;
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

async function ingest(p: ParsedMessage, source: Buffer): Promise<boolean> {
  const existing = await prisma.emailImport.findUnique({ where: { messageId: p.messageId } });
  if (existing) return false;

  if (config.email.allowlist.length) {
    const from = p.from.toLowerCase();
    if (!config.email.allowlist.some((d) => from.includes(d))) return false;
  }

  const candidates = await extractKitinerary(source, 'booking.eml', p.sentAt);
  const parsed = candidates.length ? null : parseConfirmation(p.subject, p.bodyText);
  let status: ImportStatus = 'pending';
  let type: BookingType | undefined;
  let parsedPayload: Record<string, unknown> | undefined;

  if (candidates.length) {
    type = candidates[0].type;
    status = candidates.some((candidate) => candidate.cancelled) ? 'needs_review' : 'parsed';
    parsedPayload = {
      source: 'kitinerary',
      candidates,
      title: candidates[0].title,
      provider: candidates[0].provider,
      reference: candidates[0].reference,
      startAt: candidates[0].startAt,
      endAt: candidates[0].endAt,
      confidence: 0.85,
    };
  } else if (parsed) {
    type = parsed.type;
    status = parsed.confidence >= 0.7 ? 'parsed' : 'needs_review';
    parsedPayload = {
      title: parsed.title,
      provider: parsed.provider,
      reference: parsed.reference,
      startAt: parsed.startAt?.toISOString(),
      endAt: parsed.endAt?.toISOString(),
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
