import { RequestHandler } from 'express';
import { z } from 'zod';
import { asyncHandler } from './asyncHandler.js';

export const validateBody = <T extends z.ZodTypeAny>(
  schema: T
): RequestHandler =>
  asyncHandler(async (req, _res, next) => {
    req.body = schema.parse(req.body);
    next();
  });
