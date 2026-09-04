import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { asyncHandler, badRequest } from '../lib/errors.js';
import { prisma } from '../db.js';
import { getUser, requireTripAccess, requireFields } from '../middleware/auth.js';
import { config } from '../config.js';

export const contentRouter = Router();

// ---------- storage ----------
fs.mkdirSync(config.uploadDir, { recursive: true });
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname ?? '').slice(0, 12);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: config.maxUploadMb * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      cb(new Error('Only image uploads are allowed'));
      return;
    }
    cb(null, true);
  },
});

// ---------- PHOTOS ----------
contentRouter.get(
  '/:tripId/photos',
  asyncHandler(async (req, res) => {
    const { tripId } = req.params;
    await requireTripAccess(req, tripId, 'viewer');
    const photos = await prisma.photo.findMany({ where: { tripId }, orderBy: { createdAt: 'desc' } });
    res.json({ photos: photos.map((p) => ({
      id: p.id,
      caption: p.caption,
      filename: p.filename,
      placeId: p.placeId,
      createdAt: p.createdAt,
      url: `${config.publicBaseUrl}/api/uploads/${p.filename}`,
    })) });
  }),
);

contentRouter.post(
  '/:tripId/photos',
  upload.array('files', 20),
  asyncHandler(async (req, res) => {
    const { tripId } = req.params;
    const user = getUser(req);
    await requireTripAccess(req, tripId, 'editor');
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (!files.length) throw badRequest('No files uploaded');
    const caption = req.body.caption || undefined;
    const placeId = req.body.placeId || null;
    const created = await Promise.all(
      files.map((f) =>
        prisma.photo.create({
          data: {
            tripId,
            userId: user.id,
            placeId,
            filename: f.filename,
            caption,
            mimeType: f.mimetype,
            size: f.size,
          },
        }),
      ),
    );
    res.status(201).json({
      photos: created.map((p) => ({
        id: p.id,
        caption: p.caption,
        filename: p.filename,
        placeId: p.placeId,
        createdAt: p.createdAt,
        url: `${config.publicBaseUrl}/api/uploads/${p.filename}`,
      })),
    });
  }),
);

contentRouter.patch(
  '/:tripId/photos/:photoId',
  asyncHandler(async (req, res) => {
    const { tripId, photoId } = req.params;
    await requireTripAccess(req, tripId, 'editor');
    const photo = await prisma.photo.update({
      where: { id: photoId },
      data: { caption: req.body.caption, placeId: req.body.placeId ?? null },
    });
    res.json({ photo });
  }),
);

contentRouter.delete(
  '/:tripId/photos/:photoId',
  asyncHandler(async (req, res) => {
    const { tripId, photoId } = req.params;
    await requireTripAccess(req, tripId, 'editor');
    const photo = await prisma.photo.findUnique({ where: { id: photoId } });
    if (photo) {
      try {
        fs.unlinkSync(path.join(config.uploadDir, photo.filename));
      } catch { /* file may already be gone */ }
    }
    await prisma.photo.delete({ where: { id: photoId } });
    res.status(204).send();
  }),
);

// ---------- JOURNAL ----------
contentRouter.get(
  '/:tripId/journal',
  asyncHandler(async (req, res) => {
    const { tripId } = req.params;
    await requireTripAccess(req, tripId, 'viewer');
    const journal = await prisma.journalEntry.findMany({ where: { tripId }, orderBy: { date: 'asc' } });
    res.json({ journal });
  }),
);

contentRouter.post(
  '/:tripId/journal',
  asyncHandler(async (req, res) => {
    const { tripId } = req.params;
    const user = getUser(req);
    await requireTripAccess(req, tripId, 'editor');
    requireFields(req, ['title', 'body']);
    const entry = await prisma.journalEntry.create({
      data: { tripId, userId: user.id, title: req.body.title, body: req.body.body, date: req.body.date ? new Date(req.body.date) : null },
    });
    res.status(201).json({ entry });
  }),
);

contentRouter.patch(
  '/:tripId/journal/:entryId',
  asyncHandler(async (req, res) => {
    const { tripId, entryId } = req.params;
    await requireTripAccess(req, tripId, 'editor');
    const entry = await prisma.journalEntry.update({
      where: { id: entryId },
      data: {
        title: req.body.title,
        body: req.body.body,
        date: req.body.date !== undefined ? (req.body.date ? new Date(req.body.date) : null) : undefined,
      },
    });
    res.json({ entry });
  }),
);

contentRouter.delete(
  '/:tripId/journal/:entryId',
  asyncHandler(async (req, res) => {
    const { tripId, entryId } = req.params;
    await requireTripAccess(req, tripId, 'editor');
    await prisma.journalEntry.delete({ where: { id: entryId } });
    res.status(204).send();
  }),
);

// ---------- PACKING ----------
contentRouter.get(
  '/:tripId/packing',
  asyncHandler(async (req, res) => {
    const { tripId } = req.params;
    await requireTripAccess(req, tripId, 'viewer');
    const packing = await prisma.packingItem.findMany({ where: { tripId }, orderBy: { sortOrder: 'asc' } });
    res.json({ packing });
  }),
);

contentRouter.post(
  '/:tripId/packing',
  asyncHandler(async (req, res) => {
    const { tripId } = req.params;
    await requireTripAccess(req, tripId, 'editor');
    requireFields(req, ['item']);
    const count = await prisma.packingItem.count({ where: { tripId } });
    const item = await prisma.packingItem.create({
      data: { tripId, item: req.body.item, category: req.body.category, sortOrder: count },
    });
    res.status(201).json({ item });
  }),
);

contentRouter.patch(
  '/:tripId/packing/:itemId',
  asyncHandler(async (req, res) => {
    const { tripId, itemId } = req.params;
    await requireTripAccess(req, tripId, 'editor');
    const item = await prisma.packingItem.update({
      where: { id: itemId },
      data: {
        item: req.body.item,
        category: req.body.category,
        done: req.body.done,
        sortOrder: req.body.sortOrder,
      },
    });
    res.json({ item });
  }),
);

contentRouter.delete(
  '/:tripId/packing/:itemId',
  asyncHandler(async (req, res) => {
    const { tripId, itemId } = req.params;
    await requireTripAccess(req, tripId, 'editor');
    await prisma.packingItem.delete({ where: { id: itemId } });
    res.status(204).send();
  }),
);

// ---------- EXPENSES ----------
contentRouter.get(
  '/:tripId/expenses',
  asyncHandler(async (req, res) => {
    const { tripId } = req.params;
    await requireTripAccess(req, tripId, 'viewer');
    const expenses = await prisma.expense.findMany({ where: { tripId }, orderBy: { date: 'asc' } });
    res.json({ expenses });
  }),
);

contentRouter.post(
  '/:tripId/expenses',
  asyncHandler(async (req, res) => {
    const { tripId } = req.params;
    const user = getUser(req);
    await requireTripAccess(req, tripId, 'editor');
    requireFields(req, ['description', 'amount']);
    const expense = await prisma.expense.create({
      data: {
        tripId,
        userId: user.id,
        description: req.body.description,
        amount: Number(req.body.amount),
        currency: req.body.currency || 'USD',
        category: req.body.category || 'other',
        date: req.body.date ? new Date(req.body.date) : null,
        placeId: req.body.placeId || null,
      },
    });
    res.status(201).json({ expense });
  }),
);

contentRouter.patch(
  '/:tripId/expenses/:expenseId',
  asyncHandler(async (req, res) => {
    const { tripId, expenseId } = req.params;
    await requireTripAccess(req, tripId, 'editor');
    const expense = await prisma.expense.update({
      where: { id: expenseId },
      data: {
        description: req.body.description,
        amount: req.body.amount !== undefined ? Number(req.body.amount) : undefined,
        currency: req.body.currency,
        category: req.body.category,
        date: req.body.date !== undefined ? (req.body.date ? new Date(req.body.date) : null) : undefined,
      },
    });
    res.json({ expense });
  }),
);

contentRouter.delete(
  '/:tripId/expenses/:expenseId',
  asyncHandler(async (req, res) => {
    const { tripId, expenseId } = req.params;
    await requireTripAccess(req, tripId, 'editor');
    await prisma.expense.delete({ where: { id: expenseId } });
    res.status(204).send();
  }),
);

// ---------- BOOKINGS ----------
contentRouter.get(
  '/:tripId/bookings',
  asyncHandler(async (req, res) => {
    const { tripId } = req.params;
    await requireTripAccess(req, tripId, 'viewer');
    const bookings = await prisma.booking.findMany({ where: { tripId }, orderBy: { startAt: 'asc' } });
    res.json({ bookings });
  }),
);

contentRouter.post(
  '/:tripId/bookings',
  asyncHandler(async (req, res) => {
    const { tripId } = req.params;
    const user = getUser(req);
    await requireTripAccess(req, tripId, 'editor');
    requireFields(req, ['type', 'title']);
    const booking = await prisma.booking.create({
      data: {
        tripId,
        userId: user.id,
        type: req.body.type,
        title: req.body.title,
        provider: req.body.provider,
        reference: req.body.reference,
        startAt: req.body.startAt ? new Date(req.body.startAt) : null,
        endAt: req.body.endAt ? new Date(req.body.endAt) : null,
        details: req.body.details,
      },
    });
    res.status(201).json({ booking });
  }),
);

contentRouter.patch(
  '/:tripId/bookings/:bookingId',
  asyncHandler(async (req, res) => {
    const { tripId, bookingId } = req.params;
    await requireTripAccess(req, tripId, 'editor');
    const booking = await prisma.booking.update({
      where: { id: bookingId },
      data: {
        type: req.body.type,
        title: req.body.title,
        provider: req.body.provider,
        reference: req.body.reference,
        startAt: req.body.startAt !== undefined ? (req.body.startAt ? new Date(req.body.startAt) : null) : undefined,
        endAt: req.body.endAt !== undefined ? (req.body.endAt ? new Date(req.body.endAt) : null) : undefined,
        details: req.body.details,
      },
    });
    res.json({ booking });
  }),
);

contentRouter.delete(
  '/:tripId/bookings/:bookingId',
  asyncHandler(async (req, res) => {
    const { tripId, bookingId } = req.params;
    await requireTripAccess(req, tripId, 'editor');
    await prisma.booking.delete({ where: { id: bookingId } });
    res.status(204).send();
  }),
);