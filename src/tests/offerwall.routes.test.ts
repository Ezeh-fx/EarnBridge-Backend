import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../app.js';
import { AUTH_COOKIES } from '../config/constants.js';
import { env } from '../config/env.js';
import { User } from '../models/user.model.js';

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

const loginWithAccessToken = async (): Promise<string> => {
  await request(app)
    .post('/v1/auth/register')
    .send({
      email: 'offerwall@example.com',
      password: 'password123',
      displayName: 'Offerwall User',
    })
    .expect(201);

  await request(app)
    .post('/v1/auth/verify-otp')
    .send({ email: 'offerwall@example.com', otp: sentOtp })
    .expect(200);

  const loginRes = await request(app)
    .post('/v1/auth/login')
    .send({ email: 'offerwall@example.com', password: 'password123' })
    .expect(200);

  return cookieValue(loginRes, AUTH_COOKIES.accessToken) as string;
};

describe('offerwall routes', { timeout: 20000 }, () => {
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
    await User.deleteMany({});

    mocks.sendVerificationOTPEmail.mockImplementation(
      async (_email: string, otp: string) => {
        sentOtp = otp;
        return { messageId: 'test-message-id' };
      }
    );
  });

  it('rejects GET /v1/offerwall/link without authentication', async () => {
    await request(app).get('/v1/offerwall/link').expect(401);
  });

  it('returns the offerwall URL with the user public ID', async () => {
    const accessCookie = await loginWithAccessToken();
    const user = await User.findOne({ email: 'offerwall@example.com' });

    const res = await request(app)
      .get('/v1/offerwall/link')
      .set('Cookie', accessCookie)
      .expect(200);

    const url = new URL(res.body.data.url);
    expect(url.origin + url.pathname).toBe(
      'https://offerwall.ayet.io/offers'
    );
    expect(url.searchParams.get('adSlot')).toBe(env.AYET_ADSLOT_ID);
    expect(url.searchParams.get('externalIdentifier')).toBe(user!.publicId);
    expect(url.searchParams.get('externalIdentifier')).not.toBe(
      user!.email
    );
    expect(url.searchParams.get('externalIdentifier')).not.toBe(
      user!._id.toString()
    );
  });
});
