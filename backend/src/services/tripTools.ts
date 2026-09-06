import { prisma } from '../db.js';
import { syncBookingToItinerary } from './bookingHelper.js';
import { reconcileTripDays, isGenericDayLabel } from './dayReconciliation.js';
import { fetchSuggestions, type Suggestion } from './suggestions.js';
import { inferCategoryFromText } from './categoryClassifier.js';
import type { BookingType, ExpenseCategory } from '@prisma/client';

export const BOOKING_TYPES = ['flight', 'hotel', 'car', 'activity'] as const;
export const EXPENSE_CATEGORIES = [
  'transport',
  'lodging',
  'food',
  'activity',
  'shopping',
  'entertainment',
  'other',
] as const;

export interface ToolResult {
  action: string;
  summary: string;
  ok: boolean;
  data?: unknown;
  suggestions?: Suggestion[];
  placeId?: string;
  bookingId?: string;
  expenseId?: string;
  dayId?: string;
}

export interface ToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

export interface ToolContext {
  sourceText?: string;
  destination?: string;
  focusedDayId?: string;
  recommendationContext?: {
    location: string;
    dayId?: string;
    recommendedAt?: string;
    label?: string;
  };
}

// ---------------- Helpers ----------------

export function parseArgs(raw: string | Record<string, unknown>): Record<string, unknown> {
  if (typeof raw === 'object' && raw !== null) return raw;
  try {
    return JSON.parse(String(raw)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function toDate(v: unknown): Date | undefined {
  if (typeof v !== 'string' || !v) return undefined;
  const str = v.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d, 12, 0, 0);
  }
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function toDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function cleanFallbackTitleAndDescription(rawText: string): { title: string; description: string } {
  const clean = rawText.trim().replace(/\r\n/g, '\n');
  if (!clean) return { title: 'New Activity', description: '' };

  const lines = clean.split('\n').map((l) => l.trim()).filter(Boolean);
  const firstLine = lines[0] || clean;

  // If first line has a delimiter like " - ", ": ", " — ", " · "
  const sepMatch = firstLine.match(/^(.*?)\s*(?:—|–|-|:|\/|\||·)\s*(.+)$/);
  if (sepMatch && sepMatch[1].trim().length >= 3 && sepMatch[1].trim().length <= 35) {
    const title = sepMatch[1].trim();
    const remainingFirst = sepMatch[2].trim();
    const restLines = lines.slice(1);
    const description = [remainingFirst, ...restLines].filter(Boolean).join('\n');
    return { title, description: description || clean };
  }

  // If first line is already punchy (<= 35 chars)
  if (firstLine.length <= 35) {
    const rest = lines.slice(1).join('\n').trim();
    return { title: firstLine, description: rest };
  }

  // Remove common verbose filler prefixes
  const stripped = firstLine.replace(/^(?:visit (?:the )?|go to (?:the )?|guided tour of (?:the )?|take a (?:tour of )?|explore (?:the )?)/i, '');

  // Look for sentence boundary
  const sentenceMatch = stripped.match(/^([^.!?]+)[.!?]/);
  const candidate = (sentenceMatch ? sentenceMatch[1] : stripped).trim();
  if (candidate.length <= 35 && candidate.length >= 4) {
    const remaining = clean.slice(clean.indexOf(candidate) + candidate.length).replace(/^[.!?\s]+/, '').trim();
    return { title: candidate, description: remaining || clean };
  }

  // Break at word boundary near 32 chars
  const words = candidate.split(/\s+/);
  let title = '';
  for (const w of words) {
    if (!title) {
      title = w;
    } else if ((title + ' ' + w).length <= 32) {
      title += ' ' + w;
    } else {
      break;
    }
  }
  if (!title) title = candidate.slice(0, 30).trim();
  title = title.replace(/\s+(?:making|with|in|of|and|for|at|to|the|a|an|from|by)$/i, '');
  title = title.replace(/[,;:\s]+$/, '');
  return { title, description: clean };
}


// ---------------- Tool Definitions ----------------

export const TRIP_TOOLS: ToolDef[] = [
  // 1. Trip Overview & Metadata
  {
    type: 'function',
    function: {
      name: 'get_trip_details',
      description:
        'Get the full overview of the current trip: name, destination, start and end dates, description, currency, count of days, places, bookings, total budget spent, and packing progress.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_trip',
      description:
        'Update overall trip details (name, destination, description, start date YYYY-MM-DD, end date YYYY-MM-DD, currency). Automatically generates missing itinerary days for the date range.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Trip name/title' },
          destination: { type: 'string', description: 'Primary destination, e.g. "Tokyo, Japan"' },
          description: { type: 'string', description: 'Trip description or summary' },
          startDate: { type: 'string', description: 'Start date in YYYY-MM-DD format' },
          endDate: { type: 'string', description: 'End date in YYYY-MM-DD format' },
          currency: { type: 'string', description: 'Currency code, e.g. "USD", "EUR", "JPY"' },
        },
      },
    },
  },

  // 2. Days
  {
    type: 'function',
    function: {
      name: 'list_days',
      description: 'List all scheduled days of the trip itinerary with dates, labels, notes, and places.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_day',
      description: 'Add a new day to the itinerary. Date in YYYY-MM-DD format.',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'YYYY-MM-DD' },
          label: { type: 'string', description: 'Optional short label e.g. "Arrival in Tokyo"' },
          notes: { type: 'string', description: 'Optional day notes' },
        },
        required: ['date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_day',
      description: 'Update an itinerary day (label, notes, or date). Identify the day by dayId or date (YYYY-MM-DD).',
      parameters: {
        type: 'object',
        properties: {
          dayId: { type: 'string', description: 'Day ID if known' },
          date: { type: 'string', description: 'Current day date (YYYY-MM-DD) to find the day' },
          newDate: { type: 'string', description: 'New date (YYYY-MM-DD) if changing date' },
          label: { type: 'string', description: 'New label/title for the day' },
          notes: { type: 'string', description: 'New notes for the day' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_day',
      description:
        'Delete an itinerary day by dayId or date (YYYY-MM-DD). Any places on this day are unassigned by default so they are not lost; set deletePlaces=true to delete them too.',
      parameters: {
        type: 'object',
        properties: {
          dayId: { type: 'string', description: 'Day ID if known' },
          date: { type: 'string', description: 'Day date in YYYY-MM-DD format' },
          deletePlaces: { type: 'boolean', description: 'Whether to delete places on this day (default false: unassigns them)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'focus_day',
      description: 'Focus or select a specific day in the user interface and on the live map, or switch focus to view all days or unassigned places.',
      parameters: {
        type: 'object',
        properties: {
          dayIndex: { type: 'number', description: '1-based day number, e.g. 1 for Day 1, 2 for Day 2.' },
          date: { type: 'string', description: 'Date string (YYYY-MM-DD), or "all" to show all days, or "unassigned" to focus unassigned places.' },
          dayId: { type: 'string', description: 'The exact ID of the day to focus.' },
        },
      },
    },
  },

  // 3. Places / Itinerary Stops
  {
    type: 'function',
    function: {
      name: 'get_places',
      description: 'List or search places and stops in the itinerary. Filter by query, date (YYYY-MM-DD), or category.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Optional text query to filter places by name or notes' },
          date: { type: 'string', description: 'Optional day date (YYYY-MM-DD) to list places for that day' },
          category: { type: 'string', description: 'Optional category filter' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_place',
      description:
        'Add a place, stop, restaurant, attraction, or activity to the itinerary. Specify date (YYYY-MM-DD) to assign to a day, or omit for unassigned. Include address, lat/lng, website, and visit times if available.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Concise title for the place (2-5 words, max 35 chars, e.g. "Senso-ji Temple", "Trastevere Food Tour")',
          },
          date: { type: 'string', description: 'Itinerary date in YYYY-MM-DD format' },
          category: { type: 'string', description: 'e.g. Restaurant, Sightseeing, Transport, Accommodation, Activity, Shopping' },
          address: { type: 'string', description: 'Full address if known' },
          lat: { type: 'number', description: 'Latitude' },
          lng: { type: 'number', description: 'Longitude' },
          website: { type: 'string', description: 'Website URL' },
          description: { type: 'string', description: 'Full context, highlights, opening hours, or background' },
          notes: { type: 'string', description: 'Practical tips, reservations, or notes' },
          startTime: { type: 'string', description: 'ISO datetime or HH:MM start time' },
          endTime: { type: 'string', description: 'ISO datetime or HH:MM end time' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_place',
      description:
        'Update an existing place/stop in the itinerary. Identify the place by placeId or matching name. Can move to a different day via date (YYYY-MM-DD or "unassigned"), rename, update category, address, coords, notes, or times.',
      parameters: {
        type: 'object',
        properties: {
          placeId: { type: 'string', description: 'Place ID if known' },
          name: { type: 'string', description: 'Current name of the place to find it if placeId is omitted' },
          newName: { type: 'string', description: 'New name if renaming the place' },
          date: { type: 'string', description: 'New date in YYYY-MM-DD format to move to, or "unassigned"' },
          category: { type: 'string', description: 'New category' },
          address: { type: 'string', description: 'Updated address' },
          lat: { type: 'number', description: 'Updated latitude' },
          lng: { type: 'number', description: 'Updated longitude' },
          website: { type: 'string', description: 'Updated website URL' },
          description: { type: 'string', description: 'Updated description' },
          notes: { type: 'string', description: 'Updated notes' },
          startTime: { type: 'string', description: 'Updated start time' },
          endTime: { type: 'string', description: 'Updated end time' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_place',
      description: 'Delete a place / stop from the itinerary. Identify by placeId or matching place name.',
      parameters: {
        type: 'object',
        properties: {
          placeId: { type: 'string', description: 'Place ID if known' },
          name: { type: 'string', description: 'Place name to delete' },
        },
      },
    },
  },

  // 4. Bookings & Reservations
  {
    type: 'function',
    function: {
      name: 'list_bookings',
      description: 'List all bookings and reservations (flights, hotels, cars, activities) for the trip.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: BOOKING_TYPES, description: 'Optional filter: flight | hotel | car | activity' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_booking',
      description:
        'Add a reservation or booking (flight, hotel, car, activity). Automatically parses confirmation codes, syncs legs/stays into itinerary days, and logs ticket cost in the budget.',
      parameters: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: BOOKING_TYPES, description: 'flight | hotel | car | activity' },
          title: { type: 'string', description: 'Human-readable title e.g. "United Airlines SFO to HND"' },
          provider: { type: 'string', description: 'Airline, hotel chain, or rental company' },
          reference: { type: 'string', description: 'Confirmation number or PNR' },
          startAt: { type: 'string', description: 'Start ISO datetime or YYYY-MM-DD' },
          endAt: { type: 'string', description: 'Optional end ISO datetime or YYYY-MM-DD' },
          price: { type: 'number', description: 'Confirmed price/fare' },
          currency: { type: 'string', description: 'Currency code, e.g. USD, EUR' },
        },
        required: ['type', 'title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_booking',
      description: 'Update an existing booking. Identify by bookingId, reference code, or title.',
      parameters: {
        type: 'object',
        properties: {
          bookingId: { type: 'string', description: 'Booking ID if known' },
          reference: { type: 'string', description: 'Current confirmation code to find booking' },
          title: { type: 'string', description: 'Current title to find booking' },
          newTitle: { type: 'string', description: 'New title' },
          type: { type: 'string', enum: BOOKING_TYPES },
          provider: { type: 'string' },
          startAt: { type: 'string' },
          endAt: { type: 'string' },
          price: { type: 'number' },
          currency: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_booking',
      description: 'Delete a booking by bookingId, confirmation reference, or title.',
      parameters: {
        type: 'object',
        properties: {
          bookingId: { type: 'string', description: 'Booking ID if known' },
          reference: { type: 'string', description: 'Confirmation reference code' },
          title: { type: 'string', description: 'Booking title to delete' },
        },
      },
    },
  },

  // 5. Expenses & Budget
  {
    type: 'function',
    function: {
      name: 'list_expenses',
      description: 'List all expenses recorded in the trip budget, with category totals and overall sum.',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: EXPENSE_CATEGORIES, description: 'Optional category filter' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_expense',
      description: 'Add an expense to the trip budget.',
      parameters: {
        type: 'object',
        properties: {
          description: { type: 'string', description: 'Expense description, e.g. "Dinner at Izakaya"' },
          amount: { type: 'number', description: 'Numerical amount' },
          category: { type: 'string', enum: EXPENSE_CATEGORIES, description: 'Expense category' },
          currency: { type: 'string', description: 'Currency code, default USD' },
          date: { type: 'string', description: 'YYYY-MM-DD' },
          notes: { type: 'string', description: 'Optional notes' },
        },
        required: ['description', 'amount'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_expense',
      description: 'Update an existing expense by expenseId or matching description.',
      parameters: {
        type: 'object',
        properties: {
          expenseId: { type: 'string', description: 'Expense ID if known' },
          description: { type: 'string', description: 'Current description to find expense' },
          newDescription: { type: 'string', description: 'New description' },
          amount: { type: 'number', description: 'New amount' },
          category: { type: 'string', enum: EXPENSE_CATEGORIES },
          currency: { type: 'string' },
          date: { type: 'string', description: 'YYYY-MM-DD' },
          notes: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_expense',
      description: 'Delete an expense from the trip budget by expenseId or description.',
      parameters: {
        type: 'object',
        properties: {
          expenseId: { type: 'string', description: 'Expense ID if known' },
          description: { type: 'string', description: 'Description of expense to delete' },
        },
      },
    },
  },

  // 6. Packing Checklist
  {
    type: 'function',
    function: {
      name: 'list_packing_items',
      description: 'List all items in the trip packing checklist.',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string' },
          done: { type: 'boolean' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_packing_item',
      description: 'Add an item to the packing list.',
      parameters: {
        type: 'object',
        properties: {
          item: { type: 'string', description: 'Item name' },
          category: { type: 'string', description: 'e.g. Clothing, Electronics, Documents, Toiletries' },
          done: { type: 'boolean', description: 'Whether item is already packed' },
        },
        required: ['item'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_packing_item',
      description: 'Update a packing item (e.g. mark done, rename, change category). Identify by current item text.',
      parameters: {
        type: 'object',
        properties: {
          currentItem: { type: 'string', description: 'Current item name to find it' },
          item: { type: 'string', description: 'New name if renaming' },
          category: { type: 'string', description: 'New category' },
          done: { type: 'boolean', description: 'Packed status' },
        },
        required: ['currentItem'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_packing_item',
      description: 'Delete a packing item by item text.',
      parameters: {
        type: 'object',
        properties: {
          item: { type: 'string', description: 'Item name to delete' },
        },
        required: ['item'],
      },
    },
  },

  // 6b. To-Do Items / Pre-Trip Tasks
  {
    type: 'function',
    function: {
      name: 'list_todos',
      description: 'List all to-do tasks and pre-trip checklist items (e.g. mail hold, prescriptions, passport check).',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_todo',
      description: 'Add a to-do item or pre-trip task with optional due date, category, and notes.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Task title (e.g., "Place USPS mail hold", "Refill prescriptions")' },
          dueDate: { type: 'string', description: 'Due date in YYYY-MM-DD format (optional)' },
          category: { type: 'string', description: 'Category (e.g. "Pre-Trip", "Home & Mail", "Health", "Documents", "Finance")' },
          notes: { type: 'string', description: 'Additional notes or instructions' },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_todo',
      description: 'Update a to-do task (mark done, change due date, category, or title). Identify by current title.',
      parameters: {
        type: 'object',
        properties: {
          currentTitle: { type: 'string', description: 'Current task title to find it' },
          title: { type: 'string', description: 'New title if renaming' },
          dueDate: { type: 'string', description: 'New due date in YYYY-MM-DD format (or "clear" to remove)' },
          category: { type: 'string', description: 'New category' },
          notes: { type: 'string', description: 'New notes' },
          done: { type: 'boolean', description: 'Completed status' },
        },
        required: ['currentTitle'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_todo',
      description: 'Delete a to-do item by task title.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Task title to delete' },
        },
        required: ['title'],
      },
    },
  },

  // 7. Journal Entries
  {
    type: 'function',
    function: {
      name: 'list_journal_entries',
      description: 'List all journal entries for the trip.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_journal_entry',
      description: 'Add a journal entry or log note for the trip.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Entry title' },
          body: { type: 'string', description: 'Entry content / notes' },
          date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
        },
        required: ['title', 'body'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_journal_entry',
      description: 'Update an existing journal entry by journalId or title.',
      parameters: {
        type: 'object',
        properties: {
          journalId: { type: 'string', description: 'Journal entry ID if known' },
          title: { type: 'string', description: 'Current title to find entry' },
          newTitle: { type: 'string', description: 'New title' },
          body: { type: 'string', description: 'New body content' },
          date: { type: 'string', description: 'YYYY-MM-DD' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_journal_entry',
      description: 'Delete a journal entry by journalId or title.',
      parameters: {
        type: 'object',
        properties: {
          journalId: { type: 'string', description: 'Journal entry ID if known' },
          title: { type: 'string', description: 'Title of entry to delete' },
        },
      },
    },
  },

  // 8. Recommendations
  {
    type: 'function',
    function: {
      name: 'get_suggestions',
      description: 'Fetch structured recommendations (attractions, restaurants, activities) with photos and links.',
      parameters: {
        type: 'object',
        properties: {
          location: { type: 'string', description: 'City / destination, e.g. "Tokyo" or "Rome"' },
          query: { type: 'string', description: 'Focus query, e.g. "ramen", "museums", "nightlife"' },
          count: { type: 'number', description: 'Max suggestions (default 8)' },
        },
        required: ['location'],
      },
    },
  },
];

// ---------------- Executor Implementation ----------------

const suggestionCache = new Map<string, Suggestion[]>();

export async function executeTripTool(
  tripId: string,
  userId: string,
  name: string,
  argsRaw: string | Record<string, unknown>,
  ctx: ToolContext = {},
): Promise<ToolResult> {
  const a = parseArgs(argsRaw);

  try {
    // ---------------- 1. Trip Overview & Update ----------------
    if (name === 'get_trip_details') {
      const trip = await prisma.trip.findUnique({
        where: { id: tripId },
        include: {
          days: { orderBy: { date: 'asc' }, include: { places: { select: { id: true, name: true, category: true } } } },
          bookings: { select: { id: true, type: true, title: true, reference: true, startAt: true } },
          expenses: { select: { id: true, description: true, amount: true, currency: true, category: true } },
          packing: { select: { id: true, item: true, category: true, done: true } },
          todos: { select: { id: true, title: true, done: true, dueDate: true, category: true } },
          journal: { select: { id: true, title: true, date: true } },
          places: { where: { dayId: null }, select: { id: true, name: true } },
        },
      });
      if (!trip) return { action: name, summary: 'Trip not found', ok: false };

      const totalSpent = trip.expenses.reduce((sum, e) => sum + e.amount, 0);
      const packedCount = trip.packing.filter((p) => p.done).length;
      const todosDoneCount = trip.todos.filter((t) => t.done).length;

      const summary = `Trip "${trip.name}" (${trip.destination}): ${trip.days.length} days, ` +
        `${trip.bookings.length} bookings, ${trip.expenses.length} expenses ($${totalSpent.toFixed(2)} ${trip.currency}), ` +
        `packing: ${packedCount}/${trip.packing.length} items, todos: ${todosDoneCount}/${trip.todos.length} done.`;

      return {
        action: name,
        summary,
        ok: true,
        data: {
          id: trip.id,
          name: trip.name,
          destination: trip.destination,
          description: trip.description,
          currency: trip.currency,
          startDate: trip.startDate ? toDayKey(trip.startDate) : null,
          endDate: trip.endDate ? toDayKey(trip.endDate) : null,
          daysCount: trip.days.length,
          unassignedPlacesCount: trip.places.length,
          bookingsCount: trip.bookings.length,
          expensesTotal: totalSpent,
          packingTotal: trip.packing.length,
          packingDone: packedCount,
          todosTotal: trip.todos.length,
          todosDone: todosDoneCount,
        },
      };
    }

    if (name === 'update_trip') {
      const data: Record<string, unknown> = {};
      if (typeof a.name === 'string' && a.name.trim()) data.name = a.name.trim();
      if (typeof a.destination === 'string' && a.destination.trim()) data.destination = a.destination.trim();
      if (typeof a.description === 'string') data.description = a.description.trim() || null;
      if (typeof a.currency === 'string' && a.currency.trim()) data.currency = a.currency.trim().toUpperCase();

      const newStart = a.startDate ? toDate(a.startDate) : undefined;
      const newEnd = a.endDate ? toDate(a.endDate) : undefined;
      if (newStart !== undefined) data.startDate = newStart;
      if (newEnd !== undefined) data.endDate = newEnd;

      const updated = await prisma.trip.update({ where: { id: tripId }, data });

      // Automatically generate missing days and reconcile bounds
      if (newStart || newEnd || (updated.startDate && updated.endDate)) {
        await reconcileTripDays(tripId);
      }

      const changes = Object.keys(data).join(', ');
      return {
        action: name,
        summary: `Updated trip "${updated.name}" (${changes || 'no changes'})`,
        ok: true,
        data: updated,
      };
    }

    // ---------------- 2. Days ----------------
    if (name === 'list_days') {
      const days = await prisma.day.findMany({
        where: { tripId },
        orderBy: { date: 'asc' },
        include: { places: { orderBy: { sortOrder: 'asc' }, select: { id: true, name: true, category: true, startTime: true } } },
      });
      const summary = `Found ${days.length} day(s):\n` +
        days.map((d, i) => `Day ${i + 1} (${toDayKey(d.date)})${d.label ? `: ${d.label}` : ''} [${d.places.length} stops]`).join('\n');
      return { action: name, summary, ok: true, data: days };
    }

    if (name === 'add_day') {
      const date = toDate(a.date);
      if (!date) return { action: name, summary: 'add_day: valid date (YYYY-MM-DD) required', ok: false };
      const rawLabel = a.label ? String(a.label).trim() : undefined;
      const label = rawLabel && !isGenericDayLabel(rawLabel) ? rawLabel : undefined;
      const count = await prisma.day.count({ where: { tripId } });
      const day = await prisma.day.create({
        data: {
          tripId,
          date,
          label,
          notes: a.notes ? String(a.notes).trim() : undefined,
          sortOrder: count,
        },
      });
      await reconcileTripDays(tripId);
      return { action: name, summary: `Added itinerary day ${toDayKey(date)}${day.label ? ` (${day.label})` : ''}`, ok: true, dayId: day.id };
    }

    if (name === 'update_day') {
      const dayId = typeof a.dayId === 'string' ? a.dayId.trim() : '';
      const dateStr = typeof a.date === 'string' ? a.date.trim() : '';
      let target = dayId ? await prisma.day.findUnique({ where: { id: dayId } }) : null;

      if (!target && dateStr) {
        const d = toDate(dateStr);
        if (d) {
          const days = await prisma.day.findMany({ where: { tripId } });
          target = days.find((day) => toDayKey(day.date) === toDayKey(d)) ?? null;
        }
      }

      if (!target) return { action: name, summary: `Day ${dayId || dateStr} not found`, ok: false };

      const data: Record<string, unknown> = {};
      if (typeof a.label === 'string') data.label = a.label.trim() || null;
      if (typeof a.notes === 'string') data.notes = a.notes.trim() || null;
      if (a.newDate) {
        const nd = toDate(a.newDate);
        if (nd) data.date = nd;
      }

      const updated = await prisma.day.update({ where: { id: target.id }, data });
      return { action: name, summary: `Updated day ${toDayKey(updated.date)}${updated.label ? ` ("${updated.label}")` : ''}`, ok: true, dayId: updated.id };
    }

    if (name === 'delete_day') {
      const dayId = typeof a.dayId === 'string' ? a.dayId.trim() : '';
      const dateStr = typeof a.date === 'string' ? a.date.trim() : '';
      let target = dayId ? await prisma.day.findUnique({ where: { id: dayId } }) : null;

      if (!target && dateStr) {
        const d = toDate(dateStr);
        if (d) {
          const days = await prisma.day.findMany({ where: { tripId } });
          target = days.find((day) => toDayKey(day.date) === toDayKey(d)) ?? null;
        }
      }

      if (!target) return { action: name, summary: `Day ${dayId || dateStr} not found`, ok: false };

      if (a.deletePlaces) {
        await prisma.place.deleteMany({ where: { dayId: target.id } });
      } else {
        await prisma.place.updateMany({ where: { dayId: target.id }, data: { dayId: null } });
      }

      await prisma.day.delete({ where: { id: target.id } });
      return { action: name, summary: `Deleted day ${toDayKey(target.date)}${a.deletePlaces ? ' and its places' : ' (places unassigned)'}`, ok: true };
    }

    if (name === 'focus_day') {
      const days = await prisma.day.findMany({ where: { tripId }, orderBy: { date: 'asc' } });
      const dateVal = typeof a.date === 'string' ? a.date.trim().toLowerCase() : '';
      if (dateVal === 'all' || dateVal === 'none' || dateVal === 'clear') {
        return {
          action: name,
          summary: 'Switched focus to view all itinerary days.',
          ok: true,
          dayId: '',
          data: { dayId: null, mode: 'all' },
        };
      }
      if (dateVal === 'unassigned' || dateVal === 'orphan') {
        return {
          action: name,
          summary: 'Focused unassigned places on the itinerary and map.',
          ok: true,
          dayId: 'unassigned',
          data: { dayId: 'unassigned', mode: 'unassigned' },
        };
      }

      let targetDay = typeof a.dayId === 'string' ? days.find((d) => d.id === a.dayId) : undefined;
      if (!targetDay && typeof a.dayIndex === 'number' && a.dayIndex >= 1 && a.dayIndex <= days.length) {
        targetDay = days[Math.floor(a.dayIndex) - 1];
      }
      if (!targetDay && dateVal) {
        targetDay = days.find((d) => toDayKey(d.date) === dateVal);
      }

      if (!targetDay) {
        return {
          action: name,
          summary: `Could not find day matching ${a.dayIndex ? `Day ${a.dayIndex}` : a.date || a.dayId}. Available days: 1 to ${days.length}.`,
          ok: false,
        };
      }

      const dayIdx = days.findIndex((d) => d.id === targetDay.id) + 1;
      const customTitle = targetDay.label && !isGenericDayLabel(targetDay.label) ? ` (${targetDay.label})` : '';
      return {
        action: name,
        summary: `Focused Day ${dayIdx}${customTitle} on the map and itinerary.`,
        ok: true,
        dayId: targetDay.id,
        data: { dayId: targetDay.id, dayIndex: dayIdx, date: toDayKey(targetDay.date), label: targetDay.label },
      };
    }

    // ---------------- 3. Places / Itinerary Stops ----------------
    if (name === 'get_places') {
      const query = typeof a.query === 'string' ? a.query.trim().toLowerCase() : '';
      const category = typeof a.category === 'string' ? a.category.trim() : '';
      const date = toDate(a.date);

      let dayId: string | undefined;
      if (date) {
        const days = await prisma.day.findMany({ where: { tripId } });
        const hit = days.find((d) => toDayKey(d.date) === toDayKey(date));
        if (hit) dayId = hit.id;
      }

      const places = await prisma.place.findMany({
        where: {
          tripId,
          ...(dayId ? { dayId } : {}),
          ...(category ? { category: { contains: category, mode: 'insensitive' } } : {}),
          ...(query
            ? {
                OR: [
                  { name: { contains: query, mode: 'insensitive' } },
                  { description: { contains: query, mode: 'insensitive' } },
                  { notes: { contains: query, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        include: { day: { select: { date: true, label: true } } },
        orderBy: [{ dayId: 'asc' }, { sortOrder: 'asc' }],
      });

      const summary = `Found ${places.length} place(s):\n` +
        places
          .map(
            (p) =>
              `- [${p.id}] ${p.name} (${p.category || 'General'})${p.day ? ` on ${toDayKey(p.day.date)}` : ' (unassigned)'}${p.address ? ` - ${p.address}` : ''}`,
          )
          .join('\n');

      return { action: name, summary, ok: true, data: places };
    }

    if (name === 'add_place') {
      let nameStr = String(a.name ?? '').trim();
      let descStr = typeof a.description === 'string' ? a.description.trim() : '';
      if (!nameStr && descStr) {
        const suggested = cleanFallbackTitleAndDescription(descStr);
        nameStr = suggested.title;
        descStr = suggested.description;
      } else if (nameStr.length > 35 || nameStr.includes('\n')) {
        const suggested = cleanFallbackTitleAndDescription(nameStr);
        if (!descStr) descStr = suggested.description;
        nameStr = suggested.title;
      }
      if (!nameStr) return { action: name, summary: 'add_place: name is required', ok: false };

      let dayId: string | undefined;
      const date = toDate(a.date);
      if (date) {
        const days = await prisma.day.findMany({ where: { tripId }, orderBy: { date: 'asc' } });
        const hit = days.find((d) => toDayKey(d.date) === toDayKey(date));
        if (hit) {
          dayId = hit.id;
        } else {
          const rawLabel = a.label ? String(a.label) : undefined;
          const label = rawLabel && !isGenericDayLabel(rawLabel) ? rawLabel : undefined;
          const created = await prisma.day.create({
            data: { tripId, date, label, sortOrder: days.length },
          });
          dayId = created.id;
          await reconcileTripDays(tripId);
        }
      } else if (typeof a.dayId === 'string' && a.dayId) {
        dayId = a.dayId;
      } else if (ctx.focusedDayId && ctx.focusedDayId !== 'unassigned') {
        const matchingDay = await prisma.day.findFirst({ where: { id: ctx.focusedDayId, tripId } });
        if (matchingDay) {
          dayId = matchingDay.id;
        }
      }

      const count = await prisma.place.count({ where: { tripId } });
      const notes = [a.notes ? String(a.notes) : undefined].filter(Boolean).join('\n');
      const category = a.category
        ? String(a.category)
        : inferCategoryFromText([nameStr, a.address, descStr, notes].filter(Boolean).join(' '));

      const place = await prisma.place.create({
        data: {
          tripId,
          name: nameStr,
          dayId,
          sortOrder: count,
          category,
          address: a.address ? String(a.address) : undefined,
          lat: typeof a.lat === 'number' ? a.lat : undefined,
          lng: typeof a.lng === 'number' ? a.lng : undefined,
          website: a.website ? String(a.website) : undefined,
          sourceText: ctx.sourceText,
          description: descStr || undefined,
          notes: notes || undefined,
          startTime: toDate(a.startTime),
          endTime: toDate(a.endTime),
        },
      });

      const when = dayId ? ` (on ${date ? toDayKey(date) : 'day'})` : ' (unassigned)';
      return { action: name, summary: `Added place "${nameStr}"${when}`, ok: true, placeId: place.id };
    }

    if (name === 'update_place') {
      const placeId = typeof a.placeId === 'string' ? a.placeId.trim() : '';
      const nameQuery = typeof a.name === 'string' ? a.name.trim() : '';

      let target = placeId ? await prisma.place.findUnique({ where: { id: placeId } }) : null;
      if (!target && nameQuery) {
        target = await prisma.place.findFirst({
          where: { tripId, name: { contains: nameQuery, mode: 'insensitive' } },
        });
      }

      if (!target) return { action: name, summary: `Place "${placeId || nameQuery}" not found`, ok: false };

      const data: Record<string, unknown> = {};
      if (typeof a.newName === 'string' && a.newName.trim()) {
        data.name = a.newName.trim();
      }

      if (a.date !== undefined) {
        if (String(a.date).toLowerCase() === 'unassigned' || !a.date) {
          data.dayId = null;
        } else {
          const date = toDate(a.date);
          if (date) {
            const days = await prisma.day.findMany({ where: { tripId } });
            let hit = days.find((d) => toDayKey(d.date) === toDayKey(date));
            if (!hit) {
              hit = await prisma.day.create({ data: { tripId, date, sortOrder: days.length } });
            }
            data.dayId = hit.id;
          }
        }
      }

      if (typeof a.category === 'string') data.category = a.category.trim() || null;
      if (typeof a.address === 'string') data.address = a.address.trim() || null;
      if (typeof a.lat === 'number') data.lat = a.lat;
      if (typeof a.lng === 'number') data.lng = a.lng;
      if (typeof a.website === 'string') data.website = a.website.trim() || null;
      if (typeof a.description === 'string') data.description = a.description.trim() || null;
      if (typeof a.notes === 'string') data.notes = a.notes.trim() || null;
      if (a.startTime !== undefined) data.startTime = toDate(a.startTime) ?? null;
      if (a.endTime !== undefined) data.endTime = toDate(a.endTime) ?? null;

      const updated = await prisma.place.update({ where: { id: target.id }, data });
      return { action: name, summary: `Updated place "${updated.name}"`, ok: true, placeId: updated.id };
    }

    if (name === 'delete_place') {
      const placeId = typeof a.placeId === 'string' ? a.placeId.trim() : '';
      const nameQuery = typeof a.name === 'string' ? a.name.trim() : '';

      let target = placeId ? await prisma.place.findUnique({ where: { id: placeId } }) : null;
      if (!target && nameQuery) {
        target = await prisma.place.findFirst({
          where: { tripId, name: { contains: nameQuery, mode: 'insensitive' } },
        });
      }

      if (!target) return { action: name, summary: `Place "${placeId || nameQuery}" not found`, ok: false };

      await prisma.place.delete({ where: { id: target.id } });
      return { action: name, summary: `Deleted place "${target.name}"`, ok: true };
    }

    // ---------------- 4. Bookings & Reservations ----------------
    if (name === 'list_bookings') {
      const type = typeof a.type === 'string' ? (a.type.toLowerCase() as BookingType) : undefined;
      const bookings = await prisma.booking.findMany({
        where: { tripId, ...(type ? { type } : {}) },
        orderBy: { startAt: 'asc' },
      });
      const summary = `Found ${bookings.length} booking(s):\n` +
        bookings
          .map(
            (b) =>
              `- [${b.id}] ${b.type.toUpperCase()}: "${b.title}"${b.reference ? ` (ref ${b.reference})` : ''}${b.startAt ? ` @ ${toDayKey(b.startAt)}` : ''}`,
          )
          .join('\n');
      return { action: name, summary, ok: true, data: bookings };
    }

    if (name === 'add_booking') {
      const rawType = String(a.type ?? '').toLowerCase();
      const type = BOOKING_TYPES.includes(rawType as BookingType) ? (rawType as BookingType) : null;
      const title = String(a.title ?? '').trim();
      if (!type || !title) return { action: name, summary: 'add_booking: valid type and title required', ok: false };
      const confirmedPrice = typeof a.price === 'number' ? a.price : parseFloat(String(a.price ?? ''));
      const details = ctx.sourceText
        ? {
            sourceRaw: ctx.sourceText.slice(0, 12_000),
            ...(Number.isFinite(confirmedPrice) && confirmedPrice > 0 ? { confirmedPrice } : {}),
            ...(a.currency ? { currency: String(a.currency).toUpperCase() } : {}),
          }
        : undefined;

      const booking = await prisma.booking.create({
        data: {
          tripId,
          userId,
          type,
          title,
          provider: a.provider ? String(a.provider).trim() : undefined,
          reference: a.reference ? String(a.reference).trim() : undefined,
          startAt: toDate(a.startAt),
          endAt: toDate(a.endAt),
          details,
        },
      });

      // Synchronize booking with itinerary days, places, and budget expense
      const sync = await syncBookingToItinerary(
        tripId,
        userId,
        booking.id,
        ctx.sourceText || `${title} ${a.provider ?? ''} ${a.reference ?? ''}`,
        title,
        {
          type,
          provider: a.provider ? String(a.provider).trim() : undefined,
          reference: a.reference ? String(a.reference).trim() : undefined,
          startAt: toDate(a.startAt),
          endAt: toDate(a.endAt),
          totalAmount: confirmedPrice,
          currency: a.currency ? String(a.currency).trim() : undefined,
        },
      );

      const extras: string[] = [];
      if (sync.daysAdded > 0) extras.push(`${sync.daysAdded} day(s) created`);
      if (sync.placesAdded > 0) extras.push(`${sync.placesAdded} stop(s) added`);
      if (sync.expenseAdded) extras.push('expense logged in budget');

      const extraSummary = extras.length > 0 ? ` (${extras.join(', ')})` : '';
      return {
        action: name,
        summary: `Added ${type} booking "${title}"${booking.reference ? ` (ref ${booking.reference})` : ''}${extraSummary}`,
        ok: true,
        bookingId: booking.id,
      };
    }

    if (name === 'update_booking') {
      const bookingId = typeof a.bookingId === 'string' ? a.bookingId.trim() : '';
      const ref = typeof a.reference === 'string' ? a.reference.trim() : '';
      const titleQuery = typeof a.title === 'string' ? a.title.trim() : '';

      let target = bookingId ? await prisma.booking.findUnique({ where: { id: bookingId } }) : null;
      if (!target && ref) {
        target = await prisma.booking.findFirst({ where: { tripId, reference: { equals: ref, mode: 'insensitive' } } });
      }
      if (!target && titleQuery) {
        target = await prisma.booking.findFirst({ where: { tripId, title: { contains: titleQuery, mode: 'insensitive' } } });
      }

      if (!target) return { action: name, summary: `Booking "${bookingId || ref || titleQuery}" not found`, ok: false };

      const data: Record<string, unknown> = {};
      if (typeof a.newTitle === 'string' && a.newTitle.trim()) data.title = a.newTitle.trim();
      if (typeof a.provider === 'string') data.provider = a.provider.trim() || null;
      if (typeof a.reference === 'string') data.reference = a.reference.trim() || null;
      if (a.startAt !== undefined) data.startAt = toDate(a.startAt) ?? null;
      if (a.endAt !== undefined) data.endAt = toDate(a.endAt) ?? null;
      if (a.type && BOOKING_TYPES.includes(String(a.type).toLowerCase() as BookingType)) {
        data.type = String(a.type).toLowerCase() as BookingType;
      }

      const updated = await prisma.booking.update({ where: { id: target.id }, data });
      return { action: name, summary: `Updated booking "${updated.title}"`, ok: true, bookingId: updated.id };
    }

    if (name === 'delete_booking') {
      const bookingId = typeof a.bookingId === 'string' ? a.bookingId.trim() : '';
      const ref = typeof a.reference === 'string' ? a.reference.trim() : '';
      const titleQuery = typeof a.title === 'string' ? a.title.trim() : '';

      let target = bookingId ? await prisma.booking.findUnique({ where: { id: bookingId } }) : null;
      if (!target && ref) {
        target = await prisma.booking.findFirst({ where: { tripId, reference: { equals: ref, mode: 'insensitive' } } });
      }
      if (!target && titleQuery) {
        target = await prisma.booking.findFirst({ where: { tripId, title: { contains: titleQuery, mode: 'insensitive' } } });
      }

      if (!target) return { action: name, summary: `Booking "${bookingId || ref || titleQuery}" not found`, ok: false };

      await prisma.booking.delete({ where: { id: target.id } });
      return { action: name, summary: `Deleted booking "${target.title}"${target.reference ? ` (ref ${target.reference})` : ''}`, ok: true };
    }

    // ---------------- 5. Expenses & Budget ----------------
    if (name === 'list_expenses') {
      const cat = typeof a.category === 'string' ? a.category.toLowerCase() : '';
      const category: ExpenseCategory | undefined = EXPENSE_CATEGORIES.includes(cat as ExpenseCategory)
        ? (cat as ExpenseCategory)
        : undefined;

      const expenses = await prisma.expense.findMany({
        where: { tripId, ...(category ? { category } : {}) },
        orderBy: { date: 'asc' },
      });

      const total = expenses.reduce((s, e) => s + e.amount, 0);
      const summary = `Found ${expenses.length} expense(s) (total ${total.toFixed(2)}):\n` +
        expenses
          .map(
            (e) =>
              `- [${e.id}] "${e.description}": ${e.amount} ${e.currency} (${e.category})${e.date ? ` @ ${toDayKey(e.date)}` : ''}`,
          )
          .join('\n');

      return { action: name, summary, ok: true, data: { total, expenses } };
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
          notes: a.notes ? String(a.notes).trim() : undefined,
          amount,
          currency: a.currency ? String(a.currency).toUpperCase().trim() : 'USD',
          category,
          date: toDate(a.date),
        },
      });
      return { action: name, summary: `Added expense "${desc}" for ${amount} ${expense.currency}`, ok: true, expenseId: expense.id };
    }

    if (name === 'update_expense') {
      const expenseId = typeof a.expenseId === 'string' ? a.expenseId.trim() : '';
      const descQuery = typeof a.description === 'string' ? a.description.trim() : '';

      let target = expenseId ? await prisma.expense.findUnique({ where: { id: expenseId } }) : null;
      if (!target && descQuery) {
        target = await prisma.expense.findFirst({
          where: { tripId, description: { contains: descQuery, mode: 'insensitive' } },
        });
      }

      if (!target) return { action: name, summary: `Expense "${expenseId || descQuery}" not found`, ok: false };

      const data: Record<string, unknown> = {};
      if (typeof a.newDescription === 'string' && a.newDescription.trim()) data.description = a.newDescription.trim();
      if (typeof a.amount === 'number' && Number.isFinite(a.amount)) data.amount = a.amount;
      if (a.category && EXPENSE_CATEGORIES.includes(String(a.category).toLowerCase() as ExpenseCategory)) {
        data.category = String(a.category).toLowerCase() as ExpenseCategory;
      }
      if (typeof a.currency === 'string') data.currency = a.currency.trim().toUpperCase();
      if (a.date !== undefined) data.date = toDate(a.date) ?? null;
      if (typeof a.notes === 'string') data.notes = a.notes.trim() || null;

      const updated = await prisma.expense.update({ where: { id: target.id }, data });
      return { action: name, summary: `Updated expense "${updated.description}" (${updated.amount} ${updated.currency})`, ok: true, expenseId: updated.id };
    }

    if (name === 'delete_expense') {
      const expenseId = typeof a.expenseId === 'string' ? a.expenseId.trim() : '';
      const descQuery = typeof a.description === 'string' ? a.description.trim() : '';

      let target = expenseId ? await prisma.expense.findUnique({ where: { id: expenseId } }) : null;
      if (!target && descQuery) {
        target = await prisma.expense.findFirst({
          where: { tripId, description: { contains: descQuery, mode: 'insensitive' } },
        });
      }

      if (!target) return { action: name, summary: `Expense "${expenseId || descQuery}" not found`, ok: false };

      await prisma.expense.delete({ where: { id: target.id } });
      return { action: name, summary: `Deleted expense "${target.description}" (${target.amount} ${target.currency})`, ok: true };
    }

    // ---------------- 6. Packing Checklist ----------------
    if (name === 'list_packing_items') {
      const category = typeof a.category === 'string' ? a.category.trim() : '';
      const done = typeof a.done === 'boolean' ? a.done : undefined;

      const items = await prisma.packingItem.findMany({
        where: {
          tripId,
          ...(category ? { category: { contains: category, mode: 'insensitive' } } : {}),
          ...(done !== undefined ? { done } : {}),
        },
        orderBy: { sortOrder: 'asc' },
      });

      const packed = items.filter((i) => i.done).length;
      const summary = `Packing list (${packed}/${items.length} packed):\n` +
        items.map((i) => `- [${i.done ? 'x' : ' '}] ${i.item}${i.category ? ` (${i.category})` : ''}`).join('\n');

      return { action: name, summary, ok: true, data: items };
    }

    if (name === 'add_packing_item') {
      const item = String(a.item ?? '').trim();
      if (!item) return { action: name, summary: 'Packing item name required', ok: false };
      const count = await prisma.packingItem.count({ where: { tripId } });
      const row = await prisma.packingItem.create({
        data: {
          tripId,
          item,
          category: a.category ? String(a.category).trim() : undefined,
          done: Boolean(a.done),
          sortOrder: count,
        },
      });
      return { action: name, summary: `Added packing item "${row.item}"`, ok: true };
    }

    if (name === 'update_packing_item') {
      const currentItem = String(a.currentItem ?? '').trim();
      const row = await prisma.packingItem.findFirst({
        where: { tripId, item: { equals: currentItem, mode: 'insensitive' } },
      });
      if (!row) return { action: name, summary: `Packing item "${currentItem}" not found`, ok: false };

      const updated = await prisma.packingItem.update({
        where: { id: row.id },
        data: {
          item: a.item !== undefined ? String(a.item).trim() : undefined,
          category: a.category !== undefined ? String(a.category).trim() : undefined,
          done: typeof a.done === 'boolean' ? a.done : undefined,
        },
      });
      return {
        action: name,
        summary: `Updated packing item "${updated.item}" (${updated.done ? 'packed' : 'not packed'})`,
        ok: true,
      };
    }

    if (name === 'delete_packing_item') {
      const item = String(a.item ?? '').trim();
      const row = await prisma.packingItem.findFirst({
        where: { tripId, item: { equals: item, mode: 'insensitive' } },
      });
      if (!row) return { action: name, summary: `Packing item "${item}" not found`, ok: false };

      await prisma.packingItem.delete({ where: { id: row.id } });
      return { action: name, summary: `Deleted packing item "${row.item}"`, ok: true };
    }

    // ---------------- 6b. To-Do Items / Pre-Trip Tasks ----------------
    if (name === 'list_todos') {
      const items = await prisma.todoItem.findMany({
        where: { tripId },
        orderBy: [{ done: 'asc' }, { dueDate: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
      });
      const doneCount = items.filter((t) => t.done).length;
      const summary = `To-Do list (${doneCount}/${items.length} completed):\n` +
        items.map((t) => `- [${t.done ? 'x' : ' '}] "${t.title}" (${t.category || 'Pre-Trip'}${t.dueDate ? `, due ${toDayKey(t.dueDate)}` : ''})`).join('\n');
      return { action: name, summary, ok: true, data: items };
    }

    if (name === 'add_todo') {
      const title = String(a.title ?? '').trim();
      if (!title) return { action: name, summary: 'To-do item title required', ok: false };
      const count = await prisma.todoItem.count({ where: { tripId } });
      const row = await prisma.todoItem.create({
        data: {
          tripId,
          title,
          category: typeof a.category === 'string' && a.category.trim() ? a.category.trim() : 'Pre-Trip',
          notes: typeof a.notes === 'string' && a.notes.trim() ? a.notes.trim() : null,
          dueDate: a.dueDate ? toDate(a.dueDate) : null,
          sortOrder: count,
        },
      });
      return { action: name, summary: `Added to-do "${row.title}"`, ok: true };
    }

    if (name === 'update_todo') {
      const currentTitle = String(a.currentTitle ?? '').trim();
      const row = await prisma.todoItem.findFirst({
        where: { tripId, title: { contains: currentTitle, mode: 'insensitive' } },
      });
      if (!row) return { action: name, summary: `To-do item "${currentTitle}" not found`, ok: false };

      const data: Record<string, unknown> = {};
      if (typeof a.title === 'string' && a.title.trim()) data.title = a.title.trim();
      if (typeof a.category === 'string' && a.category.trim()) data.category = a.category.trim();
      if (typeof a.notes === 'string') data.notes = a.notes.trim() || null;
      if (typeof a.done === 'boolean') data.done = a.done;
      if (a.dueDate === 'clear') data.dueDate = null;
      else if (a.dueDate) data.dueDate = toDate(a.dueDate);

      const updated = await prisma.todoItem.update({
        where: { id: row.id },
        data,
      });
      return {
        action: name,
        summary: `Updated to-do "${updated.title}" (${updated.done ? 'completed' : 'pending'})`,
        ok: true,
      };
    }

    if (name === 'delete_todo') {
      const title = String(a.title ?? '').trim();
      const row = await prisma.todoItem.findFirst({
        where: { tripId, title: { contains: title, mode: 'insensitive' } },
      });
      if (!row) return { action: name, summary: `To-do item "${title}" not found`, ok: false };

      await prisma.todoItem.delete({ where: { id: row.id } });
      return { action: name, summary: `Deleted to-do item "${row.title}"`, ok: true };
    }

    // ---------------- 7. Journal Entries ----------------
    if (name === 'list_journal_entries') {
      const entries = await prisma.journalEntry.findMany({
        where: { tripId },
        orderBy: { date: 'asc' },
      });
      const summary = `Found ${entries.length} journal entry/entries:\n` +
        entries.map((e) => `- [${e.id}] "${e.title}"${e.date ? ` (${toDayKey(e.date)})` : ''}`).join('\n');
      return { action: name, summary, ok: true, data: entries };
    }

    if (name === 'add_journal_entry') {
      const title = String(a.title ?? '').trim();
      const body = String(a.body ?? '').trim();
      if (!title || !body) return { action: name, summary: 'add_journal_entry: title and body required', ok: false };

      const entry = await prisma.journalEntry.create({
        data: {
          tripId,
          userId,
          title,
          body,
          date: toDate(a.date),
        },
      });
      return { action: name, summary: `Added journal entry "${entry.title}"`, ok: true };
    }

    if (name === 'update_journal_entry') {
      const journalId = typeof a.journalId === 'string' ? a.journalId.trim() : '';
      const titleQuery = typeof a.title === 'string' ? a.title.trim() : '';

      let target = journalId ? await prisma.journalEntry.findUnique({ where: { id: journalId } }) : null;
      if (!target && titleQuery) {
        target = await prisma.journalEntry.findFirst({
          where: { tripId, title: { contains: titleQuery, mode: 'insensitive' } },
        });
      }

      if (!target) return { action: name, summary: `Journal entry "${journalId || titleQuery}" not found`, ok: false };

      const data: Record<string, unknown> = {};
      if (typeof a.newTitle === 'string' && a.newTitle.trim()) data.title = a.newTitle.trim();
      if (typeof a.body === 'string') data.body = a.body.trim();
      if (a.date !== undefined) data.date = toDate(a.date) ?? null;

      const updated = await prisma.journalEntry.update({ where: { id: target.id }, data });
      return { action: name, summary: `Updated journal entry "${updated.title}"`, ok: true };
    }

    if (name === 'delete_journal_entry') {
      const journalId = typeof a.journalId === 'string' ? a.journalId.trim() : '';
      const titleQuery = typeof a.title === 'string' ? a.title.trim() : '';

      let target = journalId ? await prisma.journalEntry.findUnique({ where: { id: journalId } }) : null;
      if (!target && titleQuery) {
        target = await prisma.journalEntry.findFirst({
          where: { tripId, title: { contains: titleQuery, mode: 'insensitive' } },
        });
      }

      if (!target) return { action: name, summary: `Journal entry "${journalId || titleQuery}" not found`, ok: false };

      await prisma.journalEntry.delete({ where: { id: target.id } });
      return { action: name, summary: `Deleted journal entry "${target.title}"`, ok: true };
    }

    // ---------------- 8. Suggestions ----------------
    if (name === 'get_suggestions') {
      const location = String(a.location ?? ctx.destination ?? '').trim();
      if (!location) return { action: name, summary: 'get_suggestions: location required', ok: false };
      const focus = String(a.query ?? '').trim();
      const count = Math.min(Number(a.count) || 16, 20);
      const query = focus ? `${location} ${focus}` : `${location} things to see top attractions`;
      let suggestions = suggestionCache.get(query);
      if (!suggestions) {
        suggestions = await fetchSuggestions(query, Math.max(count, 16));
        suggestionCache.set(query, suggestions);
      }
      if (!suggestions.length) {
        return { action: name, summary: `No suggestions found for "${query}"`, ok: false };
      }
      const contextualSuggestions = suggestions.map((suggestion) => ({
        ...suggestion,
        dayId: ctx.recommendationContext?.dayId,
        recommendedAt: ctx.recommendationContext?.recommendedAt,
        context: ctx.recommendationContext?.label,
      }));
      return {
        action: name,
        summary: `Found ${contextualSuggestions.length} suggestions for "${query}"`,
        ok: true,
        suggestions: contextualSuggestions,
      };
    }

    return { action: name, summary: `Unknown tool: ${name}`, ok: false };
  } catch (e) {
    console.error('[tripTools] error running tool', name, e);
    return { action: name, summary: `Tool ${name} failed: ${(e as Error).message}`, ok: false };
  }
}
