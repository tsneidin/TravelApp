import { Router } from 'express';
import { asyncHandler, badRequest, notFound } from '../lib/errors.js';
import { prisma } from '../db.js';
import { getUser, requireTripAccess } from '../middleware/auth.js';
import { config } from '../config.js';
import { pollOnce } from '../services/emailPoller.js';
import { extractEmailWithLlm } from '../services/emailLlmParser.js';
import { parseEmailMessage } from '../services/emailMessage.js';
import { stripHtmlToText } from '../services/fileParser.js';
import { Prisma } from '@prisma/client';
import type { BookingType, ImportStatus } from '@prisma/client';
import { extractKitinerary, needsEmailAiCompletion } from '../services/kitinerary.js';
import type { KitineraryCandidate } from '../services/kitinerary.js';
import { decryptEmailPassword, encryptEmailPassword, testGmailConnection } from '../services/emailConnection.js';
import { z } from 'zod';
import { reconcileTripDays } from '../services/dayReconciliation.js';

interface ParsedPayloadShape {
  source?: string;
  candidates?: KitineraryCandidate[];
  type?: BookingType;
  title?: string;
  provider?: string;
  reference?: string;
  startAt?: string;
  endAt?: string;
  address?: string;
  price?: number;
  currency?: string;
  cancelled?: boolean;
  details?: Record<string, string>;
  confidence?: number;
}

export const emailRouter = Router();

const connectionSchema = z.object({
  username: z.string().email(),
  recipient: z.string().email(),
  appPassword: z.string().max(200).optional(),
  folder: z.string().min(1).max(100).default('INBOX'),
  enabled: z.boolean().default(true),
  unseenOnly: z.boolean().default(true),
  pollMinutes: z.number().int().min(1).max(60).default(5),
  logLevel: z.enum(['info', 'debug']).default('info'),
  allowlist: z.string().max(500).default(''),
});

function bookingDate(candidate: ParsedPayloadShape, field: 'startAt' | 'endAt'): Date | null {
  const local = candidate.details?.[field === 'startAt' ? 'localStartAt' : 'localEndAt'];
  if (local && /^20\d\d-\d\d-\d\d(?:T\d\d:\d\d)?$/.test(local)) {
    return new Date(`${local.length === 10 ? `${local}T12:00` : local}:00Z`);
  }
  const value = candidate[field];
  return value && !Number.isNaN(Date.parse(value)) ? new Date(value) : null;
}

emailRouter.patch(
  '/connection',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const parsed = connectionSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Enter a valid Gmail address, import address, and mailbox settings');
    const values = parsed.data;
    const username = values.username.trim().toLowerCase();
    const recipient = values.recipient.trim().toLowerCase();
    const existing = await prisma.emailConnection.findUnique({ where: { userId: user.id } });
    const password = values.appPassword?.replace(/\s+/g, '') || (existing ? decryptEmailPassword(existing.secret) : '');
    if (!password) throw badRequest('A Gmail app password is required');
    if (values.enabled) {
      try {
        await testGmailConnection(username, password, values.folder);
      } catch {
        throw badRequest('Could not connect to Gmail. Check the account, app password, and folder.');
      }
    }
    await prisma.emailConnection.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id, username, recipient,
        secret: encryptEmailPassword(password), folder: values.folder,
        enabled: values.enabled, unseenOnly: values.unseenOnly,
        pollMinutes: values.pollMinutes, logLevel: values.logLevel, allowlist: values.allowlist.trim(),
      },
      update: {
        username, recipient, secret: encryptEmailPassword(password), folder: values.folder,
        enabled: values.enabled, unseenOnly: values.unseenOnly,
        pollMinutes: values.pollMinutes, logLevel: values.logLevel, allowlist: values.allowlist.trim(),
        lastError: null,
      },
    });
    // The former server-wide inbox had unassigned records. Claim them only
    // after this user proves access to that same mailbox and import address.
    let claimed = 0;
    if (values.enabled && config.legacyEmail.user === username && config.legacyEmail.recipient === recipient) {
      const unassigned = await prisma.emailImport.findMany({ where: { userId: null }, select: { id: true, messageId: true } });
      for (const item of unassigned) {
        const duplicate = await prisma.emailImport.findUnique({
          where: { userId_messageId: { userId: user.id, messageId: item.messageId } },
          select: { id: true },
        });
        if (duplicate) continue;
        const result = await prisma.emailImport.updateMany({ where: { id: item.id, userId: null }, data: { userId: user.id } });
        claimed += result.count;
      }
    }
    res.json({ ok: true, claimed });
  }),
);

emailRouter.delete(
  '/connection',
  asyncHandler(async (req, res) => {
    await prisma.emailConnection.deleteMany({ where: { userId: getUser(req).id } });
    res.status(204).send();
  }),
);

emailRouter.get(
  '/status',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const connection = await prisma.emailConnection.findUnique({ where: { userId: user.id } });
    const recent = await prisma.emailImport.count({ where: { userId: user.id, createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } } });
    const grouped = await prisma.emailImport.groupBy({ by: ['status'], where: { userId: user.id }, _count: { _all: true } });
    res.json({
      enabled: connection?.enabled ?? false,
      configured: Boolean(connection),
      username: connection?.username ?? '',
      recipient: connection?.recipient ?? '',
      folder: connection?.folder ?? 'INBOX',
      pollMinutes: connection?.pollMinutes ?? 5,
      logLevel: connection?.logLevel ?? 'info',
      unseenOnly: connection?.unseenOnly ?? true,
      allowlist: connection?.allowlist ?? '',
      lastCheckedAt: connection?.lastCheckedAt ?? null,
      lastError: connection?.lastError ?? null,
      recent24h: recent,
      byStatus: grouped.map((g) => ({ status: g.status, count: g._count._all })),
    });
  }),
);

emailRouter.post(
  '/poll',
  asyncHandler(async (req, res) => {
    const u = getUser(req);
    const result = await pollOnce(u.id);
    res.json(result);
  }),
);

emailRouter.get(
  '/imports',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const status = req.query.status as string | undefined;
    const where: Prisma.EmailImportWhereInput = { userId: user.id };
    if (status) where.status = status as ImportStatus;
    const imports = await prisma.emailImport.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { id: true, from: true, subject: true, status: true, type: true, createdAt: true, tripId: true, trip: { select: { id: true, name: true } } },
    });
    res.json({ imports });
  }),
);

emailRouter.get(
  '/imports/:id',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const item = await prisma.emailImport.findFirst({ where: { id: req.params.id, userId: user.id }, omit: { rawSource: true }, include: { trip: { select: { id: true, name: true } } } });
    if (!item) {
      res.status(404).json({ error: 'Import not found' });
      return;
    }
    res.json({ item });
  }),
);

emailRouter.delete(
  '/imports/:id',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const item = await prisma.emailImport.findFirst({ where: { id: req.params.id, userId: user.id } });
    if (!item) throw notFound('Import not found');
    if (item.status === 'imported') throw badRequest('Imported emails cannot be deleted here');
    await prisma.emailImport.delete({ where: { id: req.params.id } });
    res.status(204).send();
  }),
);

emailRouter.post(
  '/imports/:id/assign',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const user = getUser(req);
    const tripId = typeof req.body.tripId === 'string' ? req.body.tripId : '';
    const newTrip = z.object({ name: z.string().trim().min(1).max(120), destination: z.string().trim().max(200).optional() }).safeParse(req.body.newTrip);
    if (!tripId && !newTrip.success) throw badRequest('Select a trip or enter a new trip name');
    if (tripId && req.body.newTrip) throw badRequest('Choose an existing trip or a new trip');
    if (tripId) await requireTripAccess(req, tripId, 'editor');
    const item = await prisma.emailImport.findFirst({ where: { id, userId: user.id } });
    if (!item) throw notFound('Import not found');
    if (item.status === 'imported' || item.status === 'ignored') throw badRequest('This email has already been reviewed');
    if (item.error) throw badRequest('Resolve the extraction error by reparsing this email before approval');
    const pp: ParsedPayloadShape | null = item.parsedPayload as ParsedPayloadShape | null;
    if (!pp) {
      throw badRequest('No reservation was extracted. Reparse this email or add the booking manually.');
    }
    const fresh = await prisma.emailImport.findUnique({ where: { id } });
    const updatedPp: ParsedPayloadShape | null = fresh?.parsedPayload as ParsedPayloadShape | null;
    const bpp: ParsedPayloadShape = updatedPp ?? {};
    if (bpp.candidates && bpp.candidates.length > 20) throw badRequest('Too many reservations in one email');
    const candidates: ParsedPayloadShape[] = bpp.candidates?.length ? bpp.candidates : [bpp];
    if (candidates.some((candidate) => candidate.cancelled)) {
      throw badRequest('This email includes a cancellation. Review the existing booking instead.');
    }
    const result = await prisma.$transaction(async (tx) => {
      const dateKeys = candidates.flatMap((candidate) => [candidate.details?.localStartAt?.slice(0, 10) || candidate.startAt?.slice(0, 10), candidate.details?.localEndAt?.slice(0, 10) || candidate.endAt?.slice(0, 10)]).filter((value): value is string => Boolean(value && /^20\d\d-\d\d-\d\d$/.test(value))).sort();
      const createdTrip = newTrip.success ? await tx.trip.create({ data: {
        ownerId: user.id,
        name: newTrip.data.name,
        destination: newTrip.data.destination || '',
        currency: candidates.find((candidate) => candidate.currency)?.currency || 'USD',
        startDate: dateKeys.length ? new Date(`${dateKeys[0]}T12:00:00Z`) : undefined,
        endDate: dateKeys.length ? new Date(`${dateKeys.at(-1)}T12:00:00Z`) : undefined,
      } }) : null;
      const targetTripId = createdTrip?.id || tripId;
      const claimed = await tx.emailImport.updateMany({
        where: { id, userId: user.id, status: { notIn: ['imported', 'ignored'] } },
        data: { status: 'imported', tripId: targetTripId, assignedAt: new Date() },
      });
      if (!claimed.count) throw badRequest('This email has already been imported');
      const bookings = [];
      let skipped = 0;
      for (const candidate of candidates) {
        const type = candidate.type ?? fresh?.type ?? 'activity';
        const title = candidate.title ?? item.subject;
        const startAt = bookingDate(candidate, 'startAt');
        const existingWhere: Prisma.BookingWhereInput = candidate.reference
          ? { tripId: targetTripId, type, reference: { equals: candidate.reference, mode: 'insensitive' }, ...(startAt ? { startAt } : {}) }
          : { tripId: targetTripId, type, title: { equals: title, mode: 'insensitive' }, ...(startAt ? { startAt } : {}) };
        if (await tx.booking.findFirst({ where: existingWhere, select: { id: true } })) {
          skipped++;
          continue;
        }
        bookings.push(await tx.booking.create({ data: {
          tripId: targetTripId,
          userId: user.id,
          type,
          title,
          provider: candidate.provider,
          reference: candidate.reference,
          startAt,
          endAt: bookingDate(candidate, 'endAt'),
          details: {
            ...(candidate.details ?? {}),
            ...(candidate.price !== undefined ? { confirmedPrice: candidate.price } : {}),
            ...(candidate.currency ? { currency: candidate.currency } : {}),
          },
          sourceImportId: id,
        } }));
      }
      return { bookings, skipped, trip: createdTrip ? { id: createdTrip.id, name: createdTrip.name } : null, tripId: targetTripId };
    });
    await reconcileTripDays(result.tripId).catch((error) => console.warn('[email] trip day refresh failed after approval', error));
    res.status(201).json(result);
  }),
);

emailRouter.post(
  '/imports/:id/ignore',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    const user = getUser(req);
    const existing = await prisma.emailImport.findFirst({ where: { id, userId: user.id } });
    if (!existing) throw notFound('Import not found');
    if (existing.status === 'imported') throw badRequest('An imported email cannot be ignored');
    await prisma.emailImport.update({
      where: { id },
      data: { status: 'ignored' },
    });
    res.json({ ok: true });
  }),
);

emailRouter.post(
  '/imports/:id/reparse',
  asyncHandler(async (req, res) => {
    const item = await prisma.emailImport.findFirst({ where: { id: req.params.id, userId: getUser(req).id } });
    if (!item) {
      res.status(404).json({ error: 'Import not found' });
      return;
    }
    const hasOriginal = Boolean(item.rawSource?.length);
    const bodyText = hasOriginal
      ? (await parseEmailMessage(Buffer.from(item.rawSource!))).bodyText
      : item.bodyText?.trim() || stripHtmlToText(item.bodyHtml || '');
    const extracted = await extractKitinerary(
      hasOriginal ? Buffer.from(item.rawSource!) : Buffer.from(item.bodyHtml || item.bodyText || ''),
      hasOriginal ? 'booking.eml' : item.bodyHtml ? 'saved.html' : 'saved.txt',
    );
    const previous = item.parsedPayload as ParsedPayloadShape | null;
    const savedCandidates = previous?.source === 'kitinerary' ? previous.candidates || [] : [];
    const kitineraryCandidates = extracted.length ? extracted : savedCandidates;
    const llm = needsEmailAiCompletion(kitineraryCandidates) ? await extractEmailWithLlm(item.subject, bodyText) : null;
    const usedAi = Boolean(llm?.candidates.length && (!kitineraryCandidates.length || llm.candidates.some((candidate) => candidate.type === 'hotel')));
    const candidates = usedAi ? llm!.candidates : kitineraryCandidates;
    const incomplete = needsEmailAiCompletion(candidates);
    const updated = await prisma.emailImport.update({
      where: { id: item.id },
      omit: { rawSource: true },
      include: { trip: { select: { id: true, name: true } } },
      data: candidates.length
        ? {
            status: item.status === 'imported' ? 'imported' : candidates.some((candidate) => candidate.cancelled) || incomplete ? 'needs_review' : 'parsed',
            type: candidates[0].type,
            bodyText: bodyText.slice(0, 60_000),
            error: incomplete ? llm?.error || 'Hotel dates are incomplete. Reparse or add the booking manually.' : null,
            parsedPayload: {
              source: usedAi ? 'llm' : 'kitinerary', candidates,
              title: candidates[0].title,
              provider: candidates[0].provider,
              reference: candidates[0].reference,
              startAt: candidates[0].startAt,
              endAt: candidates[0].endAt,
              confidence: 0.85,
            } as unknown as Prisma.InputJsonValue,
          }
        : { status: item.status === 'imported' ? 'imported' : 'needs_review' as ImportStatus, bodyText: bodyText.slice(0, 60_000), error: llm?.error || 'No reservation found', parsedPayload: previous ? previous as Prisma.InputJsonValue : Prisma.DbNull },
    });
    const parser = usedAi ? 'AI extraction' : extracted.length ? 'KItinerary from the full email' : savedCandidates.length ? 'Saved KItinerary result' : 'AI extraction';
    const changed = JSON.stringify(item.parsedPayload) !== JSON.stringify(updated.parsedPayload);
    res.json({ item: updated, parser, reservations: candidates.length, changed });
  }),
);

emailRouter.post(
  '/imports/:id/apply-dates',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const item = await prisma.emailImport.findFirst({ where: { id: req.params.id, userId: user.id } });
    if (!item || item.status !== 'imported' || !item.tripId) throw notFound('Imported email not found');
    if (item.error) throw badRequest('Reparse this email successfully before applying dates');
    await requireTripAccess(req, item.tripId, 'editor');
    const parsed = item.parsedPayload as ParsedPayloadShape | null;
    if (!parsed) throw badRequest('Reparse this email before updating booking dates');
    const candidates: ParsedPayloadShape[] = parsed.candidates?.length ? parsed.candidates : [parsed];
    if (candidates.some((candidate) => candidate.cancelled)) throw badRequest('A cancellation cannot update booking dates');
    const bookings = await prisma.booking.findMany({ where: { tripId: item.tripId, sourceImportId: item.id } });
    if (!bookings.length) throw badRequest('No booking from this email was found in the trip');
    const updated = await prisma.$transaction(async (tx) => {
      let count = 0;
      const matched = new Set<string>();
      for (const candidate of candidates) {
        const booking = bookings.find((entry) => !matched.has(entry.id) && (
          (candidate.reference && entry.reference?.toLowerCase() === candidate.reference.toLowerCase()) ||
          (!candidate.reference && entry.title.toLowerCase() === (candidate.title || '').toLowerCase()) ||
          (candidates.length === 1 && bookings.length === 1)));
        if (!booking || (!candidate.startAt && !candidate.endAt)) continue;
        const details = booking.details && typeof booking.details === 'object' && !Array.isArray(booking.details)
          ? booking.details as Record<string, unknown> : {};
        await tx.booking.update({ where: { id: booking.id }, data: {
          ...(candidate.startAt ? { startAt: bookingDate(candidate, 'startAt') } : {}),
          ...(candidate.endAt ? { endAt: bookingDate(candidate, 'endAt') } : {}),
          details: { ...details, ...(candidate.details ?? {}) } as Prisma.InputJsonValue,
          updatedById: user.id,
        } });
        matched.add(booking.id);
        count++;
      }
      if (!count) throw badRequest('No usable dates were found for the linked booking');
      return count;
    });
    await reconcileTripDays(item.tripId).catch((error) => console.warn('[email] trip day refresh failed after date update', error));
    res.json({ updated });
  }),
);
