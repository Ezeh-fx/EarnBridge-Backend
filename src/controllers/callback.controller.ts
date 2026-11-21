import { Request, Response } from 'express';
import { env } from '../config/env.js';
import { HttpStatus } from '../config/httpStatus.js';
import { verifyAyetCallback } from '../lib/ayet.js';
import { sendData } from '../lib/response.js';
import { AppError } from '../lib/errors.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { processAyetCallback } from '../services/callback.service.js';

const SECURITY_HASH_HEADER = 'x-ayetstudios-security-hash';

const isIpAllowed = (req: Request): boolean => {
  const whitelist = (env.AYET_CALLBACK_IP_WHITELIST ?? '')
    .split(',')
    .map((ip) => ip.trim())
    .filter(Boolean);

  if (whitelist.length === 0) {
    return true;
  }

  return whitelist.includes(req.ip ?? '');
};

// Public server-to-server endpoint called by ayeT. Not authenticated and
// excluded from Arcjet bot rules in app.ts; protection is the IP allowlist
// (when configured) plus the HMAC signature on the raw query string.
export const ayetCallback = asyncHandler(
  async (req: Request, res: Response) => {
    if (!isIpAllowed(req)) {
      throw AppError.forbidden(
        'CALLBACK_IP_DENIED',
        'Callback source is not allowed'
      );
    }

    if (!env.AYET_CALLBACK_SECRET) {
      throw AppError.serviceUnavailable(
        'CALLBACK_NOT_CONFIGURED',
        'Callback verification is not configured'
      );
    }

    const queryStart = req.originalUrl.indexOf('?');
    const rawQuery =
      queryStart === -1 ? '' : req.originalUrl.slice(queryStart + 1);
    const signature = req.get(SECURITY_HASH_HEADER);

    const values = verifyAyetCallback(
      rawQuery,
      signature,
      env.AYET_CALLBACK_SECRET
    );

    if (!values) {
      throw AppError.forbidden(
        'INVALID_SIGNATURE',
        'Invalid callback signature'
      );
    }

    const outcome = await processAyetCallback(values, rawQuery);

    // ayeT requires HTTP 200 for every verified callback, including safe
    // duplicates and valid-but-unprocessable ones, or it will retry.
    sendData(res, { status: outcome }, HttpStatus.OK);
  }
);
