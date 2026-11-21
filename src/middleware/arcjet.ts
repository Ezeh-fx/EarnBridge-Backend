import type { ArcjetNode } from '@arcjet/node';
import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { AppError } from '../lib/errors.js';
import { asyncHandler } from './asyncHandler.js';

interface ArcjetProtectOptions {
  failClosed?: boolean;
  props?: (req: Request) => Record<string, unknown>;
}

export const arcjetProtect = (
  client: ArcjetNode<Record<string, unknown>>,
  options: ArcjetProtectOptions = {}
) =>
  asyncHandler(async (req: Request, _res: Response, next: NextFunction) => {
    if (!env.ARCJET_KEY) {
      if (env.NODE_ENV === 'production' && options.failClosed) {
        logger.error('ARCJET_KEY is not configured, failing closed');
        throw AppError.serviceUnavailable(
          'ARCJET_UNAVAILABLE',
          'Security check is temporarily unavailable'
        );
      }

      next();
      return;
    }

    let decision;
    try {
      decision = await client.protect(req, {
        requested: 1,
        ...options.props?.(req),
      });
    } catch (err) {
      if (options.failClosed) {
        logger.error({ err }, 'Arcjet protect failed, failing closed');
        throw AppError.serviceUnavailable(
          'ARCJET_UNAVAILABLE',
          'Security check is temporarily unavailable'
        );
      }

      logger.error({ err }, 'Arcjet protect failed, failing open');
      next();
      return;
    }

    if (decision.isDenied()) {
      if (decision.reason.isRateLimit()) {
        throw AppError.tooManyRequests(
          'RATE_LIMIT_EXCEEDED',
          'Too many requests'
        );
      }

      if (decision.reason.isBot()) {
        const reason = decision.reason;
        logger.warn(
          {
            deniedBots: reason.denied,
            verified: reason.verified,
            spoofed: reason.spoofed,
            path: req.path,
          },
          'Arcjet bot detected'
        );
        throw AppError.forbidden('BLOCKED', 'Bot detected');
      }

      throw AppError.forbidden('BLOCKED', 'Request blocked by Arcjet');
    }

    if (decision.isErrored()) {
      if (options.failClosed) {
        logger.error(
          { err: decision.reason },
          'Arcjet decision errored, failing closed'
        );
        throw AppError.serviceUnavailable(
          'ARCJET_UNAVAILABLE',
          'Security check is temporarily unavailable'
        );
      }

      logger.error(
        { err: decision.reason },
        'Arcjet decision errored, failing open'
      );
    }

    next();
  });
