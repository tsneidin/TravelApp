import { Router } from 'express';
import { asyncHandler, badRequest, notFound } from '../lib/errors.js';
import { prisma } from '../db.js';
import { getUser, requireTripAccess } from '../middleware/auth.js';
import { config } from '../config.js';
import { pollOnce } from '../services/emailPoller.js';
import { parseConfirmation } from '../services/emailParser.js';
import { Prisma } from '@prisma/client';
import type { BookingType, ImportStatus } from '@prisma/client';
import { extractKitinerary } from '../services/kitinerary.js';
import type { KitineraryCandidate } from '../services/kitinerary.js';
import { decryptEmailPassword, encryptEmailPassword, testGmailConnection } from '../services/emailConnection.js';
import { z } from 'zod';

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
      include: { trip: { select: { id: true, name: true } } },
    });
    res.json({ imports });
  }),
);

emailRouter.get(
  '/imports/:id',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const item = await prisma.emailImport.findFirst({ where: { id: req.params.id, userId: user.id } });
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
    const tripId = req.body.tripId as string;
    if (!tripId) throw badRequest('tripId is required');
    await requireTripAccess(req, tripId, 'editor');
    const item = await prisma.emailImport.findFirst({ where: { id, userId: user.id } });
    if (!item) throw notFound('Import not found');
    if (item.status === 'imported' || item.status === 'ignored') throw badRequest('This email has already been reviewed');
    const pp: ParsedPayloadShape | null = item.parsedPayload as ParsedPayloadShape | null;
    if (!pp) {
      // attempt re-parse on assign
      const parsed = parseConfirmation(item.subject, item.bodyText ?? '');
      if (!parsed) throw badRequest('This email could not be parsed. Please add the booking manually.');
      await prisma.emailImport.update({
        where: { id },
        data: {
          type: parsed.type,
          parsedPayload: {
            title: parsed.title,
            provider: parsed.provider,
            reference: parsed.reference,
            startAt: parsed.startAt?.toISOString(),
            endAt: parsed.endAt?.toISOString(),
            address: parsed.address,
            details: parsed.details,
            confidence: parsed.confidence,
          },
        },
      });
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
      const claimed = await tx.emailImport.updateMany({
        where: { id, userId: user.id, status: { notIn: ['imported', 'ignored'] } },
        data: { status: 'imported', tripId, assignedAt: new Date() },
      });
      if (!claimed.count) throw badRequest('This email has already been imported');
      const bookings = [];
      let skipped = 0;
      for (const candidate of candidates) {
        const type = candidate.type ?? fresh?.type ?? 'activity';
        const title = candidate.title ?? item.subject;
        const startAt = candidate.startAt && !Number.isNaN(Date.parse(candidate.startAt)) ? new Date(candidate.startAt) : null;
        const existingWhere: Prisma.BookingWhereInput = candidate.reference
          ? { tripId, type, reference: { equals: candidate.reference, mode: 'insensitive' }, ...(startAt ? { startAt } : {}) }
          : { tripId, type, title: { equals: title, mode: 'insensitive' }, ...(startAt ? { startAt } : {}) };
        if (await tx.booking.findFirst({ where: existingWhere, select: { id: true } })) {
          skipped++;
          continue;
        }
        bookings.push(await tx.booking.create({ data: {
          tripId,
          userId: user.id,
          type,
          title,
          provider: candidate.provider,
          reference: candidate.reference,
          startAt,
          endAt: candidate.endAt && !Number.isNaN(Date.parse(candidate.endAt)) ? new Date(candidate.endAt) : null,
          details: {
            ...(candidate.details ?? {}),
            ...(candidate.price !== undefined ? { confirmedPrice: candidate.price } : {}),
            ...(candidate.currency ? { currency: candidate.currency } : {}),
          },
          sourceImportId: id,
        } }));
      }
      return { bookings, skipped };
    });
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
    const item = await prisma.emailImport.update({
      where: { id },
      data: { status: 'ignored' },
    });
    res.json({ item });
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
    if (item.status === 'imported') throw badRequest('An imported email cannot be reparsed');
    const candidates = await extractKitinerary(
      Buffer.from(item.bodyHtml || item.bodyText || ''),
      item.bodyHtml ? 'saved.html' : 'saved.txt',
    );
    const parsed = candidates.length ? null : parseConfirmation(item.subject, item.bodyText ?? '');
    const updated = await prisma.emailImport.update({
      where: { id: item.id },
      data: candidates.length
        ? {
            status: candidates.some((candidate) => candidate.cancelled) ? 'needs_review' : 'parsed',
            type: candidates[0].type,
            parsedPayload: {
              source: 'kitinerary', candidates,
              title: candidates[0].title,
              provider: candidates[0].provider,
              reference: candidates[0].reference,
              startAt: candidates[0].startAt,
              endAt: candidates[0].endAt,
              confidence: 0.85,
            } as unknown as Prisma.InputJsonValue,
          }
        : parsed
        ? {
            status: parsed.confidence >= 0.7 ? 'parsed' : 'needs_review',
            type: parsed.type,
            parsedPayload: {
              title: parsed.title,
              provider: parsed.provider,
              reference: parsed.reference,
              startAt: parsed.startAt?.toISOString(),
              endAt: parsed.endAt?.toISOString(),
              address: parsed.address,
              details: parsed.details,
              confidence: parsed.confidence,
            },
          }
        : { status: 'needs_review' as ImportStatus, parsedPayload: Prisma.DbNull },
    });
    res.json({ item: updated });
  }),
);
