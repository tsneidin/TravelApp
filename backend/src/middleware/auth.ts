import { verifyToken } from '../lib/jwt.js';
import { badRequest, unauthorized } from '../lib/errors.js';
import { prisma } from '../db.js';
import type { Request } from 'express';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  isAdmin: boolean;
}

export function getUser(req: Request): AuthUser {
  const header = req.headers.authorization ?? '';
  const queryToken = typeof req.query?.token === 'string' ? req.query.token : '';
  const token = header.replace(/^Bearer\s+/i, '').trim() || queryToken;
  if (!token) throw unauthorized('Missing bearer token');
  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    throw unauthorized('Invalid or expired token');
  }
  return {
    id: payload.userId,
    email: payload.email,
    name: payload.name,
    isAdmin: payload.isAdmin,
  };
}

/**
 * Validates that `user` has access to `tripId`, enforcing an optional role floor.
 * Admins always pass. Throws an HttpError otherwise.
 */
export async function requireTripAccess(
  req: Request,
  tripId: string,
  minRole: 'owner' | 'editor' | 'viewer' = 'viewer',
): Promise<AuthUser> {
  const user = getUser(req);
  if (user.isAdmin) return user;

  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: { members: { select: { userId: true, role: true } } },
  });
  if (!trip) throw badRequest('Trip not found');

  const rank: Record<string, number> = { viewer: 0, editor: 1, owner: 2 };
  if (trip.ownerId === user.id) {
    return user; // owner holds the highest role
  }
  const member = trip.members.find((m) => m.userId === user.id);
  if (!member) throw unauthorized('You are not a member of this trip');
  if (rank[member.role] < rank[minRole]) throw unauthorized('Insufficient role for this action');
  return user;
}

export function requireFields(req: Request, fields: string[]): void {
  for (const f of fields) {
    const v = req.body[f];
    if (v === undefined || v === null || v === '') {
      throw badRequest(`${f} is required`);
    }
  }
}