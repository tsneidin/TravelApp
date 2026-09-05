import { Router } from 'express';
import multer from 'multer';
import { asyncHandler, badRequest } from '../lib/errors.js';
import { prisma } from '../db.js';
import { getUser, requireTripAccess } from '../middleware/auth.js';
import { processTripChat, suggestTitleAndDescription } from '../services/ai.js';
import { getAiConfig, saveAiConfig, testAiConnection } from '../services/settings.service.js';
import { extractDocumentText } from '../services/fileParser.js';
import { TRIP_TOOLS, executeTripTool } from '../services/tripTools.js';

const docUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

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
  '/:tripId/ai/upload-file',
  docUpload.single('file'),
  asyncHandler(async (req, res) => {
    const { tripId } = req.params;
    await requireTripAccess(req, tripId, 'editor');
    if (!req.file) throw badRequest('No file uploaded');

    const document = await extractDocumentText({
      buffer: req.file.buffer,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
    });

    res.json({ ok: true, document });
  }),
);

aiRouter.post(
  '/:tripId/ai/chat',
  asyncHandler(async (req, res) => {
    const { tripId } = req.params;
    const user = getUser(req);
    await requireTripAccess(req, tripId, 'editor');
    let message = typeof req.body.message === 'string' ? req.body.message.trim() : '';
    const attachments = Array.isArray(req.body.attachments)
      ? (req.body.attachments as Array<{ filename: string; fileType: string; size?: number; text?: string; summary?: string }>)
      : [];

    if (!message && !attachments.length) {
      throw badRequest('message or at least one document attachment is required');
    }

    if (!message && attachments.length) {
      message = 'Please analyze the attached travel document and extract any reservations, bookings, flights, hotels, or activities to add to our trip.';
    }

    // Format prompt for LLM including full document content
    let llmPrompt = message;
    for (const att of attachments) {
      const cleanDocText = (att.text || '').trim();
      llmPrompt +=
        `\n\n[Attached Document: "${att.filename}" (${att.fileType || 'file'})]\n` +
        `--- DOCUMENT CONTENT ---\n` +
        `${cleanDocText}\n` +
        `--- END OF DOCUMENT ---`;
    }

    // Format stored user message with badges and collapsible raw text
    let storedContent = message;
    if (attachments.length > 0) {
      const badges = attachments
        .map((a) => `📎 **[${(a.fileType || 'FILE').toUpperCase()}] ${a.filename}**`)
        .join('  \n');
      const rawSections = attachments
        .map(
          (a) =>
            `\n\n<details><summary>View extracted text: ${a.filename}</summary>\n\n${(a.text || '').trim()}\n</details>`,
        )
        .join('\n');
      storedContent = `${badges}\n\n${message}${rawSections}`;
    }

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

    const { reply, actions } = await processTripChat(tripId, user.id, llmPrompt, history);

    await prisma.chatMessage.createMany({
      data: [
        { tripId, userId: user.id, role: 'user', content: storedContent },
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

// ---------------- MCP (Model Context Protocol) JSON-RPC 2.0 ----------------

const mcpHandler = asyncHandler(async (req, res) => {
  const { tripId } = req.params;
  const user = getUser(req);
  await requireTripAccess(req, tripId, 'editor');

  const { id, method, params } = req.body ?? {};

  if (method === 'initialize') {
    return res.json({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        serverInfo: { name: 'travelapp-mcp-server', version: '1.0.0' },
        capabilities: {
          tools: { listChanged: false },
          resources: { subscribe: false, listChanged: false },
        },
      },
    });
  }

  if (method === 'notifications/initialized' || method === 'initialized') {
    return res.json({ jsonrpc: '2.0', id, result: {} });
  }

  if (method === 'tools/list') {
    return res.json({
      jsonrpc: '2.0',
      id,
      result: {
        tools: TRIP_TOOLS.map((t) => ({
          name: t.function.name,
          description: t.function.description,
          inputSchema: t.function.parameters,
        })),
      },
    });
  }

  if (method === 'tools/call') {
    const toolName = String(params?.name ?? '');
    const toolArgs = (params?.arguments as Record<string, unknown>) ?? {};
    const result = await executeTripTool(tripId, user.id, toolName, toolArgs, {
      sourceText: JSON.stringify(toolArgs),
    });

    return res.json({
      jsonrpc: '2.0',
      id,
      result: {
        content: [{ type: 'text', text: result.summary }],
        isError: !result.ok,
        data: result.data,
      },
    });
  }

  if (method === 'resources/list') {
    return res.json({
      jsonrpc: '2.0',
      id,
      result: {
        resources: [
          {
            uri: `trip://${tripId}/overview`,
            name: 'Trip Overview',
            mimeType: 'application/json',
          },
          {
            uri: `trip://${tripId}/itinerary`,
            name: 'Trip Itinerary',
            mimeType: 'text/plain',
          },
        ],
      },
    });
  }

  if (method === 'resources/read') {
    const uri = String(params?.uri ?? '');
    if (uri === `trip://${tripId}/overview`) {
      const overview = await executeTripTool(tripId, user.id, 'get_trip_details', {});
      return res.json({
        jsonrpc: '2.0',
        id,
        result: {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify(overview.data ?? {}, null, 2),
            },
          ],
        },
      });
    }

    if (uri === `trip://${tripId}/itinerary`) {
      const days = await executeTripTool(tripId, user.id, 'list_days', {});
      return res.json({
        jsonrpc: '2.0',
        id,
        result: {
          contents: [
            {
              uri,
              mimeType: 'text/plain',
              text: days.summary,
            },
          ],
        },
      });
    }

    return res.status(404).json({
      jsonrpc: '2.0',
      id,
      error: { code: -32602, message: `Resource not found: ${uri}` },
    });
  }

  return res.status(400).json({
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Method not supported: ${method}` },
  });
});

aiRouter.post('/:tripId/ai/mcp', mcpHandler);
aiRouter.post('/:tripId/mcp', mcpHandler);