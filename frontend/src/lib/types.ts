export interface User {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
}

export interface Trip {
  id: string;
  name: string;
  destination: string;
  description?: string | null;
  coverUrl?: string | null;
  currency: string;
  startDate?: string | null;
  endDate?: string | null;
  createdAt: string;
  updatedAt: string;
  ownerId: string;
  owner?: { id: string; name: string; email: string };
  members?: TripMember[];
  days?: Day[];
  places?: Place[];
  bookings?: Booking[];
  expenses?: Expense[];
  packing?: PackingItem[];
  journal?: JournalEntry[];
  photos?: Photo[];
  _count?: { places: number; expenses: number };
}

export interface TripMember {
  id: string;
  role: 'owner' | 'editor' | 'viewer';
  userId: string;
  user?: { id: string; email: string; name: string };
}

export interface Day {
  id: string;
  tripId: string;
  label?: string | null;
  date: string;
  notes?: string | null;
  sortOrder: number;
  places: Place[];
}

export interface Place {
  id: string;
  tripId: string;
  name: string;
  category?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  notes?: string | null;
  website?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  sortOrder: number;
  dayId?: string | null;
}

export type BookingType = 'flight' | 'hotel' | 'car' | 'activity';

export interface Booking {
  id: string;
  tripId: string;
  type: BookingType;
  title: string;
  provider?: string | null;
  reference?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  details?: Record<string, unknown> | null;
  sourceImportId?: string | null;
}

export interface Expense {
  id: string;
  tripId: string;
  description: string;
  category: string;
  amount: number;
  currency: string;
  date?: string | null;
  createdAt: string;
}

export interface PackingItem {
  id: string;
  tripId: string;
  category?: string | null;
  item: string;
  done: boolean;
  sortOrder: number;
}

export interface JournalEntry {
  id: string;
  tripId: string;
  title: string;
  body: string;
  date?: string | null;
  createdAt: string;
}

export interface Photo {
  id: string;
  caption?: string | null;
  filename: string;
  placeId?: string | null;
  createdAt: string;
  url: string;
}

export type ImportStatus = 'pending' | 'parsed' | 'needs_review' | 'imported' | 'ignored' | 'failed';

export interface EmailImport {
  id: string;
  messageId: string;
  from: string;
  to?: string | null;
  subject: string;
  bodyText?: string | null;
  status: ImportStatus;
  type?: BookingType | null;
  parsedPayload?: {
    title?: string;
    provider?: string;
    reference?: string;
    startAt?: string;
    address?: string;
    details?: Record<string, string>;
    confidence?: number;
  } | null;
  error?: string | null;
  assignedAt?: string | null;
  createdAt: string;
  tripId?: string | null;
  trip?: { id: string; name: string };
}

export interface CalendarEvent {
  id: string;
  type: 'place' | 'booking';
  tripId: string;
  title: string;
  date: string;
  startAt?: string;
  endAt?: string;
  sortOrder: number;
  placeId?: string;
  bookingType?: string;
  dayId?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface AiStatus {
  enabled: boolean;
  baseUrl?: string | null;
  model?: string | null;
  configured: boolean;
}

export interface Suggestion {
  title: string;
  url?: string;
  thumbnail?: string;
  summary?: string;
  lat?: number;
  lng?: number;
}

export interface AiAction {
  action: string;
  summary: string;
  ok: boolean;
  suggestions?: Suggestion[];
}