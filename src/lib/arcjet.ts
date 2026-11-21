import arcjet, {
  shield,
  tokenBucket,
  detectBot,
  validateEmail,
} from '@arcjet/node';
import { env } from '../config/env.js';

const aj = arcjet({
  key: env.ARCJET_KEY || '',
  rules: [
    shield({
      mode: 'LIVE',
    }),
    detectBot({
      mode: env.NODE_ENV === 'production' ? 'LIVE' : 'DRY_RUN',
      allow: [],
    }),
  ],
});

export const arcjetMiddleware = aj;

export const loginRateLimit = aj.withRule(
  tokenBucket({
    mode: 'LIVE',
    refillRate: 5,
    interval: 60,
    capacity: 10,
  })
);

export const registerRateLimit = aj
  .withRule(validateEmail({ mode: 'LIVE', deny: ['DISPOSABLE', 'INVALID'] }))
  .withRule(
    tokenBucket({
      mode: 'LIVE',
      refillRate: 3,
      interval: 60,
      capacity: 5,
    })
  );

export const refreshRateLimit = aj.withRule(
  tokenBucket({
    mode: 'LIVE',
    refillRate: 10,
    interval: 60,
    capacity: 20,
  })
);

export const withdrawalRateLimit = aj.withRule(
  tokenBucket({
    mode: 'LIVE',
    refillRate: 2,
    interval: 60,
    capacity: 5,
  })
);

export const chatRateLimit = aj.withRule(
  tokenBucket({
    mode: 'LIVE',
    refillRate: 10,
    interval: 60,
    capacity: 20,
  })
);

export const emailVerificationRateLimit = aj.withRule(
  tokenBucket({
    mode: 'LIVE',
    refillRate: 3,
    interval: 60,
    capacity: 5,
  })
);

export const passwordResetRateLimit = aj.withRule(
  tokenBucket({
    mode: 'LIVE',
    refillRate: 3,
    interval: 60,
    capacity: 5,
  })
);

// Authenticated route: keyed by user ID instead of IP.
export const changePasswordRateLimit = aj.withRule(
  tokenBucket({
    mode: 'LIVE',
    refillRate: 3,
    interval: 60,
    capacity: 5,
    characteristics: ['userId'],
  })
);

