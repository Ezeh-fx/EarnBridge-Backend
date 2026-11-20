import express from 'express';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import mongoSanitize from 'express-mongo-sanitize';
import hpp from 'hpp';
import compression from 'compression';
import mongoose from 'mongoose';
import { fileURLToPath } from 'node:url';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { HttpStatus } from './config/httpStatus.js';
import { requestLogger } from './middleware/logger.js';
import {
  errorHandler,
  notFoundHandler,
} from './middleware/errorHandler.js';
import { xssSanitizer } from './middleware/xss.js';
import { csrfProtection } from './middleware/csrf.js';
import { arcjetMiddleware } from './lib/arcjet.js';
import { sendData } from './lib/response.js';
import { openApiSpec } from './config/openapi.js';
import { authRouter, meRouter } from './routes/user.routes.js';

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
const corsOrigins = env.FRONTEND_ORIGIN.split(',')
  .map((origin) => origin.trim().replace(/\/+$/, ''))
  .filter(Boolean);

app.use(
  cors({
    origin: corsOrigins,
    credentials: true,
  })
);
app.use(compression());

// Arcjet: fails open by default so an Arcjet outage never takes the API down.
// /health and /v1/callbacks/* are excluded: uptime monitors and ayeT's
// server-to-server callbacks are automated clients that must never see bot rules.
if (env.ARCJET_KEY) {
  app.use(async (req, res, next) => {
    if (
      req.path === '/health' ||
      req.path.startsWith('/v1/callbacks') ||
      req.path.startsWith('/email-assets')
    ) {
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
app.use('/v1', csrfProtection);

app.use(requestLogger);

app.get('/', (_req, res) => {
  sendData(res, { message: 'Welcome to EarnBridge 🎉🎉' });
});

// Public email logo, referenced by absolute URL in outgoing emails
// (works for both SMTP and API providers; CID inline images are not portable).
const emailLogoPath = fileURLToPath(
  new URL('./services/email/templates/earnbridge-logo.png', import.meta.url)
);
app.get('/email-assets/earnbridge-logo.png', (_req, res) => {
  res.set('Cache-Control', 'public, max-age=86400');
  // Helmet sets Cross-Origin-Resource-Policy: same-origin globally; email
  // clients fetch this image cross-origin, so allow it here only.
  res.set('Cross-Origin-Resource-Policy', 'cross-origin');
  res.sendFile(emailLogoPath);
});

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

app.use('/v1/auth', authRouter);
app.use('/v1/me', meRouter);

app.use(
  '/docs',
  swaggerUi.serve,
  swaggerUi.setup(openApiSpec, {
    customSiteTitle: 'EarnBridge API Docs',
  })
);

app.use(notFoundHandler);
app.use(errorHandler);

export { app };
