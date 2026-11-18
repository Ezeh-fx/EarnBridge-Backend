import { OAuth2Client } from 'google-auth-library';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { AppError } from './errors.js';

export interface GoogleVerifiedUser {
  googleId: string;
  email: string;
  emailVerified: boolean;
  firstName?: string;
  lastName?: string;
  picture?: string;
}

let oauthClient: OAuth2Client | undefined;

const getOAuthClient = (): OAuth2Client => {
  if (!env.GOOGLE_CLIENT_ID) {
    throw AppError.internal(
      'GOOGLE_AUTH_NOT_CONFIGURED',
      'Google authentication is not configured'
    );
  }

  oauthClient ??= new OAuth2Client(env.GOOGLE_CLIENT_ID);
  return oauthClient;
};

const invalidToken = (): AppError =>
  AppError.unauthorized('INVALID_GOOGLE_TOKEN', 'Invalid Google ID token');

export const verifyGoogleIdToken = async (
  idToken: string
): Promise<GoogleVerifiedUser> => {
  if (typeof idToken !== 'string' || idToken.trim() === '') {
    throw invalidToken();
  }

  const client = getOAuthClient();

  let payload;
  try {
    const ticket = await client.verifyIdToken({
      idToken,
      audience: env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : 'unknown' },
      'Google ID token verification failed'
    );

    // Google rejects invalid tokens with an HTTP response (400).
    // Failures without one are transport/provider errors, not bad credentials.
    const status = (err as { response?: { status?: number } }).response?.status;
    if (typeof status === 'number') {
      throw invalidToken();
    }
    throw AppError.internal(
      'GOOGLE_AUTH_FAILED',
      'Google authentication service error'
    );
  }

  if (!payload) {
    throw invalidToken();
  }

  const validIssuers = ['accounts.google.com', 'https://accounts.google.com'];
  if (!payload.iss || !validIssuers.includes(payload.iss)) {
    logger.warn({ iss: payload.iss }, 'Google ID token has invalid issuer');
    throw invalidToken();
  }

  if (!payload.sub) {
    logger.warn('Google ID token missing subject');
    throw invalidToken();
  }

  if (!payload.email) {
    logger.warn('Google ID token missing email');
    throw AppError.unauthorized(
      'GOOGLE_EMAIL_MISSING',
      'Google account has no email address'
    );
  }

  if (payload.email_verified !== true) {
    logger.warn('Google ID token email is not verified');
    throw AppError.unauthorized(
      'GOOGLE_EMAIL_UNVERIFIED',
      'Google account email is not verified'
    );
  }

  return {
    googleId: payload.sub,
    email: payload.email,
    emailVerified: true,
    firstName: payload.given_name,
    lastName: payload.family_name,
    picture: payload.picture,
  };
};
