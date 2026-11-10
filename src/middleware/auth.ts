import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { AUTH_COOKIES, ACCESS_TOKEN_TYPE } from '../config/constants';
import { AppError } from '../lib/errors';
import { User } from '../models/user.model';
import type { AccessTokenPayload, AuthenticatedUser } from '../types/auth.types';
import { asyncHandler } from './asyncHandler';

const isAccessTokenPayload = (payload: unknown): payload is AccessTokenPayload => {
  if (typeof payload !== 'object' || payload === null) {
    return false;
  }
  const p = payload as Record<string, unknown>;
  return (
    typeof p.sub === 'string' &&
    typeof p.publicId === 'string' &&
    p.type === ACCESS_TOKEN_TYPE
  );
};

export const requireAuth = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction) => {
    const token = req.cookies?.[AUTH_COOKIES.accessToken] as string | undefined;

    if (!token || typeof token !== 'string') {
      throw AppError.unauthorized('UNAUTHORIZED', 'Authentication required');
    }

    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET);

    if (!isAccessTokenPayload(payload)) {
      throw AppError.unauthorized('INVALID_TOKEN', 'Invalid access token');
    }

    const user = await User.findById(payload.sub);

    if (!user) {
      throw AppError.unauthorized('INVALID_TOKEN', 'Invalid access token');
    }

    if (user.status === 'suspended') {
      throw AppError.forbidden('ACCOUNT_SUSPENDED', 'This account is suspended');
    }

    if (user.status !== 'active') {
      throw AppError.unauthorized('UNAUTHORIZED', 'Authentication required');
    }

    const authenticatedUser: AuthenticatedUser = {
      id: user._id,
      publicId: user.publicId,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      status: user.status,
    };

    req.user = authenticatedUser;
    next();
  }
);

export const requireAdmin = (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  if (!req.user) {
    next(AppError.unauthorized('UNAUTHORIZED', 'Authentication required'));
    return;
  }

  if (req.user.role !== 'admin') {
    next(AppError.forbidden('FORBIDDEN', 'Admin access required'));
    return;
  }

  next();
};
