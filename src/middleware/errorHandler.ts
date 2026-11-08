import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../lib/errors';
import { HttpStatus } from '../config/httpStatus';
import { env } from '../config/env';
import { logger } from '../config/logger';

interface NormalizedError {
  statusCode: number;
  code: string;
  message: string;
  isOperational: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const normalizeError = (err: unknown): NormalizedError => {
  if (err instanceof AppError) {
    return {
      statusCode: err.statusCode,
      code: err.code,
      message: err.message,
      isOperational: err.isOperational,
    };
  }

  if (err instanceof ZodError) {
    return {
      statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      isOperational: true,
    };
  }

  if (isRecord(err)) {
    if (err.name === 'CastError') {
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        code: 'INVALID_INPUT',
        message: 'Invalid input',
        isOperational: true,
      };
    }

    if (err.name === 'ValidationError') {
      return {
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        isOperational: true,
      };
    }

    if (err.code === 11000) {
      return {
        statusCode: HttpStatus.CONFLICT,
        code: 'DUPLICATE_ENTRY',
        message: 'Resource already exists',
        isOperational: true,
      };
    }

    if (
      err.name === 'JsonWebTokenError' ||
      err.name === 'TokenExpiredError' ||
      err.name === 'NotBeforeError'
    ) {
      return {
        statusCode: HttpStatus.UNAUTHORIZED,
        code: 'INVALID_TOKEN',
        message: 'Invalid or expired token',
        isOperational: true,
      };
    }

    const status = err.status ?? err.statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      return {
        statusCode: status,
        code: 'BAD_REQUEST',
        message:
          typeof err.message === 'string' && err.message.length > 0
            ? err.message
            : 'Bad request',
        isOperational: true,
      };
    }
  }

  return {
    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
    code: 'INTERNAL_SERVER_ERROR',
    message:
      env.NODE_ENV === 'production'
        ? 'Internal server error'
        : err instanceof Error
          ? err.message
          : 'Internal server error',
    isOperational: false,
  };
};

export const notFoundHandler = (req: Request, _res: Response, next: NextFunction) => {
  next(
    new AppError(
      HttpStatus.NOT_FOUND,
      'NOT_FOUND',
      `Route ${req.method} ${req.path} not found`
    )
  );
};

export const errorHandler = (
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  const normalized = normalizeError(err);

  if (normalized.statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
    logger.error(
      { err, method: req.method, path: req.path },
      'Unhandled request error'
    );
  } else {
    logger.warn(
      {
        code: normalized.code,
        statusCode: normalized.statusCode,
        method: req.method,
        path: req.path,
      },
      'Request error'
    );
  }

  res.status(normalized.statusCode).json({
    error: {
      code: normalized.code,
      message: normalized.message,
    },
  });
};

export const registerProcessHandlers = () => {
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'Unhandled promise rejection');
  });

  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception');
    process.exit(1);
  });
};
