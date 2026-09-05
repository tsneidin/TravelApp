import { config } from '../config.js';
import { prisma } from '../db.js';
import { getAiConfig, type AiConfigData } from './settings.service.js';
import { debugLog } from '../lib/debug.js';
import {
  TRIP_TOOLS,
  executeTripTool,
  type ToolResult,
  type ToolDef,
  cleanFallbackTitleAndDescription,
  toDayKey,
} from './tripTools.js';

export { cleanFallbackTitleAndDescription, type ToolResult };

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

// Tools and tool execution are handled by tripTools.ts

// ---------------- context / prompt ----------------

async function buildSystemPrompt(tripId: string): Promise<string> {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: {
      days: { orderBy: { date: 'asc' }, include: { places: { orderBy: { sortOrder: 'asc' } } } },
      bookings: { orderBy: { startAt: 'asc' } },
      expenses: { orderBy: { date: 'asc' } },
      packing: { orderBy: { sortOrder: 'asc' } },
      journal: { orderBy: { date: 'asc' } },
    },
  });
  if (!trip) return "You are TravelApp's assistant. (Trip not found.)";

  const daysDesc = (trip.days ?? [])
    .map((d, dayIdx) => {
      const places = d.places
        .map((p, i) => {
          const timing = p.startTime
            ? ` @ ${p.startTime.toISOString()}${p.endTime ? `–${p.endTime.toISOString()}` : ''}`
            : '';
          const details = [
            p.category ? `category=${p.category}` : undefined,
            p.address ? `address=${p.address}` : undefined,
            p.website ? `website=${p.website}` : undefined,
            p.notes ? `notes=${p.notes.slice(0, 250)}` : undefined,
          ]
            .filter(Boolean)
            .join('; ');
          return `  ${i + 1}. [id=${p.id}] ${p.name}${timing}${details ? ` (${details})` : ''}`;
        })
        .join('\n');
      return `- Day ${dayIdx + 1} (${toDayKey(d.date)}) [id=${d.id}]${d.label ? ` — ${d.label}` : ''}\n${places || '  (nothing planned)'}`;
    })
    .join('\n');

  const orphanPlaces = await prisma.place.findMany({ where: { tripId, dayId: null } });
  const orphanDesc = orphanPlaces
    .map((p) => `- [id=${p.id}] ${p.name}${p.category ? ` (${p.category})` : ''}${p.address ? ` - ${p.address}` : ''}`)
    .join('\n');

  const bookingsDesc = (trip.bookings ?? [])
    .map(
      (b) =>
        `- [id=${b.id}] ${b.type.toUpperCase()}: "${b.title}"${b.provider ? ` (${b.provider})` : ''}${b.startAt ? ` @ ${toDayKey(b.startAt)}` : ''}${b.reference ? ` ref=${b.reference}` : ''}`,
    )
    .join('\n');

  const totalExpense = (trip.expenses ?? []).reduce((s, e) => s + e.amount, 0);
  const expenseDesc = (trip.expenses ?? [])
    .map(
      (e) =>
        `- [id=${e.id}] "${e.description}": ${e.amount} ${e.currency} (${e.category})${e.date ? ` @ ${toDayKey(e.date)}` : ''}`,
    )
    .join('\n');

  const packingDesc = (trip.packing ?? [])
    .map((p) => `- [${p.done ? 'x' : ' '}] ${p.item}${p.category ? ` (${p.category})` : ''}`)
    .join('\n');

  const journalDesc = (trip.journal ?? [])
    .map((j) => `- [id=${j.id}] "${j.title}"${j.date ? ` (${toDayKey(j.date)})` : ''}`)
    .join('\n');

  return [
    `You are the AI travel assistant embedded in TravelApp, a self-hosted trip planner.`,
    `CURRENT TRIP: "${trip.name}" [id=${trip.id}] (destination: ${trip.destination || 'unknown'}, currency: ${trip.currency}${trip.startDate ? `, from ${toDayKey(trip.startDate)}` : ''}${trip.endDate ? ` to ${toDayKey(trip.endDate)}` : ''}).`,
    ``,
    `ITINERARY:`,
    daysDesc || '  (no days yet)',
    `\nPLACES NOT YET ASSIGNED TO A DAY:`,
    orphanDesc || '  (none)',
    `\nBOOKINGS / RESERVATIONS:`,
    bookingsDesc || '  (none)',
    `\nEXPENSES / BUDGET: ${trip.expenses?.length ?? 0} recorded (total ${totalExpense.toFixed(2)} ${trip.currency}):`,
    expenseDesc || '  (none)',
    `\nPACKING LIST:`,
    packingDesc || '  (none)',
    `\nJOURNAL ENTRIES:`,
    journalDesc || '  (none)',
    ``,
    `RULES & CAPABILITIES:`,
    `- You have FULL authority and capability to READ, WRITE, UPDATE, and DELETE everything about this trip using your tools.`,
    `- When the user instructs you to add, edit, move, or delete any place, day, booking, expense, packing item, or journal entry, execute the appropriate tool IMMEDIATELY and report what was changed clearly and concisely.`,
    `- When updating or deleting, identify the item by its ID (preferred if known) or by its matching title/name.`,
    `- When the user uploads, pastes, or references a reservation confirmation (flight, hotel, rental car, activity):`,
    `  1. Call add_booking with confirmation code, provider, dates, and total confirmed price. This automatically creates missing days, logs flight legs or stays into the itinerary, and adds the cost to the budget!`,
    `  2. Call add_place if additional custom stops or activities are requested.`,
    `- For packing items, use add_packing_item, update_packing_item, or delete_packing_item.`,
    `- When asked for recommendations (things to do, see, eat, explore), call get_suggestions to return interactive discovery cards. Do NOT automatically add recommendations to the itinerary via add_place unless the user explicitly tells you to add them.`,
    `- Keep responses clear, friendly, and concise.`,
  ].join('\n');
}

// ---------------- main entry ----------------

function qualifyTripLocation(location: string, destination: string): string {
  const loc = location.trim();
  const dest = destination.trim();
  if (!loc || !dest) return loc || dest;
  const locLower = loc.toLowerCase();
  const significantDestinationWords = dest.toLowerCase().match(/[a-z]{4,}/g) ?? [];
  if (significantDestinationWords.some((word) => locLower.includes(word))) return loc;
  return `${loc}, ${dest}`;
}

interface RecommendationContext {
  location: string;
  dayId?: string;
  recommendedAt?: string;
  label?: string;
}

async function inferRecommendationContext(
  tripId: string,
  message: string,
  destination: string,
): Promise<RecommendationContext> {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: {
      days: {
        orderBy: { date: 'asc' },
        include: { places: { orderBy: [{ startTime: 'asc' }, { sortOrder: 'asc' }] } },
      },
      bookings: { orderBy: { startAt: 'asc' } },
    },
  });
  const wantsArrival = /(when|after|once).{0,20}(land|arriv)|\bland(?:ing)?\b|\barrival\b/i.test(message);
  if (!trip) return { location: destination };

  const allPlaces = trip.days.flatMap((day) => day.places.map((place) => ({ day, place })));
  const transports = allPlaces.filter(({ place }) =>
    /transport/i.test(place.category ?? '') || /✈|flight|airport|\b[A-Z]{3}\b/.test(place.name),
  );

  if (wantsArrival && transports.length) {
    const destinationWords = destination.toLowerCase().match(/[a-z]{4,}/g) ?? [];
    const timedTransports = transports
      .filter(({ place }) => place.startTime || place.endTime)
      .sort((a, b) => {
        const aTime = (a.place.startTime ?? a.place.endTime)?.getTime() ?? 0;
        const bTime = (b.place.startTime ?? b.place.endTime)?.getTime() ?? 0;
        return aTime - bTime;
      });
    let outboundArrival = timedTransports[0];
    for (let i = 0; i < timedTransports.length; i++) {
      outboundArrival = timedTransports[i];
      const currentEnd = timedTransports[i].place.endTime ?? timedTransports[i].place.startTime;
      const nextStart = timedTransports[i + 1]?.place.startTime ?? timedTransports[i + 1]?.place.endTime;
      if (currentEnd && nextStart && nextStart.getTime() - currentEnd.getTime() > 24 * 60 * 60 * 1000) break;
    }
    const destinationLeg =
      transports.find(({ place }) => destinationWords.some((word) => place.name.toLowerCase().includes(word))) ??
      outboundArrival ??
      transports[0];
    const arrival = destinationLeg.place.endTime ?? destinationLeg.place.startTime ?? destinationLeg.day.date;
    const routeDestination = /(?:→|\bto\b)\s*([^()]+?)(?:\s*\(([A-Z]{3})\))?$/i.exec(destinationLeg.place.name);
    const location = routeDestination
      ? `${routeDestination[1].trim()} ${routeDestination[2] ?? ''}`.trim()
      : destinationLeg.place.address || destination;
    return {
      location,
      dayId: destinationLeg.day.id,
      recommendedAt: arrival.toISOString(),
      label: `${location} after arrival on ${arrival.toLocaleString()}`,
    };
  }

  const datedPlace = allPlaces.find(({ place }) => place.startTime != null);
  if (datedPlace) {
    const at = datedPlace.place.startTime ?? datedPlace.day.date;
    return {
      location: datedPlace.place.address || destination,
      dayId: datedPlace.day.id,
      recommendedAt: at.toISOString(),
      label: `${datedPlace.place.address || destination} on ${at.toLocaleDateString()}`,
    };
  }

  return {
    location: destination,
    dayId: trip.days[0]?.id,
    recommendedAt: trip.days[0]?.date.toISOString(),
    label: destination || undefined,
  };
}

export async function processTripChat(
  tripId: string,
  userId: string,
  userMessage: string,
  history: ChatTurn[],
): Promise<{ reply: string; actions: ToolResult[] }> {
  const activeConfig = await getAiConfig();
  debugLog('ai', 'chat_start', { tripId, historyTurns: history.length, messageLength: userMessage.length });
  if (!activeConfig.enabled) {
    return {
      reply: 'AI Assist is not enabled yet. Open the ⚙️ Settings icon in the header to configure your AI provider, model, and API key.',
      actions: [],
    };
  }

  const trip = await prisma.trip.findUnique({ where: { id: tripId }, select: { destination: true } });
  const destination = trip?.destination ?? '';
  let recommendationContext = await inferRecommendationContext(tripId, userMessage, destination);
  recommendationContext = {
    ...recommendationContext,
    location: qualifyTripLocation(recommendationContext.location, destination),
  };
  const explicitLocation = /(?:close to|near|nearby|around|in)\s+([^?.!]+)$/i.exec(userMessage)?.[1]?.trim();
  if (explicitLocation) {
    recommendationContext = {
      ...recommendationContext,
      location: qualifyTripLocation(explicitLocation, destination),
      label: recommendationContext.recommendedAt
        ? `${qualifyTripLocation(explicitLocation, destination)} around ${new Date(recommendationContext.recommendedAt).toLocaleString()}`
        : qualifyTripLocation(explicitLocation, destination),
    };
  }

  const system = await buildSystemPrompt(tripId);
  const userContent = userMessage;

  const messages: LlmMessage[] = [{ role: 'system', content: system }];
  for (const h of history.slice(-10)) messages.push({ role: h.role, content: h.content });
  messages.push({ role: 'user', content: userContent });

  const actions: ToolResult[] = [];
  let loop = 0;
  const toolContext = {
    sourceText: userMessage,
    destination,
    recommendationContext,
  };

  for (; loop < 8; loop++) {
    const res = await callLlm(messages, TRIP_TOOLS, activeConfig);
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
      debugLog('ai', 'executing_tool', { tool: fnName, args: tc.function?.arguments });
      const result = await executeTripTool(tripId, userId, fnName, tc.function?.arguments ?? '{}', toolContext);
      actions.push(result);
      messages.push({ role: 'tool', tool_call_id: tc.id, name: fnName, content: result.summary });
    }
  }

  const res = await callLlm(messages, [], activeConfig);
  const reply = res.choices?.[0]?.message?.content?.trim() || 'Finished.';
  return { reply, actions };
}

export async function suggestTitleAndDescription(
  text: string,
  category?: string,
): Promise<{ title: string; description: string }> {
  const trimmed = String(text ?? '').trim();
  if (!trimmed) {
    return { title: '', description: '' };
  }

  const activeConfig = await getAiConfig();
  if (!activeConfig.enabled) {
    return cleanFallbackTitleAndDescription(trimmed);
  }

  const prompt = [
    `You are an expert travel assistant. Given the following travel place, tour, or activity details, return a concise, meaningful title and clean description.`,
    `STRICT RULES:`,
    `- The "title" MUST be brief, clear, and punchy (2 to 5 words, maximum 35 characters). Example: "Louvre Museum Tour", "Dinner at Osteria Da Fortunata", "Fushimi Inari Sunset Hike". It must never be a long sentence.`,
    `- The "description" should contain the full details, context, schedule, highlights, or tips.`,
    `- Output MUST be valid JSON with keys "title" and "description".`,
    category ? `Category: ${category}` : '',
    `User input:\n"""\n${trimmed.slice(0, 4000)}\n"""`,
  ]
    .filter(Boolean)
    .join('\n\n');

  try {
    const res = await callLlm(
      [
        {
          role: 'system',
          content: 'You are a travel itinerary assistant. Always respond with valid JSON containing "title" and "description".',
        },
        { role: 'user', content: prompt },
      ],
      [],
      activeConfig,
    );

    const rawReply = res.choices?.[0]?.message?.content?.trim() || '';
    const jsonMatch = rawReply.match(/```(?:json)?\s*([\s\S]*?)\s*```/) || [null, rawReply];
    const parsed = JSON.parse(jsonMatch[1] || rawReply) as { title?: unknown; description?: unknown };
    const title = typeof parsed.title === 'string' ? parsed.title.trim() : '';
    const description = typeof parsed.description === 'string' ? parsed.description.trim() : '';
    if (title) {
      return {
        title: title.slice(0, 40),
        description: description || trimmed,
      };
    }
  } catch {
    // Fall back to heuristic on error or parse failure
  }

  return cleanFallbackTitleAndDescription(trimmed);
}