import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const allowedOrigins = new Set(
  [env.FRONTEND_ORIGIN, env.CLIENT_URL]
    .filter((origin): origin is string => Boolean(origin))
    .map((origin) => origin.replace(/\/+$/, ''))
);

// CSRF guard for cookie-authenticated requests. Production auth cookies use
// SameSite=None so browsers attach them to cross-site requests; unsafe
// methods must present an allowed Origin, or at minimum a non-cross-site
// Sec-Fetch-Site. Requests with neither header come from non-browser
// clients (curl, tests, server-to-server) and are allowed through.
export const csrfProtection = (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const origin = req.headers.origin;
  if (origin) {
    if (!allowedOrigins.has(origin)) {
      throw AppError.forbidden('INVALID_ORIGIN', 'Cross-site request blocked');
    }
    next();
    return;
  }

  if (req.headers['sec-fetch-site'] === 'cross-site') {
    throw AppError.forbidden('INVALID_ORIGIN', 'Cross-site request blocked');
  }

  next();
};
