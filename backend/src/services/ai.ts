import { config } from '../config.js';
import { prisma } from '../db.js';
import type { BookingType, ExpenseCategory } from '@prisma/client';

const BOOKING_TYPES = ['flight', 'hotel', 'car', 'activity'] as const;
const EXPENSE_CATEGORIES = ['transport', 'lodging', 'food', 'activity', 'shopping', 'entertainment', 'other'] as const;

export interface ToolResult {
  action: string;
  summary: string;
  ok: boolean;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export const aiConfig = config.ai;

/** Normalize an OpenAI-compatible base URL into the chat-completions endpoint. */
function chatUrl(): string {
  const base = config.ai.baseUrl.replace(/\/+$/, '');
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

async function callLlm(messages: LlmMessage[], tools: ToolDef[]): Promise<LlmResponse> {
  const body: Record<string, unknown> = {
    model: config.ai.model,
    messages,
    temperature: 0.4,
  };
  if (tools.length) body.tools = tools;
  else body.tool_choice = 'none';

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.ai.apiKey) headers.Authorization = `Bearer ${config.ai.apiKey}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.ai.timeoutMs);
  try {
    const res = await fetch(chatUrl(), {
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
        'Add a place / stop / activity / restaurant / sightseeing spot to a specific day of the itinerary. Use "date" (YYYY-MM-DD) to pick a day; if the trip has no matching day, one is created.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name of the place' },
          date: { type: 'string', description: 'Itinerary date in YYYY-MM-DD format' },
          category: { type: 'string', description: 'e.g. Restaurant, Sightseeing, Activity, Transport, Accommodation' },
          address: { type: 'string' },
          lat: { type: 'number' },
          lng: { type: 'number' },
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
        'Add a booking (flight, hotel, car, activity) to the trip. Use this when the user pastes a confirmation email or asks to log a reservation. Extract provider, confirmation/reference number, and dates.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: BOOKING_TYPES, description: 'flight | hotel | car | activity' },
          title: { type: 'string', description: 'Human-readable title e.g. "ANA 123 to Tokyo"' },
          provider: { type: 'string', description: 'Airline / hotel chain / rental company' },
          reference: { type: 'string', description: 'Confirmation or PNR number if present' },
          startAt: { type: 'string', description: 'Start ISO datetime or YYYY-MM-DD' },
          endAt: { type: 'string', description: 'Optional end ISO datetime or YYYY-MM-DD' },
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

async function executeTool(tripId: string, userId: string, name: string, argsRaw: string): Promise<ToolResult> {
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
          notes: a.notes ? String(a.notes) : undefined,
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
        },
      });
      return { action: name, summary: `Added ${type} booking "${title}"${booking.reference ? ` (ref ${booking.reference})` : ''}`, ok: true, ...{ bookingId: booking.id } };
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
    `- Use tools to modify the itinerary, bookings, budget, or days when the user asks to add/save/import something.`,
    `- If the user pastes a booking confirmation email, parse it (airline/flight number, hotel + check-in/out, car rental pickup, activity/tour), then call add_booking (and add_place if a specific venue/airport/hotel address is mentioned). Confirm what you added.`,
    `- For "things to do / places to see / suggestions", answer with concise, specific recommendations relevant to the destination and trip dates. Use bullet points.`,
    `- GUESS the date from trip context when sensible; if genuinely ambiguous, ask a short clarifying question instead of inventing a date.`,
    `- Keep answers under ~150 words unless generating a list of suggestions.`,
  ].join('\n');
}

// ---------------- main entry ----------------

export async function processTripChat(
  tripId: string,
  userId: string,
  userMessage: string,
  history: ChatTurn[],
): Promise<{ reply: string; actions: ToolResult[] }> {
  if (!config.ai.enabled) {
    return { reply: 'AI is not enabled yet. Set AI_ENABLED=true and configure AI_BASE_URL/AI_MODEL in the server .env.', actions: [] };
  }

  const system = await buildSystemPrompt(tripId);
  const messages: LlmMessage[] = [{ role: 'system', content: system }];
  for (const h of history.slice(-10)) messages.push({ role: h.role, content: h.content });
  messages.push({ role: 'user', content: userMessage });

  const actions: ToolResult[] = [];
  let loop = 0;

  for (; loop < 6; loop++) {
    const res = await callLlm(messages, TOOLS);
    const msg = res.choices?.[0]?.message;
    if (!msg) throw new Error('AI returned no choices');

    const toolCalls = msg.tool_calls ?? [];
    if (!toolCalls.length) {
      const reply = msg.content?.trim() || 'Done.';
      return { reply, actions };
    }

    messages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: toolCalls });
    for (const tc of toolCalls) {
      const fnName = tc.function?.name ?? '';
      const result = await executeTool(tripId, userId, fnName, tc.function?.arguments ?? '{}');
      actions.push(result);
      messages.push({ role: 'tool', tool_call_id: tc.id, name: fnName, content: result.summary });
    }
  }

  const res = await callLlm(messages, []);
  return { reply: res.choices?.[0]?.message?.content?.trim() || 'Finished.', actions };
}