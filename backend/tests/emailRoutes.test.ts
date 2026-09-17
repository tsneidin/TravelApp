import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const db = vi.hoisted(() => ({
  emailConnection: { findUnique: vi.fn(), upsert: vi.fn() },
  emailImport: { count: vi.fn(), groupBy: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
  trip: { findUnique: vi.fn() },
}));
vi.mock('../src/db.js', () => ({ prisma: db }));

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
    db.emailConnection.findUnique.mockResolvedValue(null);
    db.emailImport.count.mockResolvedValue(0);
    db.emailImport.groupBy.mockResolvedValue([]);
    db.emailImport.findMany.mockResolvedValue([]);
    db.emailImport.findFirst.mockResolvedValue(null);
    db.trip.findUnique.mockResolvedValue({ ownerId: 'user-one', members: [] });
  });

  it('lists only the signed-in user’s captured emails', async () => {
    const response = await request(app).get('/email/imports').set('Authorization', `Bearer ${token('user-one')}`);
    expect(response.status).toBe(200);
    expect(db.emailImport.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'user-one' } }));
  });

  it('does not reveal another user’s email by ID, even to a signed-in user', async () => {
    const response = await request(app).get('/email/imports/other-email').set('Authorization', `Bearer ${token('user-one')}`);
    expect(response.status).toBe(404);
    expect(db.emailImport.findFirst).toHaveBeenCalledWith({ where: { id: 'other-email', userId: 'user-one' } });
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
});
