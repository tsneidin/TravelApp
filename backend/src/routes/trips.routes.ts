import { Router } from 'express';
import { asyncHandler, badRequest, notFound, forbidden } from '../lib/errors.js';
import { prisma } from '../db.js';
import { getUser, requireTripAccess, requireFields } from '../middleware/auth.js';
import { syncBookingToItinerary } from '../services/bookingHelper.js';
import type { MemberRole, Prisma } from '@prisma/client';

const ROLES: MemberRole[] = ['owner', 'editor', 'viewer'];

export const tripsRouter = Router();

// ---------- helpers ----------
async function loadTrip(tripId: string) {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: {
      owner: true,
      members: { include: { user: { select: { id: true, email: true, name: true } } } },
      days: { orderBy: { date: 'asc' }, include: { places: { orderBy: { sortOrder: 'asc' } } } },
      places: true,
      bookings: true,
      expenses: true,
      packing: { orderBy: { sortOrder: 'asc' } },
      journal: { orderBy: { date: 'asc' } },
      photos: true,
      imports: { orderBy: { createdAt: 'desc' } },
    },
  });
  if (!trip) throw notFound('Trip not found');
  return {
    ...trip,
    photos: trip.photos.map((photo) => ({
      ...photo,
      url: `/api/uploads/${encodeURIComponent(photo.filename)}`,
    })),
  };
}

function isOwner(trip: { ownerId: string }, userId: string) {
  return trip.ownerId === userId;
}

function tripDates(startDate?: Date | null, endDate?: Date | null): Date[] {
  if (!startDate || !endDate) return [];
  const start = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()));
  const end = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate()));
  if (end < start) throw badRequest('End date must be on or after start date');

  const dates: Date[] = [];
  for (const date = new Date(start); date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    dates.push(new Date(date));
  }
  return dates;
}

async function ensureTripDays(
  db: Prisma.TransactionClient,
  tripId: string,
  startDate?: Date | null,
  endDate?: Date | null,
) {
  const dates = tripDates(startDate, endDate);
  if (dates.length === 0) return;

  const existing = await db.day.findMany({ where: { tripId }, select: { date: true } });
  const existingDates = new Set(existing.map((day) => day.date.toISOString().slice(0, 10)));
  const missing = dates
    .map((date, index) => ({ tripId, date, label: `Day ${index + 1}`, sortOrder: index }))
    .filter((day) => !existingDates.has(day.date.toISOString().slice(0, 10)));

  if (missing.length > 0) await db.day.createMany({ data: missing });
}

// ---------- CRUD ----------
tripsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const u = getUser(req);
    const where = u.isAdmin
      ? {}
      : {
          OR: [{ ownerId: u.id }, { members: { some: { userId: u.id } } }],
        };
    const datedTrips = await prisma.trip.findMany({
      where,
      select: { id: true, startDate: true, endDate: true },
    });
    await prisma.$transaction(async (tx) => {
      for (const trip of datedTrips) {
        await ensureTripDays(tx, trip.id, trip.startDate, trip.endDate);
      }
    });

    const trips = await prisma.trip.findMany({
      where,
      include: {
        owner: { select: { id: true, name: true, email: true } },
        days: { orderBy: { date: 'asc' }, include: { places: { orderBy: { sortOrder: 'asc' } } } },
        _count: { select: { places: true, expenses: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
    res.json({ trips });
  }),
);

tripsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const u = getUser(req);
    requireFields(req, ['name']);
    const { name, destination, currency, startDate, endDate, description, coverUrl } = req.body;
    const parsedStart = startDate ? new Date(startDate) : undefined;
    const parsedEnd = endDate ? new Date(endDate) : undefined;
    const trip = await prisma.$transaction(async (tx) => {
      const created = await tx.trip.create({
        data: {
          name,
          destination: destination ?? '',
          currency: currency ?? 'USD',
          startDate: parsedStart,
          endDate: parsedEnd,
          description,
          coverUrl,
          ownerId: u.id,
        },
      });
      await ensureTripDays(tx, created.id, parsedStart, parsedEnd);
      return created;
    });
    res.status(201).json({ trip });
  }),
);

tripsRouter.get(
  '/:tripId',
  asyncHandler(async (req, res) => {
    const { tripId } = req.params;
    await requireTripAccess(req, tripId, 'viewer');
    const datedTrip = await prisma.trip.findUnique({
      where: { id: tripId },
      select: { startDate: true, endDate: true },
    });
    if (datedTrip) {
      await prisma.$transaction((tx) => ensureTripDays(tx, tripId, datedTrip.startDate, datedTrip.endDate));
    }

    // Backfill confirmations imported before booking-to-itinerary synchronization
    // was reliable. The helper performs duplicate checks, so this is idempotent.
    const confirmationBookings = await prisma.booking.findMany({
      where: { tripId },
    });
    for (const booking of confirmationBookings) {
      const details = booking.details && typeof booking.details === 'object' && !Array.isArray(booking.details)
        ? booking.details as Record<string, unknown>
        : {};
      const sourceRaw = typeof details.sourceRaw === 'string' ? details.sourceRaw : '';
      if (!sourceRaw) continue;
      const confirmedPrice = typeof details.confirmedPrice === 'number' ? details.confirmedPrice : undefined;
      const currency = typeof details.currency === 'string' ? details.currency : undefined;
      await syncBookingToItinerary(tripId, booking.userId ?? getUser(req).id, booking.id, sourceRaw, booking.title, {
        type: booking.type,
        provider: booking.provider ?? undefined,
        reference: booking.reference ?? undefined,
        startAt: booking.startAt ?? undefined,
        endAt: booking.endAt ?? undefined,
        totalAmount: confirmedPrice,
        currency,
      });
    }

    res.json({ trip: await loadTrip(tripId) });
  }),
);

tripsRouter.patch(
  '/:tripId',
  asyncHandler(async (req, res) => {
    const { tripId } = req.params;
    const userId = getUser(req).id;
    const trip = await loadTrip(tripId);
    if (!isOwner(trip, userId) && !getUser(req).isAdmin) {
      throw forbidden('Only the owner can edit trip settings');
    }
    const allowed = ['name', 'destination', 'currency', 'startDate', 'endDate', 'description', 'coverUrl'];
    const data: Record<string, unknown> = {};
    for (const k of allowed) {
      if (req.body[k] !== undefined) data[k] = req.body[k];
    }
    if (data.startDate) data.startDate = new Date(data.startDate as string);
    if (data.endDate) data.endDate = new Date(data.endDate as string);
    delete (data as { coverUrl?: unknown }).coverUrl; // reset via multipart endpoint
    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.trip.update({ where: { id: tripId }, data });
      await ensureTripDays(tx, tripId, saved.startDate, saved.endDate);
      return saved;
    });
    res.json({ trip: updated });
  }),
);

tripsRouter.delete(
  '/:tripId',
  asyncHandler(async (req, res) => {
    const { tripId } = req.params;
    const user = getUser(req);
    const trip = await loadTrip(tripId);
    if (!isOwner(trip, user.id) && !user.isAdmin) throw forbidden('Only the owner can delete a trip');
    await prisma.$transaction(async (tx) => {
      await tx.photo.deleteMany({ where: { tripId } });
      await tx.expense.deleteMany({ where: { tripId } });
      await tx.booking.deleteMany({ where: { tripId } });
      await tx.journalEntry.deleteMany({ where: { tripId } });
      await tx.packingItem.deleteMany({ where: { tripId } });
      await tx.emailImport.deleteMany({ where: { tripId } });
      await tx.chatMessage.deleteMany({ where: { tripId } });
      await tx.place.deleteMany({ where: { tripId } });
      await tx.day.deleteMany({ where: { tripId } });
      await tx.tripMember.deleteMany({ where: { tripId } });
      await tx.trip.delete({ where: { id: tripId } });
    });
    res.status(204).send();
  }),
);

// ---------- members ----------
tripsRouter.get(
  '/:tripId/members',
  asyncHandler(async (req, res) => {
    const { tripId } = req.params;
    await requireTripAccess(req, tripId, 'viewer');
    const trip = await loadTrip(tripId);
    res.json({ owner: trip.owner, members: trip.members });
  }),
);

tripsRouter.post(
  '/:tripId/members',
  asyncHandler(async (req, res) => {
    const { tripId } = req.params;
    await requireTripAccess(req, tripId, 'owner');
    requireFields(req, ['email']);
    const target = await prisma.user.findUnique({ where: { email: String(req.body.email).toLowerCase() } });
    if (!target) throw badRequest('No user with that email exists');
    const role: MemberRole = ROLES.includes(req.body.role) ? req.body.role : 'viewer';
    const member = await prisma.tripMember.upsert({
      where: { tripId_userId: { tripId, userId: target.id } },
      update: { role },
      create: { tripId, userId: target.id, role },
    });
    res.status(201).json({ member });
  }),
);

tripsRouter.patch(
  '/:tripId/members/:userId',
  asyncHandler(async (req, res) => {
    const { tripId, userId } = req.params;
    await requireTripAccess(req, tripId, 'owner');
    const role: MemberRole = ROLES.includes(req.body.role) ? req.body.role : 'viewer';
    const member = await prisma.tripMember.upsert({
      where: { tripId_userId: { tripId, userId } },
      update: { role },
      create: { tripId, userId, role },
    });
    res.json({ member });
  }),
);

tripsRouter.delete(
  '/:tripId/members/:userId',
  asyncHandler(async (req, res) => {
    const { tripId, userId } = req.params;
    await requireTripAccess(req, tripId, 'owner');
    await prisma.tripMember.deleteMany({ where: { tripId, userId } });
    res.status(204).send();
  }),
);

// ---------- days ----------
tripsRouter.get(
  '/:tripId/days',
  asyncHandler(async (req, res) => {
    const { tripId } = req.params;
    await requireTripAccess(req, tripId, 'viewer');
    const days = await prisma.day.findMany({
      where: { tripId },
      orderBy: { date: 'asc' },
      include: { places: { orderBy: { sortOrder: 'asc' } } },
    });
    res.json({ days });
  }),
);

tripsRouter.post(
  '/:tripId/days',
  asyncHandler(async (req, res) => {
    const { tripId } = req.params;
    await requireTripAccess(req, tripId, 'editor');
    requireFields(req, ['date']);
    const date = new Date(req.body.date);
    const label = req.body.label || undefined;
    const sortOrder = req.body.sortOrder ?? (await prisma.day.count({ where: { tripId } }));
    const day = await prisma.day.create({ data: { tripId, date, label, sortOrder } });
    res.status(201).json({ day });
  }),
);

tripsRouter.patch(
  '/:tripId/days/:dayId',
  asyncHandler(async (req, res) => {
    const { tripId, dayId } = req.params;
    await requireTripAccess(req, tripId, 'editor');
    const data: Record<string, unknown> = {};
    if (req.body.label !== undefined) data.label = req.body.label;
    if (req.body.notes !== undefined) data.notes = req.body.notes;
    if (req.body.date !== undefined) data.date = new Date(req.body.date);
    const day = await prisma.day.update({ where: { id: dayId }, data });
    res.json({ day });
  }),
);

tripsRouter.delete(
  '/:tripId/days/:dayId',
  asyncHandler(async (req, res) => {
    const { tripId, dayId } = req.params;
    await requireTripAccess(req, tripId, 'editor');
    await prisma.day.delete({ where: { id: dayId } });
    res.status(204).send();
  }),
);

// ---------- places ----------
tripsRouter.get(
  '/:tripId/places',
  asyncHandler(async (req, res) => {
    const { tripId } = req.params;
    await requireTripAccess(req, tripId, 'viewer');
    const places = await prisma.place.findMany({ where: { tripId }, orderBy: { sortOrder: 'asc' } });
    res.json({ places });
  }),
);

tripsRouter.post(
  '/:tripId/places',
  asyncHandler(async (req, res) => {
    const { tripId } = req.params;
    await requireTripAccess(req, tripId, 'editor');
    requireFields(req, ['name']);
    const count = await prisma.place.count({ where: { tripId } });
    const place = await prisma.place.create({
      data: {
        tripId,
        name: req.body.name,
        category: req.body.category,
        address: req.body.address,
        lat: req.body.lat,
        lng: req.body.lng,
        website: req.body.website,
        sourceText: req.body.sourceText,
        notes: req.body.notes,
        dayId: req.body.dayId,
        sortOrder: req.body.sortOrder ?? count,
        startTime: req.body.startTime ? new Date(req.body.startTime) : undefined,
        endTime: req.body.endTime ? new Date(req.body.endTime) : undefined,
      },
    });
    res.status(201).json({ place });
  }),
);

tripsRouter.patch(
  '/:tripId/places/:placeId',
  asyncHandler(async (req, res) => {
    const { tripId, placeId } = req.params;
    await requireTripAccess(req, tripId, 'editor');
    const allowed = ['name', 'category', 'address', 'lat', 'lng', 'website', 'notes', 'dayId', 'sortOrder', 'includeInCalendar'];
    const data: Record<string, unknown> = {};
    for (const k of allowed) if (req.body[k] !== undefined) data[k] = req.body[k];
    if (req.body.startTime !== undefined) data.startTime = req.body.startTime ? new Date(req.body.startTime) : null;
    if (req.body.endTime !== undefined) data.endTime = req.body.endTime ? new Date(req.body.endTime) : null;
    const place = await prisma.place.update({ where: { id: placeId }, data });
    res.json({ place });
  }),
);

tripsRouter.delete(
  '/:tripId/places/:placeId',
  asyncHandler(async (req, res) => {
    const { tripId, placeId } = req.params;
    await requireTripAccess(req, tripId, 'editor');
    await prisma.place.delete({ where: { id: placeId } });
    res.status(204).send();
  }),
);

// ---------- reorder ----------
tripsRouter.post(
  '/:tripId/reorder',
  asyncHandler(async (req, res) => {
    const { tripId } = req.params;
    await requireTripAccess(req, tripId, 'editor');
    const entries = (req.body.entries as { placeId: string; dayId?: string; sortOrder: number }[]) ?? [];
    if (!Array.isArray(entries)) throw badRequest('entries must be an array');
    await prisma.$transaction(
      entries.map((e) =>
        prisma.place.update({
          where: { id: e.placeId },
          data: { sortOrder: e.sortOrder, dayId: e.dayId ?? null },
        }),
      ),
    );
    res.json({ ok: true });
  }),
);