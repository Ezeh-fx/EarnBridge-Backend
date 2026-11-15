import { env } from './env';

export const AUTH_COOKIES = {
  accessToken: env.ACCESS_TOKEN_COOKIE_NAME,
  refreshToken: env.REFRESH_TOKEN_COOKIE_NAME,
} as const;

export const ACCESS_TOKEN_TYPE = 'access';
export const REFRESH_TOKEN_TYPE = 'refresh';

export const CHAT_MAX_MESSAGE_LENGTH = 2000;
export const CHAT_HISTORY_LIMIT = 20;
export const CHAT_LIST_MAX_LIMIT = 50;
