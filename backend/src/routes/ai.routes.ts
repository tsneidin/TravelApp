import { Router } from 'express';
import { asyncHandler, badRequest } from '../lib/errors.js';
import { prisma } from '../db.js';
import { getUser, requireTripAccess } from '../middleware/auth.js';
import { processTripChat, suggestTitleAndDescription } from '../services/ai.js';
import { getAiConfig, saveAiConfig, testAiConnection } from '../services/settings.service.js';

export const aiRouter = Router();

aiRouter.get(
  '/:tripId/ai/status',
  asyncHandler(async (req, res) => {
    const { tripId } = req.params;
    await requireTripAccess(req, tripId, 'viewer');
    const cfg = await getAiConfig();
    res.json({
      enabled: cfg.enabled,
      provider: cfg.provider,
      baseUrl: cfg.enabled ? cfg.baseUrl : null,
      model: cfg.enabled ? cfg.model : null,
      configured: cfg.enabled && Boolean(cfg.baseUrl),
    });
  }),
);

aiRouter.get(
  '/:tripId/ai/config',
  asyncHandler(async (req, res) => {
    const { tripId } = req.params;
    await requireTripAccess(req, tripId, 'viewer');
    const cfg = await getAiConfig();
    res.json({
      enabled: cfg.enabled,
      provider: cfg.provider,
      baseUrl: cfg.baseUrl,
      apiKey: cfg.apiKey ? '••••••••' : '',
      hasApiKey: Boolean(cfg.apiKey),
      model: cfg.model,
      timeoutMs: cfg.timeoutMs,
    });
  }),
);

aiRouter.post(
  '/:tripId/ai/config',
  asyncHandler(async (req, res) => {
    const { tripId } = req.params;
    await requireTripAccess(req, tripId, 'editor');

    const update: Record<string, unknown> = {};
    if (req.body.enabled !== undefined) update.enabled = Boolean(req.body.enabled);
    if (typeof req.body.provider === 'string') update.provider = req.body.provider;
    if (typeof req.body.baseUrl === 'string') update.baseUrl = req.body.baseUrl;
    if (typeof req.body.model === 'string') update.model = req.body.model;
    if (typeof req.body.timeoutMs === 'number') update.timeoutMs = req.body.timeoutMs;
    // Only update apiKey if provided and not the masked placeholder
    if (typeof req.body.apiKey === 'string' && req.body.apiKey !== '••••••••') {
      update.apiKey = req.body.apiKey;
    }

    const saved = await saveAiConfig(update);
    res.json({
      ok: true,
      config: {
        enabled: saved.enabled,
        provider: saved.provider,
        baseUrl: saved.baseUrl,
        apiKey: saved.apiKey ? '••••••••' : '',
        hasApiKey: Boolean(saved.apiKey),
        model: saved.model,
        timeoutMs: saved.timeoutMs,
      },
    });
  }),
);

aiRouter.post(
  '/:tripId/ai/test',
  asyncHandler(async (req, res) => {
    const { tripId } = req.params;
    await requireTripAccess(req, tripId, 'viewer');

    const baseUrl = typeof req.body.baseUrl === 'string' ? req.body.baseUrl.trim() : '';
    if (!baseUrl) throw badRequest('baseUrl is required for testing');

    let apiKey = typeof req.body.apiKey === 'string' ? req.body.apiKey : undefined;
    if (apiKey === '••••••••') {
      // Use existing saved API key
      const current = await getAiConfig();
      apiKey = current.apiKey;
    }

    const model = typeof req.body.model === 'string' ? req.body.model : undefined;
    const result = await testAiConnection({ baseUrl, apiKey, model });
    res.json(result);
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

aiRouter.post(
  '/:tripId/ai/suggest-title',
  asyncHandler(async (req, res) => {
    const { tripId } = req.params;
    await requireTripAccess(req, tripId, 'editor');
    const text = typeof req.body.text === 'string' ? req.body.text.trim() : '';
    const category = typeof req.body.category === 'string' ? req.body.category.trim() : undefined;
    if (!text) {
      return res.json({ title: '', description: '' });
    }
    const result = await suggestTitleAndDescription(text, category);
    res.json(result);
  }),
);