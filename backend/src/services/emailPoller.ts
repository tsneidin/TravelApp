import { ImapFlow } from 'imapflow';
import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { parseConfirmation } from './emailParser.js';
import { Prisma } from '@prisma/client';
import type { BookingType, ImportStatus } from '@prisma/client';
import { matchesRecipient, parseEmailMessage } from './emailMessage.js';
import type { ParsedMessage } from './emailMessage.js';
import { extractKitinerary } from './kitinerary.js';

type SkipReason = 'recipientMismatch' | 'alreadyImported' | 'senderFiltered';
type IngestResult = 'stored' | Exclude<SkipReason, 'recipientMismatch'>;

export interface EmailPollResult {
  processed: number;
  imported: number;
  mailboxMatches: number;
  unreadOnly: boolean;
  skipped: Record<SkipReason, number>;
}

function emptyResult(): EmailPollResult {
  return {
    processed: 0,
    imported: 0,
    mailboxMatches: 0,
    unreadOnly: config.email.unseenFirst,
    skipped: { recipientMismatch: 0, alreadyImported: 0, senderFiltered: 0 },
  };
}

function messageKey(messageId: string): string {
  return createHash('sha256').update(messageId).digest('hex').slice(0, 12);
}

function recipientHint(address: string): string {
  const [local, domain] = address.split('@');
  const tag = local?.includes('+') ? local.slice(local.indexOf('+')) : '';
  return `${local?.slice(0, 1) || '*'}***${tag}@${domain || '?'}`;
}

function debugMessage(uid: number, message: ParsedMessage, outcome: string): void {
  if (config.email.logLevel !== 'debug') return;
  console.log(`[email] debug uid=${uid} id=${messageKey(message.messageId)} sent=${message.sentAt || 'unknown'} outcome=${outcome} recipients=${message.recipients.map(recipientHint).join(',') || 'none'}`);
}

function missingEmailSettings(): string[] {
  return [
    !config.email.user && 'IMAP_USER',
    !config.email.pass && 'IMAP_PASS',
    !config.email.recipient && 'EMAIL_RECIPIENT',
  ].filter((value): value is string => Boolean(value));
}

export async function pollOnce(): Promise<EmailPollResult> {
  const result = emptyResult();
  if (!config.email.enabled) return result;
  const missing = missingEmailSettings();
  if (missing.length) {
    console.warn(`[email] cannot poll; missing ${missing.join(', ')}`);
    return result;
  }

  const client = new ImapFlow({
    host: config.email.host,
    port: config.email.port,
    secure: true,
    auth: { user: config.email.user, pass: config.email.pass },
    logger: false,
  });

  try {
    await client.connect();
    await client.mailboxOpen(config.email.folder);
    const query = config.email.unseenFirst ? { seen: false } : { all: true };
    const uids = (await client.search(query, { uid: true })) as number[] | false;
    if (!uids) return result;
    result.mailboxMatches = uids.length;

    for (const uid of uids) {
      const msg = await client.fetchOne(uid, { source: true }, { uid: true });
      if (!msg || !msg.source) continue;
      const parsed = await parseEmailMessage(msg.source);
      result.processed++;
      if (!matchesRecipient(parsed, config.email.recipient)) {
        result.skipped.recipientMismatch++;
        debugMessage(uid, parsed, 'recipientMismatch');
        continue;
      }
      const outcome = await ingest(parsed, msg.source);
      if (outcome === 'stored') result.imported++;
      else result.skipped[outcome]++;
      debugMessage(uid, parsed, outcome);
    }
  } finally {
    try {
      await client.logout();
    } catch {
      /* ignore */
    }
  }

  return result;
}

async function ingest(p: ParsedMessage, source: Buffer): Promise<IngestResult> {
  const existing = await prisma.emailImport.findUnique({ where: { messageId: p.messageId } });
  if (existing) return 'alreadyImported';

  if (config.email.allowlist.length) {
    const from = p.from.toLowerCase();
    if (!config.email.allowlist.some((d) => from.includes(d))) return 'senderFiltered';
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
  return 'stored';
}

export function startEmailWorker(): void {
  if (!config.email.enabled) return;
  const missing = missingEmailSettings();
  if (missing.length) {
    console.warn(`[email] worker disabled; missing ${missing.join(', ')}`);
    return;
  }
  console.log(`[email] monitoring ${config.email.folder} (${config.email.unseenFirst ? 'unread only' : 'all mail'}), recipient=${recipientHint(config.email.recipient)}, log level=${config.email.logLevel}`);
  const intervalMs = Math.max(config.email.pollMinutes, 1) * 60_000;
  const run = async () => {
    try {
      const r = await pollOnce();
      console.log(`[email] polled ${r.processed} ${r.unreadOnly ? 'unread' : 'total'}, imported ${r.imported}; skipped recipient=${r.skipped.recipientMismatch}, existing=${r.skipped.alreadyImported}, sender=${r.skipped.senderFiltered}`);
    } catch (e) {
      console.error('[email] poll error', e);
    }
  };
  void run();
  setInterval(run, intervalMs);
}
