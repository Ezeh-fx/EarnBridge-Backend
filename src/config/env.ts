import 'dotenv/config';
import { z } from 'zod';

const preprocessEmptyString = (value: unknown) => {
  if (typeof value === 'string' && value.trim() === '') {
    return undefined;
  }
  return value;
};

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('3000'),
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),
  MONGODB_URI: z.preprocess(preprocessEmptyString, z.string().url()),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_EXPIRY: z.string().default('7d'),
  ACCESS_TOKEN_COOKIE_NAME: z.string().default('eb_access_token'),
  REFRESH_TOKEN_COOKIE_NAME: z.string().default('eb_refresh_token'),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  ARCJET_KEY: z.string().optional(),
  ARCJET_ENV: z.enum(['development', 'production']).default('development'),
  AYET_ADSLOT_ID: z.string().optional(),
  AYET_CALLBACK_SECRET: z.string().optional(),
  AYET_CALLBACK_IP_WHITELIST: z.string().optional(),
  REWARD_SHARE_BPS: z.coerce.number().int().min(0).max(10000).default(7000),
  CURRENCY_CODE: z.string().default('USD'),
  MIN_WITHDRAWAL_AMOUNT: z.coerce.number().int().min(0).default(1000),
  MAX_WITHDRAWAL_AMOUNT: z.coerce.number().int().min(0).default(100000),
  WITHDRAWAL_HOLD_DAYS: z.coerce.number().int().min(0).default(7),
  AI_PROVIDER: z.string().optional(),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().optional(),
  FRONTEND_ORIGIN: z.string().url().default('http://localhost:5173'),
  SENTRY_DSN: z.preprocess(preprocessEmptyString, z.string().url().optional()),
  SENTRY_ENVIRONMENT: z.string().default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  // DNS (comma-separated list of DNS servers for development)
  DNS_SERVERS: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.NODE_ENV === 'production' && data.MONGODB_URI === 'mongodb://localhost:27017/test-earnbridge') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'MONGODB_URI must be explicitly provided in production',
      path: ['MONGODB_URI'],
    });
  }
});

const validateEnv = () => {
  const env = envSchema.safeParse(process.env);

  if (!env.success) {
    console.error('❌ Invalid environment variables:');
    console.error(env.error.issues);
    process.exit(1);
  }

  return env.data;
};

export const env = validateEnv();
