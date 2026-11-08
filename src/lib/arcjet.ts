import arcjet, { shield, tokenBucket, detectBot } from '@arcjet/node';
import { env } from '../config/env';

const aj = arcjet({
  key: env.ARCJET_KEY || '',
  rules: [
    shield({
      mode: 'LIVE',
    }),
    detectBot({
      mode: 'LIVE',
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

export const registerRateLimit = aj.withRule(
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

export { aj };
