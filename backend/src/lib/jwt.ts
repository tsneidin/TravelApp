import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import type { User } from '@prisma/client';

export interface AuthPayload {
  userId: string;
  email: string;
  name: string;
  isAdmin: boolean;
}

export function signToken(user: User): string {
  const payload: AuthPayload = {
    userId: user.id,
    email: user.email,
    name: user.name,
    isAdmin: user.isAdmin,
  };
  return jwt.sign(payload, config.jwtSecret, { expiresIn: '30d' });
}

export function verifyToken(token: string): AuthPayload {
  return jwt.verify(token, config.jwtSecret) as AuthPayload;
}