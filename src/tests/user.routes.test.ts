import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createHash, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../app';
import { ACCESS_TOKEN_TYPE, AUTH_COOKIES } from '../config/constants';
import { env } from '../config/env';
import { AppError } from '../lib/errors';
import { RefreshToken } from '../models/refreshToken.model';
import { User } from '../models/user.model';

const mocks = vi.hoisted(() => ({
  sendVerificationOTPEmail: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  verifyGoogleIdToken: vi.fn(),
}));

vi.mock('../services/email.service', () => ({
  sendVerificationOTPEmail: mocks.sendVerificationOTPEmail,
  sendPasswordResetEmail: mocks.sendPasswordResetEmail,
}));

vi.mock('../lib/google', () => ({
  verifyGoogleIdToken: mocks.verifyGoogleIdToken,
}));

let replSet: MongoMemoryReplSet;
let sentOtp: string | undefined;
let resetUrl: string | undefined;

const googleProfile = {
  googleId: 'google-sub-123',
  email: 'google@example.com',
  emailVerified: true,
  firstName: 'Google',
  lastName: 'User',
  picture: 'https://example.com/avatar.png',
};

const cookieValue = (
  res: request.Response,
  name: string
): string | undefined => {
  const cookies = res.headers['set-cookie'];
  if (!cookies) {
    return undefined;
  }
  const header = Array.isArray(cookies) ? cookies : [cookies];
  const match = header.find((cookie) => cookie.startsWith(`${name}=`));
  return match?.split(';')[0];
};

const registerBody = {
  email: 'user@example.com',
  password: 'password123',
  displayName: 'Test User',
};

const createVerifiedUser = async (
  email = registerBody.email,
  password = registerBody.password
) => {
  await request(app)
    .post('/v1/auth/register')
    .send({ email, password, displayName: 'Test User' })
    .expect(201);

  expect(sentOtp).toBeDefined();
  await request(app)
    .post('/v1/auth/verify-otp')
    .send({ email, otp: sentOtp })
    .expect(200);
};

const login = (email = registerBody.email, password = registerBody.password) =>
  request(app).post('/v1/auth/login').send({ email, password });

describe('user auth routes', { timeout: 20000 }, () => {
  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(replSet.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await replSet.stop();
  });

  beforeEach(async () => {
    vi.clearAllMocks();
    sentOtp = undefined;
    resetUrl = undefined;

    await Promise.all([
      User.deleteMany({}),
      RefreshToken.deleteMany({}),
    ]);

    mocks.sendVerificationOTPEmail.mockImplementation(
      async (_email: string, otp: string) => {
        sentOtp = otp;
        return { messageId: 'test-message-id' };
      }
    );
    mocks.sendPasswordResetEmail.mockImplementation(
      async (_email: string, url: string) => {
        resetUrl = url;
        return { messageId: 'test-message-id' };
      }
    );
    mocks.verifyGoogleIdToken.mockResolvedValue(googleProfile);
  });

  it('registers a user and sends a verification OTP', async () => {
    const res = await request(app)
      .post('/v1/auth/register')
      .send(registerBody)
      .expect(201);

    expect(res.body.data.message).toContain('verification code');
    expect(mocks.sendVerificationOTPEmail).toHaveBeenCalledWith(
      registerBody.email,
      sentOtp,
      expect.objectContaining({ expiresInMinutes: 10 })
    );

    const user = await User.findOne({ email: registerBody.email }).select(
      '+passwordHash'
    );
    expect(user?.emailVerifiedAt).toBeUndefined();
    expect(user?.passwordHash).toBeTruthy();
    expect(user?.passwordHash).not.toBe(registerBody.password);
  });

  it('rejects registration with a weak password', async () => {
    await request(app)
      .post('/v1/auth/register')
      .send({ ...registerBody, password: 'short' })
      .expect(422)
      .expect((res) => {
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
        expect(res.body.error.message).toContain('password');
      });
  });

  it('verifies the registration OTP and marks the email verified', async () => {
    await request(app)
      .post('/v1/auth/register')
      .send(registerBody)
      .expect(201);

    const res = await request(app)
      .post('/v1/auth/verify-otp')
      .send({ email: registerBody.email, otp: sentOtp })
      .expect(200);

    expect(res.body.data.user.emailVerified).toBe(true);
    const user = await User.findOne({ email: registerBody.email });
    expect(user?.emailVerifiedAt).toBeInstanceOf(Date);
    expect(user?.emailVerificationOtpHash).toBeUndefined();
  });

  it('rejects an invalid OTP', async () => {
    await request(app)
      .post('/v1/auth/register')
      .send(registerBody)
      .expect(201);

    const wrongOtp = sentOtp === '000000' ? '111111' : '000000';
    await request(app)
      .post('/v1/auth/verify-otp')
      .send({ email: registerBody.email, otp: wrongOtp })
      .expect(400)
      .expect((res) => {
        expect(res.body.error.code).toBe('INVALID_OTP');
      });
  });

  it('binds a re-registration OTP to the latest submitted password', async () => {
    await request(app)
      .post('/v1/auth/register')
      .send(registerBody)
      .expect(201);

    const newPassword = 'new-password123';
    await request(app)
      .post('/v1/auth/register')
      .send({ ...registerBody, password: newPassword })
      .expect(201);

    await request(app)
      .post('/v1/auth/verify-otp')
      .send({ email: registerBody.email, otp: sentOtp })
      .expect(200);

    await login(registerBody.email, newPassword).expect(200);
    await login(registerBody.email, registerBody.password).expect(401);
  });

  it('logs in a verified user and sets auth cookies', async () => {
    await createVerifiedUser();

    const res = await login().expect(200);

    expect(res.body.data.user.email).toBe(registerBody.email);
    expect(cookieValue(res, AUTH_COOKIES.accessToken)).toBeDefined();
    expect(cookieValue(res, AUTH_COOKIES.refreshToken)).toBeDefined();
  });

  it('rejects login with an invalid password', async () => {
    await createVerifiedUser();

    await login(registerBody.email, 'wrong-password').expect(401).expect((res) => {
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    });
  });

  it('signs in with a verified Google ID token', async () => {
    const res = await request(app)
      .post('/v1/auth/google')
      .send({ idToken: 'google-id-token' })
      .expect(200);

    expect(mocks.verifyGoogleIdToken).toHaveBeenCalledWith('google-id-token');
    expect(res.body.data.user.email).toBe(googleProfile.email);
    expect(cookieValue(res, AUTH_COOKIES.accessToken)).toBeDefined();
  });

  it('rejects Google login when token verification fails', async () => {
    mocks.verifyGoogleIdToken.mockRejectedValue(
      AppError.unauthorized('INVALID_GOOGLE_TOKEN', 'Invalid Google ID token')
    );

    await request(app)
      .post('/v1/auth/google')
      .send({ idToken: 'bad-token' })
      .expect(401)
      .expect((res) => {
        expect(res.body.error.code).toBe('INVALID_GOOGLE_TOKEN');
      });
  });

  it('rotates the refresh token and returns a new session', async () => {
    await createVerifiedUser();
    const agent = request.agent(app);

    await agent
      .post('/v1/auth/login')
      .send({ email: registerBody.email, password: registerBody.password })
      .expect(200);
    const refreshRes = await agent.post('/v1/auth/refresh').expect(200);

    expect(refreshRes.body.data.user.email).toBe(registerBody.email);
    const tokens = await RefreshToken.find({}).sort({ createdAt: 1 });
    expect(tokens).toHaveLength(2);
    expect(tokens[0].usedAt).toBeInstanceOf(Date);
    expect(tokens[1].usedAt).toBeUndefined();
    expect(tokens[1].familyId).toBe(tokens[0].familyId);
  });

  it('rejects refresh without a refresh token cookie', async () => {
    await request(app).post('/v1/auth/refresh').expect(401);
  });

  it('rejects an expired refresh token without creating a session', async () => {
    await createVerifiedUser();
    const user = await User.findOne({ email: registerBody.email });
    const token = 'expired-refresh-token';
    const tokenHash = createHash('sha256').update(token).digest('hex');

    await RefreshToken.create({
      user: user!._id,
      tokenHash,
      familyId: randomUUID(),
      expiresAt: new Date(Date.now() - 1_000),
    });

    await request(app)
      .post('/v1/auth/refresh')
      .set('Cookie', `${AUTH_COOKIES.refreshToken}=${token}`)
      .expect(401)
      .expect((res) => {
        expect(res.body.error.code).toBe('REFRESH_TOKEN_EXPIRED');
      });

    expect(await RefreshToken.countDocuments({})).toBe(1);
  });

  it('revokes the refresh token family when a used token is replayed', async () => {
    await createVerifiedUser();
    const loginRes = await login().expect(200);
    const refreshCookie = cookieValue(loginRes, AUTH_COOKIES.refreshToken);
    expect(refreshCookie).toBeDefined();

    await request(app)
      .post('/v1/auth/refresh')
      .set('Cookie', refreshCookie as string)
      .expect(200);

    await request(app)
      .post('/v1/auth/refresh')
      .set('Cookie', refreshCookie as string)
      .expect(401)
      .expect((res) => {
        expect(res.body.error.code).toBe('REFRESH_TOKEN_REUSED');
      });

    const tokens = await RefreshToken.find({});
    expect(tokens.every((token) => token.revokedAt instanceof Date)).toBe(true);
  });

  it('allows only one concurrent refresh with the same token', async () => {
    await createVerifiedUser();
    const loginRes = await login().expect(200);
    const refreshCookie = cookieValue(loginRes, AUTH_COOKIES.refreshToken);
    expect(refreshCookie).toBeDefined();

    const [first, second] = await Promise.all([
      request(app)
        .post('/v1/auth/refresh')
        .set('Cookie', refreshCookie as string),
      request(app)
        .post('/v1/auth/refresh')
        .set('Cookie', refreshCookie as string),
    ]);

    expect([first.status, second.status].sort()).toEqual([200, 401]);

    const tokens = await RefreshToken.find({}).sort({ createdAt: 1 });
    expect(tokens).toHaveLength(2);
    expect(tokens.filter((token) => token.usedAt)).toHaveLength(1);
  });

  it('logs out and revokes the current refresh token', async () => {
    await createVerifiedUser();
    const agent = request.agent(app);

    await agent
      .post('/v1/auth/login')
      .send({ email: registerBody.email, password: registerBody.password })
      .expect(200);
    const logoutRes = await agent.post('/v1/auth/logout').expect(200);

    const setCookies = logoutRes.headers['set-cookie'];
    const headers = Array.isArray(setCookies) ? setCookies : [setCookies];
    for (const name of [AUTH_COOKIES.accessToken, AUTH_COOKIES.refreshToken]) {
      const cleared = headers.find((cookie) => cookie.startsWith(`${name}=`));
      expect(cleared).toBeDefined();
      expect(cleared).toContain('Expires=Thu, 01 Jan 1970');
    }

    const token = await RefreshToken.findOne({});
    expect(token?.revokedAt).toBeInstanceOf(Date);
    await agent.post('/v1/auth/refresh').expect(401);
  });

  it('returns the current user for an authenticated request', async () => {
    await createVerifiedUser();
    const loginRes = await login().expect(200);
    const accessCookie = cookieValue(loginRes, AUTH_COOKIES.accessToken);

    const res = await request(app)
      .get('/v1/me')
      .set('Cookie', accessCookie as string)
      .expect(200);

    expect(res.body.data.user.email).toBe(registerBody.email);
    expect(res.body.data.user.passwordHash).toBeUndefined();
  });

  it('rejects /v1/me without an access token', async () => {
    await request(app).get('/v1/me').expect(401);
  });

  it('rejects /v1/me with an expired access token', async () => {
    await createVerifiedUser();
    const user = await User.findOne({ email: registerBody.email });
    const expiredToken = jwt.sign(
      {
        sub: user!._id.toString(),
        publicId: user!.publicId,
        role: user!.role,
        type: ACCESS_TOKEN_TYPE,
        exp: Math.floor(Date.now() / 1000) - 60,
      },
      env.JWT_ACCESS_SECRET
    );

    await request(app)
      .get('/v1/me')
      .set('Cookie', `${AUTH_COOKIES.accessToken}=${expiredToken}`)
      .expect(401)
      .expect((res) => {
        expect(res.body.error.code).toBe('INVALID_TOKEN');
      });
  });

  it('sends a password reset email with a reset link', async () => {
    await createVerifiedUser();

    await request(app)
      .post('/v1/auth/forgot-password')
      .send({ email: registerBody.email })
      .expect(200);

    expect(mocks.sendPasswordResetEmail).toHaveBeenCalledWith(
      registerBody.email,
      expect.stringContaining('/reset-password?token='),
      expect.objectContaining({ expiresInMinutes: 30 })
    );
    expect(resetUrl).toContain('http');
  });

  it('returns the same response for an unknown forgot-password email', async () => {
    const res = await request(app)
      .post('/v1/auth/forgot-password')
      .send({ email: 'missing@example.com' })
      .expect(200);

    expect(res.body.data.message).toContain('If an account exists');
    expect(mocks.sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('verifies a valid password reset token', async () => {
    await createVerifiedUser();
    await request(app)
      .post('/v1/auth/forgot-password')
      .send({ email: registerBody.email })
      .expect(200);

    const token = new URL(resetUrl as string).searchParams.get('token');
    await request(app)
      .post('/v1/auth/verify-reset-token')
      .send({ token })
      .expect(200)
      .expect((res) => {
        expect(res.body.data.valid).toBe(true);
      });
  });

  it('rejects an invalid password reset token', async () => {
    await request(app)
      .post('/v1/auth/verify-reset-token')
      .send({ token: 'a'.repeat(43) })
      .expect(400)
      .expect((res) => {
        expect(res.body.error.code).toBe('INVALID_RESET_TOKEN');
      });
  });

  it('resets the password and revokes existing sessions', async () => {
    await createVerifiedUser();
    await login().expect(200);
    await request(app)
      .post('/v1/auth/forgot-password')
      .send({ email: registerBody.email })
      .expect(200);

    const token = new URL(resetUrl as string).searchParams.get('token');
    await request(app)
      .post('/v1/auth/reset-password')
      .send({ token, newPassword: 'new-password123' })
      .expect(200);

    const oldTokens = await RefreshToken.find({});
    expect(oldTokens.length).toBeGreaterThan(0);
    expect(oldTokens.every((token) => token.revokedAt instanceof Date)).toBe(true);

    await login(registerBody.email, 'new-password123').expect(200);
  });

  it('rejects reset-password with an invalid token', async () => {
    await request(app)
      .post('/v1/auth/reset-password')
      .send({ token: 'a'.repeat(43), newPassword: 'new-password123' })
      .expect(400)
      .expect((res) => {
        expect(res.body.error.code).toBe('INVALID_RESET_TOKEN');
      });
  });

  it('changes the password for an authenticated user', async () => {
    await createVerifiedUser();
    const loginRes = await login().expect(200);
    const accessCookie = cookieValue(loginRes, AUTH_COOKIES.accessToken);

    await request(app)
      .post('/v1/me/password')
      .set('Cookie', accessCookie as string)
      .send({ oldPassword: registerBody.password, newPassword: 'changed-password' })
      .expect(200);

    await login(registerBody.email, 'changed-password').expect(200);
  });

  it('rejects change-password with an incorrect old password', async () => {
    await createVerifiedUser();
    const loginRes = await login().expect(200);
    const accessCookie = cookieValue(loginRes, AUTH_COOKIES.accessToken);

    await request(app)
      .post('/v1/me/password')
      .set('Cookie', accessCookie as string)
      .send({ oldPassword: 'wrong-password', newPassword: 'changed-password' })
      .expect(400)
      .expect((res) => {
        expect(res.body.error.code).toBe('INVALID_CURRENT_PASSWORD');
      });
  });
});
