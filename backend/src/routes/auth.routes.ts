import { Router } from 'express';
import { asyncHandler, badRequest, notFound, unauthorized } from '../lib/errors.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { signToken } from '../lib/jwt.js';
import { prisma } from '../db.js';
import { getUser } from '../middleware/auth.js';
import { z } from 'zod';

export const authRouter = Router();

const registerSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(120),
  password: z.string().min(8).max(200),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      throw badRequest(parsed.error.errors.map((e) => e.path[0]).join(', '));
    }
    const existing = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
    if (existing) throw unauthorized('Email already registered');
    const count = await prisma.user.count();
    const user = await prisma.user.create({
      data: {
        email: parsed.data.email.toLowerCase(),
        name: parsed.data.name,
        passwordHash: await hashPassword(parsed.data.password),
        // first ever account becomes admin
        isAdmin: count === 0,
      },
    });
    res.status(201).json({ token: signToken(user), user: pubUser(user) });
  }),
);

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('Invalid credentials');
    const user = await prisma.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } });
    if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
      throw unauthorized('Invalid email or password');
    }
    res.json({ token: signToken(user), user: pubUser(user) });
  }),
);

// Convenience: if an admin bootstraps via env and no users exist yet, allow seeding.
authRouter.post(
  '/bootstrap',
  asyncHandler(async (req, res) => {
    const { email, password, name } = req.body as { email?: string; password?: string; name?: string };
    const count = await prisma.user.count();
    if (count > 0) throw unauthorized('User bootstrap only allowed on an empty database');
    if (!email || !password) throw badRequest('email and password required');
    const user = await prisma.user.create({
      data: {
        email: email.toLowerCase(),
        name: name || 'Admin',
        passwordHash: await hashPassword(password),
        isAdmin: true,
      },
    });
    res.status(201).json({ token: signToken(user), user: pubUser(user) });
  }),
);

authRouter.get(
  '/me',
  asyncHandler(async (req, res) => {
    const u = getUser(req);
    const user = await prisma.user.findUnique({
      where: { id: u.id },
      include: {
        memberships: { include: { trip: true } },
        ownsTrips: true,
      },
    });
    if (!user) throw notFound('User not found');
    res.json({
      user: { id: user.id, email: user.email, name: user.name, isAdmin: user.isAdmin },
      memberships: user.memberships,
      ownsTrips: user.ownsTrips,
    });
  }),
);

function pubUser(u: { id: string; email: string; name: string; isAdmin: boolean }) {
  return { id: u.id, email: u.email, name: u.name, isAdmin: u.isAdmin };
}