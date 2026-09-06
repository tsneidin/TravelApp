import { Router } from 'express';
import { asyncHandler, badRequest, notFound, forbidden } from '../lib/errors.js';
import { prisma } from '../db.js';
import { getUser, requireTripAccess, requireFields } from '../middleware/auth.js';
import { syncBookingToItinerary } from '../services/bookingHelper.js';
import { reconcileTripDays, isGenericDayLabel } from '../services/dayReconciliation.js';
import { inferCategoryFromText } from '../services/ai.js';
import { calculateTripSettlement, type MemberInfo } from '../services/expenseSplitting.js';
import type { MemberRole } from '@prisma/client';

const ROLES: MemberRole[] = ['owner', 'editor', 'viewer'];

export const tripsRouter = Router();

// ---------- helpers ----------
async function loadTrip(tripId: string) {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: {
      owner: { select: { id: true, name: true, email: true, avatarUrl: true } },
      members: {
        include: {
          user: { select: { id: true, email: true, name: true, avatarUrl: true } },
        },
      },
      days: { orderBy: { date: 'asc' }, include: { places: { orderBy: { sortOrder: 'asc' } } } },
      places: true,
      bookings: true,
      expenses: {
        orderBy: { date: 'asc' },
        include: {
          paidBy: { select: { id: true, name: true, email: true, avatarUrl: true } },
        },
      },
      packing: { orderBy: { sortOrder: 'asc' } },
      journal: { orderBy: { date: 'asc' } },
      photos: true,
      imports: { orderBy: { createdAt: 'desc' } },
      mapViews: { orderBy: { createdAt: 'asc' } },
      todos: { orderBy: [{ done: 'asc' }, { dueDate: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }] },
    },
  });
  if (!trip) throw notFound('Trip not found');

  // Collect all unique user IDs for audit lookup
  const userIds = new Set<string>();
  if (trip.ownerId) userIds.add(trip.ownerId);
  trip.members.forEach((m) => userIds.add(m.userId));
  trip.places.forEach((p) => {
    if (p.createdById) userIds.add(p.createdById);
    if (p.updatedById) userIds.add(p.updatedById);
  });
  trip.bookings.forEach((b) => {
    if (b.createdById) userIds.add(b.createdById);
    if (b.updatedById) userIds.add(b.updatedById);
  });
  trip.expenses.forEach((e) => {
    if (e.createdById) userIds.add(e.createdById);
    if (e.updatedById) userIds.add(e.updatedById);
    if (e.paidById) userIds.add(e.paidById);
  });
  trip.todos.forEach((t) => {
    if (t.createdById) userIds.add(t.createdById);
    if (t.updatedById) userIds.add(t.updatedById);
  });
  trip.journal.forEach((j) => {
    if (j.createdById) userIds.add(j.createdById);
    if (j.userId) userIds.add(j.userId);
  });
  trip.photos.forEach((p) => {
    if (p.createdById) userIds.add(p.createdById);
    if (p.userId) userIds.add(p.userId);
  });

  const users = await prisma.user.findMany({
    where: { id: { in: Array.from(userIds) } },
    select: { id: true, name: true, email: true, avatarUrl: true },
  });
  const userMap = new Map<string, { id: string; name: string; email: string; avatarUrl: string | null }>();
  users.forEach((u) => userMap.set(u.id, u));

  const attachAudit = <T extends { createdById?: string | null; updatedById?: string | null; userId?: string | null }>(
    item: T,
  ) => {
    const creatorId = item.createdById || item.userId;
    const updaterId = item.updatedById;
    return {
      ...item,
      createdBy: creatorId ? userMap.get(creatorId) ?? null : null,
      updatedBy: updaterId ? userMap.get(updaterId) ?? null : null,
    };
  };

  return {
    ...trip,
    places: trip.places.map(attachAudit),
    days: trip.days.map((d) => ({
      ...attachAudit(d),
      places: d.places.map(attachAudit),
    })),
    bookings: trip.bookings.map(attachAudit),
    expenses: trip.expenses.map((e) => ({
      ...attachAudit(e),
      paidBy: e.paidById ? userMap.get(e.paidById) ?? e.paidBy : e.paidBy,
    })),
    todos: trip.todos.map(attachAudit),
    packing: trip.packing.map(attachAudit),
    journal: trip.journal.map(attachAudit),
    photos: trip.photos.map((photo) => ({
      ...attachAudit(photo),
      url: `/api/uploads/${encodeURIComponent(photo.filename)}`,
    })),
  };
}

function isOwner(trip: { ownerId: string }, userId: string) {
  return trip.ownerId === userId;
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
      select: { id: true },
    });
    for (const trip of datedTrips) {
      await reconcileTripDays(trip.id);
    }

    const trips = await prisma.trip.findMany({
      where,
      include: {
        owner: { select: { id: true, name: true, email: true, avatarUrl: true } },
        members: { include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } } },
        days: { orderBy: { date: 'asc' }, include: { places: { orderBy: { sortOrder: 'asc' } } } },
        mapViews: { orderBy: { createdAt: 'asc' } },
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
    const created = await prisma.trip.create({
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
    await reconcileTripDays(created.id);
    res.status(201).json({ trip: created });
  }),
);

tripsRouter.get(
  '/:tripId',
  asyncHandler(async (req, res) => {
    const { tripId } = req.params;
    await requireTripAccess(req, tripId, 'viewer');
    await reconcileTripDays(tripId);

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
      return saved;
    });
    await reconcileTripDays(tripId);
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
      include: {
        user: { select: { id: true, email: true, name: true, avatarUrl: true } },
      },
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
      include: {
        user: { select: { id: true, email: true, name: true, avatarUrl: true } },
      },
    });
    res.json({ member });
  }),
);

tripsRouter.delete(
  '/:tripId/members/:userId',
  asyncHandler(async (req, res) => {
    const { tripId, userId } = req.params;
    const user = getUser(req);
    const trip = await prisma.trip.findUnique({ where: { id: tripId } });
    if (!trip) throw notFound('Trip not found');
    const isTripOwner = trip.ownerId === user.id;
    const isSelfLeaving = userId === user.id;
    if (!isTripOwner && !user.isAdmin && !isSelfLeaving) {
      throw forbidden('Only the trip owner can remove members, or a member can remove themselves');
    }
    await prisma.tripMember.deleteMany({ where: { tripId, userId } });
    res.status(204).send();
  }),
);

// ---------- settlement & cost splitting ----------
tripsRouter.get(
  '/:tripId/expenses/settlement',
  asyncHandler(async (req, res) => {
    const { tripId } = req.params;
    await requireTripAccess(req, tripId, 'viewer');
    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      include: {
        owner: { select: { id: true, name: true, email: true, avatarUrl: true } },
        members: { include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } } },
        expenses: true,
      },
    });
    if (!trip) throw notFound('Trip not found');

    const memberList: MemberInfo[] = [
      {
        id: trip.owner.id,
        name: trip.owner.name,
        email: trip.owner.email,
        avatarUrl: trip.owner.avatarUrl,
      },
      ...trip.members.map((m) => ({
        id: m.user.id,
        name: m.user.name,
        email: m.user.email,
        avatarUrl: m.user.avatarUrl,
      })),
    ];

    const settlement = calculateTripSettlement(trip.expenses, memberList, trip.currency);
    res.json(settlement);
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
    const user = getUser(req);
    await requireTripAccess(req, tripId, 'editor');
    requireFields(req, ['date']);
    const date = new Date(req.body.date);
    const rawLabel = typeof req.body.label === 'string' ? req.body.label.trim() : undefined;
    const label = rawLabel && !isGenericDayLabel(rawLabel) ? rawLabel : undefined;
    const sortOrder = req.body.sortOrder ?? (await prisma.day.count({ where: { tripId } }));
    const day = await prisma.day.create({
      data: {
        tripId,
        date,
        label,
        sortOrder,
        createdById: user.id,
      },
    });
    await reconcileTripDays(tripId);
    res.status(201).json({ day });
  }),
);

tripsRouter.patch(
  '/:tripId/days/:dayId',
  asyncHandler(async (req, res) => {
    const { tripId, dayId } = req.params;
    const user = getUser(req);
    await requireTripAccess(req, tripId, 'editor');
    const data: Record<string, unknown> = {
      updatedById: user.id,
    };
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
    const user = getUser(req);
    await requireTripAccess(req, tripId, 'editor');
    requireFields(req, ['name']);
    const count = await prisma.place.count({ where: { tripId } });
    const rawCategory = typeof req.body.category === 'string' ? req.body.category.trim() : '';
    const category = rawCategory || inferCategoryFromText([req.body.name, req.body.address, req.body.description, req.body.notes].filter(Boolean).join(' '));

    const place = await prisma.place.create({
      data: {
        tripId,
        createdById: user.id,
        name: req.body.name,
        category,
        address: req.body.address,
        lat: req.body.lat,
        lng: req.body.lng,
        description: req.body.description,
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

tripsRouter.post(
  '/:tripId/places/bulk',
  asyncHandler(async (req, res) => {
    const { tripId } = req.params;
    const user = getUser(req);
    await requireTripAccess(req, tripId, 'editor');

    if (Array.isArray(req.body.dayIds) && req.body.dayIds.length > 0) {
      requireFields(req, ['name']);
      const dayIds: string[] = req.body.dayIds;
      const rawCategory = typeof req.body.category === 'string' ? req.body.category.trim() : '';
      const category = rawCategory || inferCategoryFromText([req.body.name, req.body.address, req.body.description, req.body.notes].filter(Boolean).join(' '));

      const createdPlaces = await prisma.$transaction(async (tx) => {
        const results = [];
        for (const dId of dayIds) {
          const effectiveDayId = dId === 'unassigned' ? null : dId;
          const count = await tx.place.count({ where: { tripId, dayId: effectiveDayId } });
          const created = await tx.place.create({
            data: {
              tripId,
              createdById: user.id,
              name: req.body.name,
              category,
              address: req.body.address,
              lat: req.body.lat,
              lng: req.body.lng,
              description: req.body.description,
              website: req.body.website,
              sourceText: req.body.sourceText,
              notes: req.body.notes,
              dayId: effectiveDayId,
              sortOrder: count,
              startTime: req.body.startTime ? new Date(req.body.startTime) : undefined,
              endTime: req.body.endTime ? new Date(req.body.endTime) : undefined,
            },
          });
          results.push(created);
        }
        return results;
      });

      res.status(201).json({ places: createdPlaces });
      return;
    }

    if (Array.isArray(req.body.places) && req.body.places.length > 0) {
      const placesInput = req.body.places;
      const createdPlaces = await prisma.$transaction(async (tx) => {
        const results = [];
        for (const p of placesInput) {
          const rawCategory = typeof p.category === 'string' ? p.category.trim() : '';
          const category = rawCategory || inferCategoryFromText([p.name, p.address, p.description, p.notes].filter(Boolean).join(' '));
          const effectiveDayId = p.dayId === 'unassigned' ? null : p.dayId;
          const count = await tx.place.count({ where: { tripId, dayId: effectiveDayId } });
          const created = await tx.place.create({
            data: {
              tripId,
              createdById: user.id,
              name: p.name,
              category,
              address: p.address,
              lat: p.lat,
              lng: p.lng,
              description: p.description,
              website: p.website,
              sourceText: p.sourceText,
              notes: p.notes,
              dayId: effectiveDayId,
              sortOrder: p.sortOrder ?? count,
              startTime: p.startTime ? new Date(p.startTime) : undefined,
              endTime: p.endTime ? new Date(p.endTime) : undefined,
            },
          });
          results.push(created);
        }
        return results;
      });
      res.status(201).json({ places: createdPlaces });
      return;
    }

    throw badRequest('Either dayIds array or places array must be provided');
  }),
);

tripsRouter.post(
  '/:tripId/places/bulk-delete',
  asyncHandler(async (req, res) => {
    const { tripId } = req.params;
    await requireTripAccess(req, tripId, 'editor');
    const placeIds = req.body.placeIds;
    if (!Array.isArray(placeIds) || placeIds.length === 0) {
      throw badRequest('placeIds array is required');
    }
    await prisma.place.deleteMany({
      where: {
        id: { in: placeIds },
        tripId,
      },
    });
    res.status(204).send();
  }),
);

tripsRouter.patch(
  '/:tripId/places/:placeId',
  asyncHandler(async (req, res) => {
    const { tripId, placeId } = req.params;
    const user = getUser(req);
    await requireTripAccess(req, tripId, 'editor');
    const allowed = ['name', 'category', 'address', 'lat', 'lng', 'website', 'description', 'notes', 'dayId', 'sortOrder', 'includeInCalendar'];
    const data: Record<string, unknown> = {
      updatedById: user.id,
    };
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

// ---------- map views ----------
tripsRouter.get(
  '/:tripId/map-views',
  asyncHandler(async (req, res) => {
    const { tripId } = req.params;
    await requireTripAccess(req, tripId, 'viewer');
    const mapViews = await prisma.mapView.findMany({
      where: { tripId },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ mapViews });
  }),
);

tripsRouter.post(
  '/:tripId/map-views',
  asyncHandler(async (req, res) => {
    const { tripId } = req.params;
    await requireTripAccess(req, tripId, 'editor');
    requireFields(req, ['name', 'lat', 'lng', 'zoom']);
    const name = String(req.body.name).trim();
    if (!name) throw badRequest('View name is required');

    const mapView = await prisma.mapView.create({
      data: {
        tripId,
        name,
        lat: Number(req.body.lat),
        lng: Number(req.body.lng),
        zoom: Number(req.body.zoom),
        origin: req.body.origin ? String(req.body.origin).trim() : null,
        destination: req.body.destination ? String(req.body.destination).trim() : null,
        travelMode: req.body.travelMode ? String(req.body.travelMode).trim() : null,
        showTransit: req.body.showTransit === true,
      },
    });
    res.status(201).json({ mapView });
  }),
);

tripsRouter.patch(
  '/:tripId/map-views/:viewId',
  asyncHandler(async (req, res) => {
    const { tripId, viewId } = req.params;
    await requireTripAccess(req, tripId, 'editor');
    const data: Record<string, unknown> = {};
    if (typeof req.body.name === 'string') data.name = req.body.name.trim();
    if (typeof req.body.lat === 'number') data.lat = req.body.lat;
    if (typeof req.body.lng === 'number') data.lng = req.body.lng;
    if (typeof req.body.zoom === 'number') data.zoom = req.body.zoom;
    if (typeof req.body.origin === 'string') data.origin = req.body.origin.trim();
    if (req.body.origin === null) data.origin = null;
    if (typeof req.body.destination === 'string') data.destination = req.body.destination.trim();
    if (req.body.destination === null) data.destination = null;
    if (typeof req.body.travelMode === 'string') data.travelMode = req.body.travelMode.trim();
    if (req.body.travelMode === null) data.travelMode = null;
    if (typeof req.body.showTransit === 'boolean') data.showTransit = req.body.showTransit;

    const mapView = await prisma.mapView.update({
      where: { id: viewId },
      data,
    });
    res.json({ mapView });
  }),
);

tripsRouter.delete(
  '/:tripId/map-views/:viewId',
  asyncHandler(async (req, res) => {
    const { tripId, viewId } = req.params;
    await requireTripAccess(req, tripId, 'editor');
    await prisma.mapView.delete({ where: { id: viewId } });
    res.status(204).send();
  }),
);

// ---------- to-dos / tasks ----------
tripsRouter.get(
  '/:tripId/todos',
  asyncHandler(async (req, res) => {
    const { tripId } = req.params;
    await requireTripAccess(req, tripId, 'viewer');
    const todos = await prisma.todoItem.findMany({
      where: { tripId },
      orderBy: [{ done: 'asc' }, { dueDate: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    res.json({ todos });
  }),
);

tripsRouter.post(
  '/:tripId/todos',
  asyncHandler(async (req, res) => {
    const { tripId } = req.params;
    const user = getUser(req);
    await requireTripAccess(req, tripId, 'editor');
    requireFields(req, ['title']);
    const title = String(req.body.title).trim();
    if (!title) throw badRequest('Todo title is required');

    const count = await prisma.todoItem.count({ where: { tripId } });
    const todo = await prisma.todoItem.create({
      data: {
        tripId,
        title,
        notes: req.body.notes ? String(req.body.notes).trim() : null,
        dueDate: req.body.dueDate ? new Date(req.body.dueDate) : null,
        category: req.body.category ? String(req.body.category).trim() : 'Pre-Trip',
        sortOrder: count,
        createdById: user.id,
      },
    });
    res.status(201).json({ todo });
  }),
);

tripsRouter.patch(
  '/:tripId/todos/:todoId',
  asyncHandler(async (req, res) => {
    const { tripId, todoId } = req.params;
    const user = getUser(req);
    await requireTripAccess(req, tripId, 'editor');
    const data: Record<string, unknown> = {
      updatedById: user.id,
    };
    if (typeof req.body.title === 'string') data.title = req.body.title.trim();
    if (typeof req.body.notes === 'string') data.notes = req.body.notes.trim();
    if (req.body.notes === null) data.notes = null;
    if (typeof req.body.category === 'string') data.category = req.body.category.trim();
    if (req.body.category === null) data.category = 'Pre-Trip';
    if (typeof req.body.done === 'boolean') data.done = req.body.done;
    if (typeof req.body.sortOrder === 'number') data.sortOrder = req.body.sortOrder;
    if (req.body.dueDate !== undefined) {
      data.dueDate = req.body.dueDate ? new Date(req.body.dueDate) : null;
    }

    const todo = await prisma.todoItem.update({
      where: { id: todoId },
      data,
    });
    res.json({ todo });
  }),
);

tripsRouter.delete(
  '/:tripId/todos/:todoId',
  asyncHandler(async (req, res) => {
    const { tripId, todoId } = req.params;
    await requireTripAccess(req, tripId, 'editor');
    await prisma.todoItem.delete({ where: { id: todoId } });
    res.status(204).send();
  }),
);