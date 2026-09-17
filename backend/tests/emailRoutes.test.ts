import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const db = vi.hoisted(() => ({
  emailConnection: { findUnique: vi.fn(), upsert: vi.fn() },
  emailImport: { count: vi.fn(), groupBy: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  trip: { findUnique: vi.fn(), create: vi.fn() },
  booking: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock('../src/db.js', () => ({ prisma: db }));
vi.mock('../src/services/dayReconciliation.js', () => ({ reconcileTripDays: vi.fn().mockResolvedValue({}) }));
vi.mock('../src/services/kitinerary.js', () => ({ extractKitinerary: vi.fn().mockResolvedValue([]), needsEmailAiCompletion: (candidates: Array<{ type: string; startAt?: string; endAt?: string }>) => !candidates.length || candidates.some((candidate) => candidate.type === 'hotel' && (!candidate.startAt || !candidate.endAt)) }));
vi.mock('../src/services/emailLlmParser.js', () => ({ extractEmailWithLlm: vi.fn().mockResolvedValue({ candidates: [] }) }));

import { extractEmailWithLlm } from '../src/services/emailLlmParser.js';
import { extractKitinerary } from '../src/services/kitinerary.js';

import { emailRouter } from '../src/routes/email.routes.js';
import { errorHandler } from '../src/lib/errors.js';

const app = express();
app.use(express.json());
app.use('/email', emailRouter);
app.use(errorHandler);

function token(userId: string): string {
  return jwt.sign({ userId, email: `${userId}@example.com`, name: userId, isAdmin: false }, process.env.JWT_SECRET || 'test');
}

describe('personal email review queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(extractEmailWithLlm).mockResolvedValue({ candidates: [] });
    vi.mocked(extractKitinerary).mockResolvedValue([]);
    db.emailConnection.findUnique.mockResolvedValue(null);
    db.emailImport.count.mockResolvedValue(0);
    db.emailImport.groupBy.mockResolvedValue([]);
    db.emailImport.findMany.mockResolvedValue([]);
    db.emailImport.findFirst.mockResolvedValue(null);
    db.trip.findUnique.mockResolvedValue({ ownerId: 'user-one', members: [] });
    db.$transaction.mockImplementation((callback: (tx: typeof db) => Promise<unknown>) => callback(db));
  });

  it('lists only the signed-in user’s captured emails', async () => {
    const response = await request(app).get('/email/imports').set('Authorization', `Bearer ${token('user-one')}`);
    expect(response.status).toBe(200);
    expect(db.emailImport.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'user-one' } }));
  });

  it('does not reveal another user’s email by ID, even to a signed-in user', async () => {
    const response = await request(app).get('/email/imports/other-email').set('Authorization', `Bearer ${token('user-one')}`);
    expect(response.status).toBe(404);
    expect(db.emailImport.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'other-email', userId: 'user-one' } }));
  });

  it('does not approve another user’s captured email into an accessible trip', async () => {
    const response = await request(app).post('/email/imports/other-email/assign')
      .set('Authorization', `Bearer ${token('user-one')}`)
      .send({ tripId: 'owned-trip' });
    expect(response.status).toBe(404);
    expect(db.emailImport.findFirst).toHaveBeenCalledWith({ where: { id: 'other-email', userId: 'user-one' } });
  });

  it('saves an encrypted Gmail credential only for the signed-in user', async () => {
    const response = await request(app).patch('/email/connection')
      .set('Authorization', `Bearer ${token('user-one')}`)
      .send({ username: 'person@gmail.com', recipient: 'person+trips@gmail.com', appPassword: 'abcd efgh', enabled: false });
    expect(response.status).toBe(200);
    expect(db.emailConnection.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'user-one' },
      create: expect.objectContaining({ userId: 'user-one', username: 'person@gmail.com', recipient: 'person+trips@gmail.com' }),
    }));
    const saved = db.emailConnection.upsert.mock.calls[0][0].create.secret as string;
    expect(saved).toMatch(/^v1:/);
    expect(saved).not.toContain('abcd');
    expect(response.body).not.toHaveProperty('appPassword');
  });

  it('creates a trip and hotel booking from an approved email with local check-in and check-out times', async () => {
    const item = {
      id: 'hotel-email', userId: 'user-one', status: 'parsed', subject: 'Alaska hotel', type: 'hotel',
      parsedPayload: {
        source: 'fallback', title: 'Alaska Lodge', type: 'hotel',
        startAt: '2026-12-13T15:00:00.000Z', endAt: '2026-12-15T11:00:00.000Z',
        details: { localStartAt: '2026-12-13T15:00', localEndAt: '2026-12-15T11:00' },
      },
    };
    db.emailImport.findFirst.mockResolvedValue(item);
    db.emailImport.findUnique.mockResolvedValue(item);
    db.emailImport.updateMany.mockResolvedValue({ count: 1 });
    db.trip.create.mockResolvedValue({ id: 'new-trip', name: 'Alaska trip' });
    db.booking.findFirst.mockResolvedValue(null);
    db.booking.create.mockResolvedValue({ id: 'new-booking' });
    const response = await request(app).post('/email/imports/hotel-email/assign')
      .set('Authorization', `Bearer ${token('user-one')}`)
      .send({ newTrip: { name: 'Alaska trip', destination: 'Alaska' } });
    expect(response.status).toBe(201);
    expect(response.body.trip).toEqual({ id: 'new-trip', name: 'Alaska trip' });
    expect(db.trip.create).toHaveBeenCalledWith({ data: expect.objectContaining({ ownerId: 'user-one', startDate: new Date('2026-12-13T12:00:00Z'), endDate: new Date('2026-12-15T12:00:00Z') }) });
    expect(db.booking.create).toHaveBeenCalledWith({ data: expect.objectContaining({ tripId: 'new-trip', startAt: new Date('2026-12-13T15:00:00Z'), endAt: new Date('2026-12-15T11:00:00Z') }) });
  });

  it('does not duplicate a confirmed stay when its receipt has the same reference but date-only times', async () => {
    const item = {
      id: 'receipt-email', userId: 'user-one', status: 'parsed', subject: 'Fwd: This is your receipt', type: 'hotel',
      parsedPayload: { source: 'email-evidence', candidates: [{ source: 'email-evidence', type: 'hotel', title: 'Example Harbor Hotel', reference: '9000001234', startAt: '2027-02-10', endAt: '2027-02-12', details: {} }] },
    };
    db.emailImport.findFirst.mockResolvedValue(item);
    db.emailImport.findUnique.mockResolvedValue(item);
    db.emailImport.updateMany.mockResolvedValue({ count: 1 });
    db.booking.findFirst.mockResolvedValue({ id: 'original-booking' });
    const response = await request(app).post('/email/imports/receipt-email/assign')
      .set('Authorization', `Bearer ${token('user-one')}`).send({ tripId: 'owned-trip' });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ skipped: 1, bookings: [] });
    expect(db.booking.findFirst).toHaveBeenCalledWith({ where: { tripId: 'owned-trip', type: 'hotel', reference: { equals: '9000001234', mode: 'insensitive' } }, select: { id: true } });
    expect(db.booking.create).not.toHaveBeenCalled();
  });

  it('reports the parser result while keeping an imported email linked to its trip', async () => {
    vi.mocked(extractEmailWithLlm).mockResolvedValue({ candidates: [{ source: 'llm', type: 'hotel', title: 'Alaska Lodge', startAt: '2026-12-13T15:00', endAt: '2026-12-15T11:00', details: { localStartAt: '2026-12-13T15:00', localEndAt: '2026-12-15T11:00' } }] });
    db.emailImport.findFirst.mockResolvedValue({ id: 'hotel-email', userId: 'user-one', status: 'imported', tripId: 'trip-one', subject: 'Alaska hotel booking', bodyText: 'Check-in: December 13, 2026 at 3 PM. Check-out: December 15, 2026 at 11 AM.', bodyHtml: '', parsedPayload: null });
    db.emailImport.update.mockImplementation(async ({ data }: { data: { status: string; parsedPayload: unknown } }) => ({ id: 'hotel-email', status: data.status, parsedPayload: data.parsedPayload, trip: { id: 'trip-one', name: 'Alaska trip' } }));
    const response = await request(app).post('/email/imports/hotel-email/reparse')
      .set('Authorization', `Bearer ${token('user-one')}`).send({});
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ parser: 'AI extraction', reservations: 1, changed: true, item: { status: 'imported', trip: { id: 'trip-one' } } });
    expect(response.body.item.parsedPayload.candidates[0].details).toMatchObject({ localStartAt: '2026-12-13T15:00', localEndAt: '2026-12-15T11:00' });
  });

  it('reports an AI extraction error and keeps an unparsed email in review', async () => {
    vi.mocked(extractEmailWithLlm).mockResolvedValue({ candidates: [], error: 'AI extraction is disabled.' });
    db.emailImport.findFirst.mockResolvedValue({ id: 'hotel-email', userId: 'user-one', status: 'pending', subject: 'Hotel', bodyText: 'Booking', bodyHtml: '', parsedPayload: null });
    db.emailImport.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'hotel-email', ...data }));
    const response = await request(app).post('/email/imports/hotel-email/reparse')
      .set('Authorization', `Bearer ${token('user-one')}`).send({});
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ parser: 'AI extraction', reservations: 0, item: { status: 'needs_review', error: 'AI extraction is disabled.' } });
  });

  it('rebuilds blank saved text from the original HTML email before AI extraction', async () => {
    const original = Buffer.from([
      'From: traveler@example.com', 'To: tneidinger+trips@gmail.com', 'Subject: Fwd: This is your receipt',
      'MIME-Version: 1.0', 'Content-Type: text/html; charset=utf-8', '',
      '<p>Booking.com receipt</p><table><tr><td>Booking number</td><td>9000001234</td></tr><tr><td>Property name</td><td>Example Harbor Hotel</td></tr></table>',
    ].join('\r\n'));
    db.emailImport.findFirst.mockResolvedValue({ id: 'receipt-email', userId: 'user-one', status: 'needs_review', subject: 'Fwd: This is your receipt', bodyText: '', bodyHtml: '', rawSource: new Uint8Array(original), parsedPayload: null });
    db.emailImport.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'receipt-email', ...data }));
    const response = await request(app).post('/email/imports/receipt-email/reparse')
      .set('Authorization', `Bearer ${token('user-one')}`).send({});
    expect(response.status).toBe(200);
    expect(extractEmailWithLlm).toHaveBeenCalledWith('Fwd: This is your receipt', expect.stringContaining('Booking number 9000001234'));
    expect(response.body.item.bodyText).toContain('Example Harbor Hotel');
  });

  it('uses AI to complete a hotel when KItinerary only finds a partial reservation', async () => {
    vi.mocked(extractKitinerary).mockResolvedValue([{ source: 'kitinerary', type: 'hotel', title: 'Example Harbor Hotel', reference: '9000001234', details: {} }]);
    vi.mocked(extractEmailWithLlm).mockResolvedValue({ candidates: [{ source: 'llm', type: 'hotel', title: 'Example Harbor Hotel', reference: '9000001234', startAt: '2027-02-10T15:00', endAt: '2027-02-12T10:00', price: 123.45, currency: 'EUR', details: {} }] });
    db.emailImport.findFirst.mockResolvedValue({ id: 'bari-email', userId: 'user-one', status: 'needs_review', subject: 'Fwd: Example Harbor Hotel', bodyText: 'Confirmation: 9000001234', bodyHtml: '', parsedPayload: null });
    db.emailImport.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'bari-email', ...data }));
    const response = await request(app).post('/email/imports/bari-email/reparse')
      .set('Authorization', `Bearer ${token('user-one')}`).send({});
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ parser: 'AI extraction', reservations: 1, item: { status: 'parsed', parsedPayload: { source: 'llm', candidates: [{ startAt: '2027-02-10T15:00', endAt: '2027-02-12T10:00', price: 123.45 }] } } });
  });

  it('applies reparsed dates only to a booking linked to that email', async () => {
    db.emailImport.findFirst.mockResolvedValue({ id: 'hotel-email', userId: 'user-one', status: 'imported', tripId: 'trip-one', parsedPayload: {
      title: 'Alaska Lodge', startAt: '2026-12-13T15:00:00.000Z', endAt: '2026-12-15T11:00:00.000Z',
      details: { localStartAt: '2026-12-13T15:00', localEndAt: '2026-12-15T11:00' },
    } });
    db.booking.findMany.mockResolvedValue([{ id: 'hotel-booking', title: 'Alaska Lodge', reference: null, details: {} }]);
    db.booking.update.mockResolvedValue({ id: 'hotel-booking' });
    const response = await request(app).post('/email/imports/hotel-email/apply-dates')
      .set('Authorization', `Bearer ${token('user-one')}`).send({});
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ updated: 1 });
    expect(db.booking.findMany).toHaveBeenCalledWith({ where: { tripId: 'trip-one', sourceImportId: 'hotel-email' } });
    expect(db.booking.update).toHaveBeenCalledWith({ where: { id: 'hotel-booking' }, data: expect.objectContaining({
      startAt: new Date('2026-12-13T15:00:00Z'), endAt: new Date('2026-12-15T11:00:00Z'), updatedById: 'user-one',
    }) });
  });
});
