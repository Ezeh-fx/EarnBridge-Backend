import { env } from './env';

export const AUTH_COOKIES = {
  accessToken: env.ACCESS_TOKEN_COOKIE_NAME,
  refreshToken: env.REFRESH_TOKEN_COOKIE_NAME,
} as const;

export const ACCESS_TOKEN_TYPE = 'access';
export const REFRESH_TOKEN_TYPE = 'refresh';
