import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { authRouter } from './routes/auth.routes.js';
import { tripsRouter } from './routes/trips.routes.js';
import { contentRouter } from './routes/content.routes.js';
import { calendarRouter } from './routes/calendar.routes.js';
import { emailRouter } from './routes/email.routes.js';
import { aiRouter } from './routes/ai.routes.js';
import { placesRouter } from './routes/places.routes.js';
import { errorHandler } from './lib/errors.js';

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));

  // Serve uploaded images
  app.use('/uploads', express.static(config.uploadDir));

  app.get('/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

  app.use('/auth', authRouter);
  app.use('/trips', tripsRouter);
  app.use('/trips', contentRouter);
  app.use('/trips', aiRouter);
  app.use('/places', placesRouter);
  app.use('/calendar', calendarRouter);
  app.use('/email', emailRouter);

  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use(errorHandler);

  return app;
}

// ensure upload dir exists on import
fs.mkdirSync(path.resolve(config.uploadDir), { recursive: true });