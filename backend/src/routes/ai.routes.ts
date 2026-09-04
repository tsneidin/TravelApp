import { Router } from 'express';
import { asyncHandler, badRequest } from '../lib/errors.js';
import { prisma } from '../db.js';
import { getUser, requireTripAccess } from '../middleware/auth.js';
import { config } from '../config.js';
import { processTripChat } from '../services/ai.js';

export const aiRouter = Router();

aiRouter.get(
  '/:tripId/ai/status',
  asyncHandler(async (req, res) => {
    const { tripId } = req.params;
    await requireTripAccess(req, tripId, 'viewer');
    res.json({
      enabled: config.ai.enabled,
      baseUrl: config.ai.enabled ? config.ai.baseUrl : null,
      model: config.ai.enabled ? config.ai.model : null,
      configured: config.ai.enabled,
    });
  }),
);

aiRouter.get(
  '/:tripId/ai/messages',
  asyncHandler(async (req, res) => {
    const { tripId } = req.params;
    await requireTripAccess(req, tripId, 'viewer');
    const messages = await prisma.chatMessage.findMany({
      where: { tripId },
      orderBy: { createdAt: 'asc' },
      take: 100,
      select: { id: true, role: true, content: true, createdAt: true },
    });
    res.json({ messages });
  }),
);

aiRouter.post(
  '/:tripId/ai/chat',
  asyncHandler(async (req, res) => {
    const { tripId } = req.params;
    const user = getUser(req);
    await requireTripAccess(req, tripId, 'editor');
    const message = typeof req.body.message === 'string' ? req.body.message.trim() : '';
    if (!message) throw badRequest('message is required');

    // Load recent history for conversational context.
    const prior = await prisma.chatMessage.findMany({
      where: { tripId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    const history = prior
      .reverse()
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const { reply, actions } = await processTripChat(tripId, user.id, message, history);

    await prisma.chatMessage.createMany({
      data: [
        { tripId, userId: user.id, role: 'user', content: message },
        { tripId, userId: user.id, role: 'assistant', content: reply },
      ],
    });

    res.json({ reply, actions });
  }),
);