import { Router } from 'express';
import { asyncHandler, badRequest, notFound } from '../lib/errors.js';
import { prisma } from '../db.js';
import { getUser, requireTripAccess } from '../middleware/auth.js';
import { config } from '../config.js';
import { pollOnce } from '../services/emailPoller.js';
import { parseConfirmation } from '../services/emailParser.js';
import { Prisma } from '@prisma/client';
import type { ImportStatus } from '@prisma/client';

interface ParsedPayloadShape {
  title?: string;
  provider?: string;
  reference?: string;
  startAt?: string;
  address?: string;
  details?: Record<string, string>;
  confidence?: number;
}

export const emailRouter = Router();

emailRouter.get(
  '/status',
  asyncHandler(async (_req, res) => {
    const recent = await prisma.emailImport.count({ where: { createdAt: { gte: new Date(Date.now() - 24 * 3600 * 1000) } } });
    const grouped = await prisma.emailImport.groupBy({ by: ['status'], _count: { _all: true } });
    res.json({
      enabled: config.email.enabled,
      host: config.email.host,
      user: config.email.user,
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
    const booking = await prisma.booking.create({
      data: {
        tripId,
        userId: user.id,
        type: fresh?.type ?? 'activity',
        title: bpp.title ?? item.subject,
        provider: bpp.provider,
        reference: bpp.reference,
        startAt: bpp.startAt ? new Date(bpp.startAt) : null,
        details: bpp.details ?? {},
        sourceImportId: id,
      },
    });
    await prisma.emailImport.update({
      where: { id },
      data: { status: 'imported', tripId, userId: user.id, assignedAt: new Date() },
    });
    res.status(201).json({ booking });
  }),
);

emailRouter.post(
  '/imports/:id/ignore',
  asyncHandler(async (req, res) => {
    const { id } = req.params;
    await requireTripAccess(req, String(req.body.tripId || ''), 'editor');
    const item = await prisma.emailImport.update({
      where: { id },
      data: { status: 'ignored', tripId: req.body.tripId || null },
    });
    res.json({ item });
  }),
);

emailRouter.post(
  '/imports/:id/reparse',
  asyncHandler(async (_req, res) => {
    // reparse is admin-or-owner; re-run parser on stored text
    const item = await prisma.emailImport.findUnique({ where: { id: _req.params.id } });
    if (!item) {
      res.status(404).json({ error: 'Import not found' });
      return;
    }
    const parsed = parseConfirmation(item.subject, item.bodyText ?? '');
    const updated = await prisma.emailImport.update({
      where: { id: item.id },
      data: parsed
        ? {
            status: parsed.confidence >= 0.7 ? 'parsed' : 'needs_review',
            type: parsed.type,
            parsedPayload: {
              title: parsed.title,
              provider: parsed.provider,
              reference: parsed.reference,
              startAt: parsed.startAt?.toISOString(),
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