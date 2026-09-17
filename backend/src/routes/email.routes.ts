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

emailRouter.get(
  '/status',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    if (!user.isAdmin) {
      res.status(403).json({ error: 'Admin only' });
      return;
    }
    const recent = await prisma.emailImport.count({ where: { createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } } });
    const grouped = await prisma.emailImport.groupBy({ by: ['status'], _count: { _all: true } });
    res.json({
      enabled: config.email.enabled,
      host: config.email.host,
      user: config.email.user,
      recipient: config.email.recipient,
      folder: config.email.folder,
      configured: Boolean(config.email.user && config.email.pass && config.email.recipient),
      pollMinutes: config.email.pollMinutes,
      recent24h: recent,
      byStatus: grouped.map((g) => ({ status: g.status, count: g._count._all })),
    });
  }),
);

emailRouter.post(
  '/poll',
  asyncHandler(async (req, res) => {
    const u = getUser(req);
    if (!u.isAdmin) {
      res.status(403).json({ error: 'Admin only' });
      return;
    }
    if (!config.email.enabled || !config.email.user || !config.email.pass || !config.email.recipient) {
      throw badRequest('Email import is not fully configured');
    }
    const result = await pollOnce();
    res.json(result);
  }),
);

emailRouter.get(
  '/imports',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    const status = req.query.status as string | undefined;
    const where: Prisma.EmailImportWhereInput = {};
    if (status) where.status = status as ImportStatus;
    if (!user.isAdmin) where.trip = { members: { some: { userId: user.id } } };
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
    const item = await prisma.emailImport.findUnique({ where: { id: req.params.id } });
    if (!item) {
      res.status(404).json({ error: 'Import not found' });
      return;
    }
    if (!user.isAdmin) {
      const trip = item.tripId ? await prisma.tripMember.findFirst({ where: { tripId: item.tripId, userId: user.id } }) : await prisma.tripMember.findFirst({ where: { userId: user.id } });
      if (!trip) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
    }
    res.json({ item });
  }),
);

emailRouter.delete(
  '/imports/:id',
  asyncHandler(async (req, res) => {
    const user = getUser(req);
    if (!user.isAdmin) {
      res.status(403).json({ error: 'Admin only' });
      return;
    }
    const item = await prisma.emailImport.findUnique({ where: { id: req.params.id } });
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
    const item = await prisma.emailImport.findUnique({ where: { id } });
    if (!item) throw notFound('Import not found');
    if (item.status === 'imported') throw badRequest('This email has already been imported');
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
        where: { id, status: { not: 'imported' } },
        data: { status: 'imported', tripId, userId: user.id, assignedAt: new Date() },
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
    await requireTripAccess(req, String(req.body.tripId || ''), 'editor');
    const existing = await prisma.emailImport.findUnique({ where: { id } });
    if (!existing) throw notFound('Import not found');
    if (existing.status === 'imported') throw badRequest('An imported email cannot be ignored');
    const item = await prisma.emailImport.update({
      where: { id },
      data: { status: 'ignored', tripId: req.body.tripId || null },
    });
    res.json({ item });
  }),
);

emailRouter.post(
  '/imports/:id/reparse',
  asyncHandler(async (req, res) => {
    if (!getUser(req).isAdmin) {
      res.status(403).json({ error: 'Admin only' });
      return;
    }
    const item = await prisma.emailImport.findUnique({ where: { id: req.params.id } });
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
