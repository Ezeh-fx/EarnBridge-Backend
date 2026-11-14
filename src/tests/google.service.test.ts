import { beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../config/env';
import { verifyGoogleIdToken } from '../lib/google';

const mocks = vi.hoisted(() => ({
  verifyIdToken: vi.fn(),
}));

vi.mock('google-auth-library', () => ({
  OAuth2Client: class {
    verifyIdToken = mocks.verifyIdToken;
  },
}));

const validPayload = {
  sub: 'google-sub-123',
  email: 'user@example.com',
  email_verified: true,
  given_name: 'Jane',
  family_name: 'Doe',
  picture: 'https://example.com/photo.jpg',
  iss: 'https://accounts.google.com',
  aud: 'test-google-client-id',
};

const googleRejection = (message: string) =>
  Object.assign(new Error(message), { response: { status: 400 } });

const mockTicket = (payload: unknown) => ({
  getPayload: () => payload,
});

describe('verifyGoogleIdToken', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    env.GOOGLE_CLIENT_ID = 'test-google-client-id';
  });

  it('returns verified user info for a valid token', async () => {
    mocks.verifyIdToken.mockResolvedValue(mockTicket(validPayload));

    const result = await verifyGoogleIdToken('valid-token');

    expect(mocks.verifyIdToken).toHaveBeenCalledWith({
      idToken: 'valid-token',
      audience: 'test-google-client-id',
    });
    expect(result).toEqual({
      googleId: 'google-sub-123',
      email: 'user@example.com',
      emailVerified: true,
      firstName: 'Jane',
      lastName: 'Doe',
      picture: 'https://example.com/photo.jpg',
    });
  });

  it('rejects when Google verification fails (invalid token)', async () => {
    mocks.verifyIdToken.mockRejectedValue(googleRejection('Wrong recipient'));

    await expect(verifyGoogleIdToken('bad-token')).rejects.toMatchObject({
      statusCode: 401,
      code: 'INVALID_GOOGLE_TOKEN',
    });
  });

  it('rejects an expired token', async () => {
    mocks.verifyIdToken.mockRejectedValue(
      googleRejection('Token used too late')
    );

    await expect(verifyGoogleIdToken('expired-token')).rejects.toMatchObject({
      code: 'INVALID_GOOGLE_TOKEN',
    });
  });

  it('rejects a token with an incorrect audience', async () => {
    mocks.verifyIdToken.mockRejectedValue(
      googleRejection('Token audience mismatch')
    );

    await expect(verifyGoogleIdToken('wrong-aud-token')).rejects.toMatchObject({
      code: 'INVALID_GOOGLE_TOKEN',
    });
  });

  it('rejects a payload with a missing email', async () => {
    mocks.verifyIdToken.mockResolvedValue(
      mockTicket({ ...validPayload, email: undefined })
    );

    await expect(verifyGoogleIdToken('no-email-token')).rejects.toMatchObject({
      code: 'GOOGLE_EMAIL_MISSING',
    });
  });

  it('rejects an unverified email', async () => {
    mocks.verifyIdToken.mockResolvedValue(
      mockTicket({ ...validPayload, email_verified: false })
    );

    await expect(verifyGoogleIdToken('unverified-token')).rejects.toMatchObject({
      code: 'GOOGLE_EMAIL_UNVERIFIED',
    });
  });

  it('rejects a payload with a missing subject ID', async () => {
    mocks.verifyIdToken.mockResolvedValue(
      mockTicket({ ...validPayload, sub: undefined })
    );

    await expect(verifyGoogleIdToken('no-sub-token')).rejects.toMatchObject({
      code: 'INVALID_GOOGLE_TOKEN',
    });
  });

  it('rejects a payload with an invalid issuer', async () => {
    mocks.verifyIdToken.mockResolvedValue(
      mockTicket({ ...validPayload, iss: 'https://evil.example.com' })
    );

    await expect(verifyGoogleIdToken('bad-iss-token')).rejects.toMatchObject({
      code: 'INVALID_GOOGLE_TOKEN',
    });
  });

  it('rejects an empty token without calling Google', async () => {
    await expect(verifyGoogleIdToken('   ')).rejects.toMatchObject({
      code: 'INVALID_GOOGLE_TOKEN',
    });
    expect(mocks.verifyIdToken).not.toHaveBeenCalled();
  });

  it('fails with a configuration error when GOOGLE_CLIENT_ID is missing', async () => {
    env.GOOGLE_CLIENT_ID = undefined;

    await expect(verifyGoogleIdToken('any-token')).rejects.toMatchObject({
      statusCode: 500,
      code: 'GOOGLE_AUTH_NOT_CONFIGURED',
    });
    expect(mocks.verifyIdToken).not.toHaveBeenCalled();
  });

  it('maps transport/provider failures to a server error, not 401', async () => {
    mocks.verifyIdToken.mockRejectedValue(new Error('socket hangup'));

    await expect(verifyGoogleIdToken('token')).rejects.toMatchObject({
      statusCode: 500,
      code: 'GOOGLE_AUTH_FAILED',
    });
  });
});
