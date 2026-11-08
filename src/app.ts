import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import mongoSanitize from 'express-mongo-sanitize';
import hpp from 'hpp';
import compression from 'compression';
import mongoose from 'mongoose';
import { env } from './config/env';
import { logger } from './config/logger';
import { HttpStatus } from './config/httpStatus';
import { requestLogger } from './middleware/logger';
import {
  errorHandler,
  notFoundHandler,
} from './middleware/errorHandler';
import { xssSanitizer } from './middleware/xss';
import { arcjetMiddleware } from './lib/arcjet';
import { sendData } from './lib/response';

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', env.TRUST_PROXY);

app.use(
  helmet({
    hsts: env.NODE_ENV === 'production'
      ? {
          maxAge: 31536000,
          includeSubDomains: true,
          preload: true,
        }
      : false,
    contentSecurityPolicy: env.NODE_ENV === 'production' ? undefined : false,
  })
);
app.use(
  cors({
    origin: env.FRONTEND_ORIGIN,
    credentials: true,
  })
);
app.use(compression());

// Arcjet: fails open by default so an Arcjet outage never takes the API down.
// /health and /v1/callbacks/* are excluded: uptime monitors and ayeT's
// server-to-server callbacks are automated clients that must never see bot rules.
if (env.ARCJET_KEY) {
  app.use(async (req, res, next) => {
    if (req.path === '/health' || req.path.startsWith('/v1/callbacks')) {
      next();
      return;
    }

    try {
      const decision = await arcjetMiddleware.protect(req);
      if (decision.isDenied()) {
        if (decision.reason.isRateLimit()) {
          res.status(HttpStatus.TOO_MANY_REQUESTS).json({ error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Too many requests' } });
          return;
        } else if (decision.reason.isBot()) {
          res.status(HttpStatus.FORBIDDEN).json({ error: { code: 'BLOCKED', message: 'Bot detected' } });
          return;
        } else {
          res.status(HttpStatus.FORBIDDEN).json({ error: { code: 'BLOCKED', message: 'Request blocked by Arcjet' } });
          return;
        }
      }
      next();
    } catch (err) {
      logger.error({ err }, 'Arcjet protect failed, failing open');
      next();
    }
  });
}

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));
app.use(cookieParser());
app.use(xssSanitizer);
app.use(
  mongoSanitize({
    replaceWith: '_',
    onSanitize: ({ req, key }) => {
      logger.warn({ method: req.method, path: req.path, key }, 'Sanitized key');
    },
  })
);
app.use(hpp());

app.use(requestLogger);

// Health check endpoint
app.get('/health', (_req, res) => {
  const isDbConnected = mongoose.connection.readyState === 1;

  if (isDbConnected) {
    sendData(res, { status: 'ok', environment: env.NODE_ENV });
  } else {
    sendData(
      res,
      { status: 'unhealthy', environment: env.NODE_ENV },
      HttpStatus.SERVICE_UNAVAILABLE
    );
  }
});

app.use(notFoundHandler);
app.use(errorHandler);

export { app };
