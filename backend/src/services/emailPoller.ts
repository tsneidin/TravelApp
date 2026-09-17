import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { BookingType, EmailConnection, ImportStatus } from '@prisma/client';
import { prisma } from '../db.js';
import { extractEmailWithLlm } from './emailLlmParser.js';
import { decryptEmailPassword, gmailClient } from './emailConnection.js';
import { matchesRecipient, parseEmailMessage } from './emailMessage.js';
import type { ParsedMessage } from './emailMessage.js';
import { extractKitinerary, needsEmailAiCompletion } from './kitinerary.js';

type SkipReason = 'recipientMismatch' | 'alreadyImported' | 'senderFiltered';
type IngestResult = 'stored' | Exclude<SkipReason, 'recipientMismatch'>;

export interface EmailPollResult {
  processed: number;
  imported: number;
  mailboxMatches: number;
  unreadOnly: boolean;
  skipped: Record<SkipReason, number>;
}

const running = new Set<string>();

function emptyResult(unreadOnly: boolean): EmailPollResult {
  return {
    processed: 0, imported: 0, mailboxMatches: 0, unreadOnly,
    skipped: { recipientMismatch: 0, alreadyImported: 0, senderFiltered: 0 },
  };
}

function accountKey(userId: string): string {
  return createHash('sha256').update(userId).digest('hex').slice(0, 8);
}

function messageKey(messageId: string): string {
  return createHash('sha256').update(messageId).digest('hex').slice(0, 12);
}

function recipientHint(address: string): string {
  const [local, domain] = address.split('@');
  const tag = local?.includes('+') ? local.slice(local.indexOf('+')) : '';
  return `${local?.slice(0, 1) || '*'}***${tag}@${domain || '?'}`;
}

function debugMessage(connection: EmailConnection, uid: number, message: ParsedMessage, outcome: string): void {
  if (connection.logLevel !== 'debug') return;
  console.log(`[email] account=${accountKey(connection.userId)} uid=${uid} id=${messageKey(message.messageId)} sent=${message.sentAt || 'unknown'} outcome=${outcome} recipients=${message.recipients.map(recipientHint).join(',') || 'none'}`);
}

export async function pollOnce(userId: string): Promise<EmailPollResult> {
  const connection = await prisma.emailConnection.findUnique({ where: { userId } });
  if (!connection || !connection.enabled) throw new Error('Connect and enable your Gmail account first');
  if (running.has(userId)) throw new Error('This mailbox is already being checked');
  const result = emptyResult(connection.unseenOnly);
  running.add(userId);
  let client: ReturnType<typeof gmailClient> | undefined;
  let lastError: string | null = null;

  try {
    client = gmailClient(connection.username, decryptEmailPassword(connection.secret));
    await client.connect();
    await client.mailboxOpen(connection.folder);
    const uids = (await client.search(connection.unseenOnly ? { seen: false } : { all: true }, { uid: true })) as number[] | false;
    result.mailboxMatches = uids ? uids.length : 0;

    for (const uid of uids || []) {
      const msg = await client.fetchOne(uid, { source: true }, { uid: true });
      if (!msg || !msg.source) continue;
      const parsed = await parseEmailMessage(msg.source);
      result.processed++;
      if (!matchesRecipient(parsed, connection.recipient)) {
        result.skipped.recipientMismatch++;
        debugMessage(connection, uid, parsed, 'recipientMismatch');
        continue;
      }
      const outcome = await ingest(parsed, msg.source, connection);
      if (outcome === 'stored') result.imported++;
      else result.skipped[outcome]++;
      debugMessage(connection, uid, parsed, outcome);
    }
    console.log(`[email] account=${accountKey(userId)} checked ${result.processed} ${connection.unseenOnly ? 'unread' : 'total'}, captured ${result.imported}; skipped recipient=${result.skipped.recipientMismatch}, existing=${result.skipped.alreadyImported}, sender=${result.skipped.senderFiltered}`);
    return result;
  } catch (error) {
    lastError = error instanceof Error ? error.message.slice(0, 200) : 'Mailbox check failed';
    console.error(`[email] account=${accountKey(userId)} poll error: ${lastError}`);
    throw error;
  } finally {
    try {
      if (client?.usable) await client.logout().catch(() => undefined);
      await prisma.emailConnection.updateMany({ where: { userId }, data: { lastCheckedAt: new Date(), lastError } });
    } finally {
      running.delete(userId);
    }
  }
}

async function ingest(p: ParsedMessage, source: Buffer, connection: EmailConnection): Promise<IngestResult> {
  const existing = await prisma.emailImport.findUnique({
    where: { userId_messageId: { userId: connection.userId, messageId: p.messageId } },
  });
  if (existing) return 'alreadyImported';

  const allowed = connection.allowlist.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (allowed.length && !allowed.some((entry) => p.from.toLowerCase().includes(entry))) return 'senderFiltered';

  const extracted = await extractKitinerary(source, 'booking.eml', p.sentAt);
  const llm = needsEmailAiCompletion(extracted) ? await extractEmailWithLlm(p.subject, p.bodyText) : null;
  const usedAi = Boolean(llm?.candidates.length && (!extracted.length || llm.candidates.some((candidate) => candidate.type === 'hotel')));
  const candidates = usedAi ? llm!.candidates : extracted;
  const incomplete = needsEmailAiCompletion(candidates);
  let status: ImportStatus = 'needs_review';
  let type: BookingType | undefined;
  let parsedPayload: Record<string, unknown> | undefined;

  if (candidates.length) {
    type = candidates[0].type;
    status = candidates.some((candidate) => candidate.cancelled) || incomplete ? 'needs_review' : 'parsed';
    parsedPayload = {
      source: usedAi ? 'llm' : 'kitinerary', candidates,
      title: candidates[0].title, provider: candidates[0].provider,
      reference: candidates[0].reference, startAt: candidates[0].startAt,
      endAt: candidates[0].endAt, confidence: 0.85,
    };
  }

  await prisma.emailImport.create({
    data: {
      userId: connection.userId,
      messageId: p.messageId,
      from: p.from,
      to: p.to,
      subject: p.subject,
      bodyText: p.bodyText.slice(0, 60_000),
      bodyHtml: p.bodyHtml.slice(0, 200_000),
      rawSource: source.length <= 15 * 1024 * 1024 ? new Uint8Array(source) : undefined,
      status, type,
      error: incomplete ? llm?.error || 'Hotel dates are incomplete. Reparse or add the booking manually.' : null,
      parsedPayload: parsedPayload as Prisma.InputJsonValue | undefined,
    },
  });
  return 'stored';
}

export function startEmailWorker(): void {
  const run = async () => {
    const now = Date.now();
    const connections = await prisma.emailConnection.findMany({ where: { enabled: true }, select: { userId: true, pollMinutes: true, lastCheckedAt: true } });
    for (const connection of connections) {
      if (running.has(connection.userId)) continue;
      const intervalMs = Math.max(connection.pollMinutes, 1) * 60_000;
      if (connection.lastCheckedAt && now - connection.lastCheckedAt.getTime() < intervalMs) continue;
      void pollOnce(connection.userId).catch(() => undefined);
    }
  };
  void run().catch((error) => console.error('[email] worker error', error));
  setInterval(() => void run().catch((error) => console.error('[email] worker error', error)), 60_000);
}
