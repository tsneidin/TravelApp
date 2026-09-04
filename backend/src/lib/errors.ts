import type { NextFunction, Request, Response } from 'express';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function notFound(msg = 'Not found'): HttpError {
  return new HttpError(404, msg);
}

export function badRequest(msg: string): HttpError {
  return new HttpError(400, msg);
}

export function unauthorized(msg = 'Unauthorized'): HttpError {
  return new HttpError(401, msg);
}

export function forbidden(msg = 'Forbidden'): HttpError {
  return new HttpError(403, msg);
}

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

/** Wraps an async handler and forwards rejections to Express error handling. */
export function asyncHandler(fn: Handler) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error('[error]', err);
  res.status(500).json({ error: 'Internal server error' });
}