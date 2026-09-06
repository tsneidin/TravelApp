import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { asyncHandler, badRequest, notFound, unauthorized } from '../lib/errors.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { signToken } from '../lib/jwt.js';
import { prisma } from '../db.js';
import { getUser } from '../middleware/auth.js';
import { config } from '../config.js';
import { z } from 'zod';

export const authRouter = Router();

fs.mkdirSync(config.uploadDir, { recursive: true });
const avatarStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, config.uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname ?? '').slice(0, 12);
    cb(null, `avatar-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});
const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      cb(new Error('Only image files are allowed for avatars'));
      return;
    }
    cb(null, true);
  },
});

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
      user: pubUser(user),
      memberships: user.memberships,
      ownsTrips: user.ownsTrips,
    });
  }),
);

authRouter.patch(
  '/profile',
  asyncHandler(async (req, res) => {
    const u = getUser(req);
    const data: Record<string, unknown> = {};
    if (typeof req.body.name === 'string' && req.body.name.trim()) {
      data.name = req.body.name.trim();
    }
    if (req.body.avatarUrl !== undefined) {
      data.avatarUrl = req.body.avatarUrl ? String(req.body.avatarUrl) : null;
    }
    if (req.body.settings !== undefined) {
      data.settings = req.body.settings;
    }
    const updated = await prisma.user.update({
      where: { id: u.id },
      data,
    });
    res.json({ user: pubUser(updated) });
  }),
);

authRouter.post(
  '/avatar',
  avatarUpload.single('file'),
  asyncHandler(async (req, res) => {
    const u = getUser(req);
    if (!req.file) throw badRequest('No avatar image uploaded');
    const avatarUrl = `/api/uploads/${encodeURIComponent(req.file.filename)}`;
    const updated = await prisma.user.update({
      where: { id: u.id },
      data: { avatarUrl },
    });
    res.json({ avatarUrl, user: pubUser(updated) });
  }),
);

authRouter.post(
  '/change-password',
  asyncHandler(async (req, res) => {
    const u = getUser(req);
    const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };
    if (!currentPassword || !newPassword) throw badRequest('currentPassword and newPassword are required');
    if (newPassword.length < 8) throw badRequest('New password must be at least 8 characters');

    const user = await prisma.user.findUnique({ where: { id: u.id } });
    if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
      throw unauthorized('Current password incorrect');
    }

    await prisma.user.update({
      where: { id: u.id },
      data: { passwordHash: await hashPassword(newPassword) },
    });
    res.json({ ok: true });
  }),
);

function pubUser(u: { id: string; email: string; name: string; isAdmin: boolean; avatarUrl?: string | null; settings?: unknown }) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    isAdmin: u.isAdmin,
    avatarUrl: u.avatarUrl ?? null,
    settings: (u.settings as Record<string, unknown>) ?? null,
  };
}