import { env } from './env.js';

export const AUTH_COOKIES = {
  accessToken: env.ACCESS_TOKEN_COOKIE_NAME,
  refreshToken: env.REFRESH_TOKEN_COOKIE_NAME,
} as const;

export const ACCESS_TOKEN_TYPE = 'access';

export const EMAIL_VERIFICATION_OTP_TTL_MINUTES = 10;
export const PASSWORD_RESET_TTL_MINUTES = 30;

export const CHAT_MAX_MESSAGE_LENGTH = 2000;
export const CHAT_HISTORY_LIMIT = 20;
export const CHAT_LIST_MAX_LIMIT = 50;
