import { Router } from 'express';
import { asyncHandler } from '../lib/errors.js';
import { prisma } from '../db.js';
import { getUser, requireTripAccess } from '../middleware/auth.js';
import { buildEvents, buildIcs } from '../services/calendar.js';

export const calendarRouter = Router();

calendarRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const u = getUser(req);
    const events = await buildEvents({ userId: u.id });
    res.json({ events });
  }),
);

calendarRouter.get(
  '/ics',
  asyncHandler(async (req, res) => {
    const u = getUser(req);
    const ics = await buildIcs({ userId: u.id });
    res.set('Content-Type', 'text/calendar; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="travelapp.ics"');
    res.send(ics);
  }),
);

// Per-trip calendar items
calendarRouter.get(
  '/trips/:tripId',
  asyncHandler(async (req, res) => {
    const { tripId } = req.params;
    await requireTripAccess(req, tripId, 'viewer');
    const events = await buildEvents({ tripId });
    res.json({ events });
  }),
);

// Per-trip iCal subscription feed (public URL token based on trip id + visibility)
calendarRouter.get(
  '/trips/:tripId/ics',
  asyncHandler(async (req, res) => {
    const { tripId } = req.params;
    await requireTripAccess(req, tripId, 'viewer');
    const trip = await prisma.trip.findUnique({ where: { id: tripId } });
    if (!trip) {
      res.status(404).send();
      return;
    }
    const ics = await buildIcs({ tripId });
    res.set('Content-Type', 'text/calendar; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="trip-${tripId}.ics"`);
    res.send(ics);
  }),
);