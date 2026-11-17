import type { ArcjetNode } from '@arcjet/node';
import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';
import { HttpStatus } from '../config/httpStatus';
import { logger } from '../config/logger';
import { AppError } from '../lib/errors';
import { asyncHandler } from './asyncHandler';

interface ArcjetProtectOptions {
  failClosed?: boolean;
}

export const arcjetProtect = (
  client: ArcjetNode<Record<string, unknown>>,
  options: ArcjetProtectOptions = {}
) =>
  asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
    if (!env.ARCJET_KEY) {
      next();
      return;
    }

    try {
      const decision = await client.protect(req);

      if (decision.isDenied()) {
        if (decision.reason.isRateLimit()) {
          res.status(HttpStatus.TOO_MANY_REQUESTS).json({
            error: {
              code: 'RATE_LIMIT_EXCEEDED',
              message: 'Too many requests',
            },
          });
          return;
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
          res.status(HttpStatus.FORBIDDEN).json({
            error: { code: 'BLOCKED', message: 'Bot detected' },
          });
          return;
        }

        res.status(HttpStatus.FORBIDDEN).json({
          error: { code: 'BLOCKED', message: 'Request blocked by Arcjet' },
        });
        return;
      }

      next();
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
    }
  });
