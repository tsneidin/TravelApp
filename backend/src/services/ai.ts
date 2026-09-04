import { config } from '../config.js';
import { prisma } from '../db.js';
import { fetchSuggestions } from './suggestions.js';
import type { Suggestion } from './suggestions.js';
import { getAiConfig, type AiConfigData } from './settings.service.js';
import { syncBookingToItinerary } from './bookingHelper.js';
import type { BookingType, ExpenseCategory } from '@prisma/client';

const BOOKING_TYPES = ['flight', 'hotel', 'car', 'activity'] as const;
const EXPENSE_CATEGORIES = ['transport', 'lodging', 'food', 'activity', 'shopping', 'entertainment', 'other'] as const;

export interface ToolResult {
  action: string;
  summary: string;
  ok: boolean;
  suggestions?: Suggestion[];
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export const aiConfig = config.ai;

/** Normalize an OpenAI-compatible base URL into the chat-completions endpoint. */
function chatUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  if (/\/chat\/completions$/.test(base)) return base;
  if (/\/v1\/?$/.test(base)) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

interface LlmMessage {
  role: string;
  content?: string;
  tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
  name?: string;
}

interface LlmResponse {
  choices?: {
    message: {
      content?: string | null;
      tool_calls?: { id: string; type: string; function: { name: string; arguments: string } }[];
    };
  }[];
}

async function callLlm(
  messages: LlmMessage[],
  tools: ToolDef[],
  activeConfig: AiConfigData,
): Promise<LlmResponse> {
  const body: Record<string, unknown> = {
    model: activeConfig.model,
    messages,
    temperature: 0.4,
  };
  if (tools.length) body.tools = tools;
  else body.tool_choice = 'none';

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (activeConfig.apiKey) headers.Authorization = `Bearer ${activeConfig.apiKey}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), activeConfig.timeoutMs);
  try {
    const res = await fetch(chatUrl(activeConfig.baseUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`AI endpoint ${res.status}: ${text.slice(0, 300)}`);
    }
    return (await res.json()) as LlmResponse;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------- tools ----------------

interface ToolDef {
  type: 'function';
  function: { name: string; description: string; parameters: unknown };
}

const TOOLS: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'add_place',
      description:
        'Add a place / stop / activity / restaurant / sightseeing spot to a specific day of the itinerary. Use "date" (YYYY-MM-DD) to pick a day; if the trip has no matching day, one is automatically created. Infer and include the most likely address, latitude, longitude, and website whenever the user gives a recognizable place, venue, city, or airport code. Preserve route text such as "MSN to ORD" in the name.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name of the place' },
          date: { type: 'string', description: 'Itinerary date in YYYY-MM-DD format' },
          category: { type: 'string', description: 'e.g. Restaurant, Sightseeing, Activity, Transport, Accommodation' },
          address: { type: 'string', description: 'Full useful address; include whenever known so map focus works' },
          lat: { type: 'number', description: 'Latitude; include whenever known' },
          lng: { type: 'number', description: 'Longitude; include whenever known' },
          website: { type: 'string', description: 'Official or useful source URL for the place; include whenever known' },
          notes: { type: 'string' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_booking',
      description:
        'Add a reservation or booking (flight, hotel, car, activity) to the trip. Automatically parses confirmation codes, extracts flight legs or stay dates into the itinerary, creates missing itinerary days, and logs ticket prices in the trip budget.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: BOOKING_TYPES, description: 'flight | hotel | car | activity' },
          title: { type: 'string', description: 'Human-readable title e.g. "American Airlines Madison to Naples"' },
          provider: { type: 'string', description: 'Airline / hotel chain / rental company' },
          reference: { type: 'string', description: 'Confirmation or PNR number if present' },
          startAt: { type: 'string', description: 'Start ISO datetime or YYYY-MM-DD' },
          endAt: { type: 'string', description: 'Optional end ISO datetime or YYYY-MM-DD' },
          price: { type: 'number', description: 'Confirmed total, amount paid, or ticketed fare only. Do not use estimates, optional charges, points values, or advertised prices.' },
          currency: { type: 'string', description: 'Currency code for the confirmed price, e.g. USD or EUR' },
        },
        required: ['type', 'title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_expense',
      description: 'Add a trip expense (budget item).',
      parameters: {
        type: 'object',
        properties: {
          description: { type: 'string' },
          amount: { type: 'number', description: 'Numerical amount, no currency symbol' },
          currency: { type: 'string', description: 'ISO currency code, default USD' },
          category: { type: 'string', enum: EXPENSE_CATEGORIES },
          date: { type: 'string', description: 'YYYY-MM-DD' },
        },
        required: ['description', 'amount'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_day',
      description: 'Add a new day to the itinerary (used when the user references a date not yet in the plan).',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD' },
          label: { type: 'string', description: 'Optional short label e.g. "Arrival day"' },
        },
        required: ['date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_suggestions',
      description:
        'Fetch structured recommendations (things to do/see/eat, attractions, places) with thumbnails and links for a location. Call this when the user asks for suggestions, ideas, or "things to do/see". The results are also shown to the user as cards in the chat, so prefer calling this over inventing recommendations.',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string', description: 'City / destination, e.g. "Tokyo" or "Rome"' },
          query: { type: 'string', description: 'Optional focus, e.g. "food", "museums", "nature"' },
          count: { type: 'number', description: 'Max suggestions, default 8' },
        },
        required: ['location'],
      },
    },
  },
];

function parseArgs(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function toDate(v: unknown): Date | undefined {
  if (typeof v !== 'string' || !v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function toDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------------- executor ----------------

const suggestionCache = new Map<string, Suggestion[]>();

async function executeTool(
  tripId: string,
  userId: string,
  name: string,
  argsRaw: string,
  ctx: { sourceText?: string; destination?: string } = {},
): Promise<ToolResult> {
  const a = parseArgs(argsRaw);
  try {
    if (name === 'add_place') {
      const nameStr = String(a.name ?? '').trim();
      if (!nameStr) return { action: name, summary: 'add_place: missing name', ok: false };
      let dayId: string | undefined;
      const date = toDate(a.date);
      if (date) {
        const days = await prisma.day.findMany({ where: { tripId }, orderBy: { date: 'asc' } });
        const hit = days.find((d) => toDayKey(d.date) === toDayKey(date));
        if (hit) {
          dayId = hit.id;
        } else {
          const created = await prisma.day.create({
            data: { tripId, date, label: a.label ? String(a.label) : undefined, sortOrder: days.length },
          });
          dayId = created.id;
        }
      }
      const count = await prisma.place.count({ where: { tripId } });
      const notes = [a.notes ? String(a.notes) : undefined]
        .filter(Boolean)
        .join('\n');
      const place = await prisma.place.create({
        data: {
          tripId,
          name: nameStr,
          dayId,
          sortOrder: count,
          category: a.category ? String(a.category) : undefined,
          address: a.address ? String(a.address) : undefined,
          lat: typeof a.lat === 'number' ? a.lat : undefined,
          lng: typeof a.lng === 'number' ? a.lng : undefined,
          website: a.website ? String(a.website) : undefined,
          sourceText: ctx.sourceText,
          notes: notes || undefined,
        },
      });
      const when = dayId ? ` (on ${date ? toDayKey(date) : 'itinerary day'})` : ' (unassigned)';
      return { action: name, summary: `Added place "${nameStr}"${when}`, ok: true, ...{ placeId: place.id } };
    }

    if (name === 'add_booking') {
      const rawType = String(a.type ?? '').toLowerCase();
      const type = BOOKING_TYPES.includes(rawType as BookingType) ? (rawType as BookingType) : null;
      const title = String(a.title ?? '').trim();
      if (!type || !title) return { action: name, summary: 'add_booking: valid type and title required', ok: false };
      const details = ctx.sourceText
        ? { sourceRaw: ctx.sourceText.slice(0, 12_000) }
        : undefined;

      const booking = await prisma.booking.create({
        data: {
          tripId,
          userId,
          type,
          title,
          provider: a.provider ? String(a.provider) : undefined,
          reference: a.reference ? String(a.reference) : undefined,
          startAt: toDate(a.startAt),
          endAt: toDate(a.endAt),
          details,
        },
      });

      // Synchronize booking with itinerary days, places, and budget expense!
      const sync = await syncBookingToItinerary(
        tripId,
        userId,
        booking.id,
        ctx.sourceText || `${title} ${a.provider ?? ''} ${a.reference ?? ''}`,
        title,
        {
          type,
          provider: a.provider ? String(a.provider) : undefined,
          reference: a.reference ? String(a.reference) : undefined,
          startAt: toDate(a.startAt),
          endAt: toDate(a.endAt),
          totalAmount: typeof a.price === 'number' ? a.price : parseFloat(String(a.price ?? '')),
          currency: a.currency ? String(a.currency) : undefined,
        },
      );

      const extras: string[] = [];
      if (sync.daysAdded > 0) extras.push(`${sync.daysAdded} day(s) created`);
      if (sync.placesAdded > 0) extras.push(`${sync.placesAdded} stop(s) added to itinerary`);
      if (sync.expenseAdded) extras.push('expense logged in budget');

      const extraSummary = extras.length > 0 ? ` (${extras.join(', ')})` : '';

      return {
        action: name,
        summary: `Added ${type} booking "${title}"${booking.reference ? ` (ref ${booking.reference})` : ''}${extraSummary}`,
        ok: true,
        ...{ bookingId: booking.id },
      };
    }

    if (name === 'add_expense') {
      const desc = String(a.description ?? '').trim();
      const amount = typeof a.amount === 'number' ? a.amount : parseFloat(String(a.amount ?? ''));
      if (!desc || !Number.isFinite(amount)) return { action: name, summary: 'add_expense: description and amount required', ok: false };
      const cat = String(a.category ?? 'other').toLowerCase();
      const category: ExpenseCategory = EXPENSE_CATEGORIES.includes(cat as ExpenseCategory) ? (cat as ExpenseCategory) : 'other';
      const expense = await prisma.expense.create({
        data: {
          tripId,
          userId,
          description: desc,
          amount,
          currency: a.currency ? String(a.currency).toUpperCase() : 'USD',
          category,
          date: toDate(a.date),
        },
      });
      return { action: name, summary: `Added expense "${desc}" ${amount} ${expense.currency}`, ok: true, ...{ expenseId: expense.id } };
    }

    if (name === 'add_day') {
      const date = toDate(a.date);
      if (!date) return { action: name, summary: 'add_day: valid date required', ok: false };
      const count = await prisma.day.count({ where: { tripId } });
      const day = await prisma.day.create({
        data: { tripId, date, label: a.label ? String(a.label) : undefined, sortOrder: count },
      });
      return { action: name, summary: `Added itinerary day ${toDayKey(date)}`, ok: true, ...{ dayId: day.id } };
    }

    if (name === 'get_suggestions') {
      const location = String(a.location ?? ctx.destination ?? '').trim();
      if (!location) return { action: name, summary: 'get_suggestions: location required', ok: false };
      const focus = String(a.query ?? '').trim();
      const count = Math.min(Number(a.count) || 8, 12);
      const query = focus ? `${location} ${focus}` : `${location} things to see top attractions`;
      let suggestions = suggestionCache.get(query);
      if (!suggestions) {
        suggestions = await fetchSuggestions(query, count);
        suggestionCache.set(query, suggestions);
      }
      if (!suggestions.length) {
        return { action: name, summary: `No suggestions found for "${query}"`, ok: false };
      }
      return {
        action: name,
        summary: `Found ${suggestions.length} suggestions for "${query}"`,
        ok: true,
        suggestions,
      };
    }

    return { action: name, summary: `Unknown tool: ${name}`, ok: false };
  } catch (e) {
    console.error('[ai] tool failed', name, e);
    return { action: name, summary: `Tool ${name} failed: ${(e as Error).message}`, ok: false };
  }
}

// ---------------- context / prompt ----------------

async function buildSystemPrompt(tripId: string): Promise<string> {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: {
      days: { orderBy: { date: 'asc' }, include: { places: { orderBy: { sortOrder: 'asc' } } } },
      bookings: { orderBy: { startAt: 'asc' } },
      expenses: true,
      packing: true,
    },
  });
  if (!trip) return "You are TravelApp's assistant. (Trip not found.)";

  const daysDesc = (trip.days ?? [])
    .map((d) => {
      const places = d.places.map((p, i) => `  ${i + 1}. ${p.name}${p.category ? ` (${p.category})` : ''}`).join('\n');
      return `- ${toDayKey(d.date)}${d.label ? ` — ${d.label}` : ''}\n${places || '  (nothing planned)'}`;
    })
    .join('\n');

  const orphanPlaces = await prisma.place.findMany({ where: { tripId, dayId: null } });
  const bookingsDesc = (trip.bookings ?? [])
    .map((b) => `- ${b.type}: ${b.title}${b.provider ? ` (${b.provider})` : ''}${b.startAt ? ` @ ${toDayKey(b.startAt)}` : ''}${b.reference ? ` ref=${b.reference}` : ''}`)
    .join('\n');

  return [
    `You are the AI travel assistant embedded in TravelApp, a self-hosted trip planner.`,
    `CURRENT TRIP: "${trip.name}" (destination: ${trip.destination || 'unknown'}, currency: ${trip.currency}).`,
    ``,
    `ITINERARY:`,
    daysDesc || '  (no days yet)',
    `\nPLACES NOT YET ASSIGNED TO A DAY:`,
    orphanPlaces.map((p) => `- ${p.name}`).join('\n') || '  (none)',
    `\nBOOKINGS:`,
    bookingsDesc || '  (none)',
    `\nEXPENSES: ${trip.expenses?.length ?? 0} recorded (total ${(trip.expenses ?? []).reduce((s, e) => s + e.amount, 0).toFixed(2)} ${trip.currency}).`,
    ``,
    `RULES:`,
    `- When the user pastes or mentions a reservation confirmation (flights, hotel, car, activity):`,
    `  1. Call add_booking with the reservation details, reference number, dates, and total fare/price. This automatically logs the booking, generates all missing itinerary days, places each flight leg or stay into the itinerary on the proper days, and adds the cost to the budget!`,
    `  2. Call add_place if additional custom activities or notes need to be added to specific days.`,
    `  3. Confirm the reservation reference, itinerary days created, and flight legs added in your response.`,
    `- For "things to do / places to see / suggestions", answer with concise, specific recommendations relevant to the destination and trip dates. Use bullet points.`,
    `- GUESS the date from trip context when sensible; if genuinely ambiguous, ask a short clarifying question instead of inventing a date.`,
    `- Keep answers under ~150 words unless generating a list of suggestions.`,
  ].join('\n');
}

// ---------------- main entry ----------------

const SUGGEST_INTENT =
  /(suggest|recommend|things? to do|places? to see|what (should|can|could|to) (i|we|you)\s?(do|see|visit|check out)|attractions|top sites|must-see|must see|best places?|ideas|itinerary ideas|where should)/i;

function detectSuggestQuery(message: string, destination: string): string | null {
  if (!SUGGEST_INTENT.test(message)) return null;
  const stop = new Set([
    'please', 'suggest', 'suggestions', 'recommend', 'recommendations', 'things', 'thing',
    'places', 'place', 'see', 'do', 'visit', 'what', 'should', 'could', 'can', 'for', 'any',
    'good', 'best', 'top', 'with', 'in', 'and', 'the', 'a', 'of', 'to', 'i', 'we', 'me',
    'us', 'that', 'this', 'itinerary', 'ideas', 'day', 'there', 'around', 'near',
  ]);
  const words = (message.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (w) => w.length > 3 && !stop.has(w),
  );
  const focus = words.slice(0, 4).join(' ');
  if (destination) return focus ? `${destination} ${focus}` : destination;
  return focus || (message.length > 4 ? message : null);
}

export async function processTripChat(
  tripId: string,
  userId: string,
  userMessage: string,
  history: ChatTurn[],
): Promise<{ reply: string; actions: ToolResult[] }> {
  const activeConfig = await getAiConfig();
  if (!activeConfig.enabled) {
    return {
      reply: 'AI Assist is not enabled yet. Open the ⚙️ Settings icon in the header to configure your AI provider, model, and API key.',
      actions: [],
    };
  }

  const trip = await prisma.trip.findUnique({ where: { id: tripId }, select: { destination: true } });
  const destination = trip?.destination ?? '';

  const system = await buildSystemPrompt(tripId);
  let userContent = userMessage;

  // If the user is asking for recommendations, pre-fetch suggestions so they
  // always appear as cards (even if the model doesn't call the tool itself).
  let autoSuggest: ToolResult | null = null;
  const suggestQuery = detectSuggestQuery(userMessage, destination);
  if (suggestQuery) {
    let suggestions = suggestionCache.get(suggestQuery);
    if (!suggestions) {
      suggestions = await fetchSuggestions(suggestQuery, 8);
      suggestionCache.set(suggestQuery, suggestions);
    }
    if (suggestions.length) {
      autoSuggest = {
        action: 'get_suggestions',
        summary: `Found ${suggestions.length} suggestions for "${suggestQuery}"`,
        ok: true,
        suggestions,
      };
      userContent +=
        `\n\n[Found recommendations for context. Present these and offer to add them when the user picks one:\n` +
        suggestions
          .slice(0, 8)
          .map((s) => `- ${s.title}${s.summary ? `: ${s.summary.slice(0, 120)}` : ''}`)
          .join('\n') +
        `]`;
    }
  }

  const messages: LlmMessage[] = [{ role: 'system', content: system }];
  for (const h of history.slice(-10)) messages.push({ role: h.role, content: h.content });
  messages.push({ role: 'user', content: userContent });

  const actions: ToolResult[] = [];
  let loop = 0;
  const toolContext = { sourceText: userMessage, destination };

  for (; loop < 6; loop++) {
    const res = await callLlm(messages, TOOLS, activeConfig);
    const msg = res.choices?.[0]?.message;
    if (!msg) throw new Error('AI returned no choices');

    const toolCalls = msg.tool_calls ?? [];
    if (!toolCalls.length) {
      const reply = msg.content?.trim() || 'Done.';
      if (autoSuggest && !actions.some((a) => a.action === 'get_suggestions')) {
        actions.push(autoSuggest);
      }
      return { reply, actions };
    }

    messages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: toolCalls });
    for (const tc of toolCalls) {
      const fnName = tc.function?.name ?? '';
      const result = await executeTool(tripId, userId, fnName, tc.function?.arguments ?? '{}', toolContext);
      actions.push(result);
      messages.push({ role: 'tool', tool_call_id: tc.id, name: fnName, content: result.summary });
    }
  }

  const res = await callLlm(messages, [], activeConfig);
  const reply = res.choices?.[0]?.message?.content?.trim() || 'Finished.';
  if (autoSuggest && !actions.some((a) => a.action === 'get_suggestions')) {
    actions.push(autoSuggest);
  }
  return { reply, actions };
}