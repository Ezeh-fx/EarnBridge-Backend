import { createHmac } from 'node:crypto';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { app } from '../app.js';
import { env } from '../config/env.js';
import { canonicalAyetQuery, verifyAyetCallback } from '../lib/ayet.js';
import { CallbackEvent } from '../models/callbackEvent.model.js';
import { LedgerEntry } from '../models/ledgerEntry.model.js';
import { RefreshToken } from '../models/refreshToken.model.js';
import { User } from '../models/user.model.js';
import { Wallet } from '../models/wallet.model.js';

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

const signQuery = (rawQuery: string): string => {
  const canonical = canonicalAyetQuery(rawQuery);
  if (!canonical) {
    throw new Error('Test query is outside the supported subset');
  }
  return createHmac('sha256', env.AYET_CALLBACK_SECRET)
    .update(canonical.canonical)
    .digest('hex');
};

const ayetGet = (rawQuery: string, signature?: string) => {
  const req = request(app).get(`/v1/callbacks/ayet?${rawQuery}`);
  return signature === undefined
    ? req
    : req.set('X-Ayetstudios-Security-Hash', signature);
};

const signedGet = (rawQuery: string) =>
  ayetGet(rawQuery, signQuery(rawQuery));

const callbackQuery = (params: Record<string, string>): string =>
  new URLSearchParams(params).toString();

const createVerifiedUser = async (email: string) => {
  await request(app)
    .post('/v1/auth/register')
    .send({ email, password: 'password123' })
    .expect(201);

  await request(app)
    .post('/v1/auth/verify-otp')
    .send({ email, otp: sentOtp })
    .expect(200);

  const user = await User.findOne({ email });
  return user!;
};

const conversionParams = (
  publicId: string,
  overrides: Record<string, string> = {}
): Record<string, string> => ({
  transaction_id: 'tx-1',
  external_identifier: publicId,
  payout_usd: '0.36',
  currency_amount: '360',
  is_chargeback: '0',
  callback_type: 'conversion',
  offer_id: '123',
  offer_name: 'Test Offer',
  adslot_id: env.AYET_ADSLOT_ID as string,
  ...overrides,
});

const CREDIT_036 = 252_000; // 360000 micro-USD * 7000 bps / 10000

describe('ayet callback signature', () => {
  it('matches the official worked example', () => {
    const rawQuery =
      'transaction_id=8ee08f32ae611231b0a49d1bd66e9bf193132561&amount=0.10&payout=1.50&user_id=testuser123456&click_id=1234abcd5678021&offer_name=TEST+OFFER';
    const canonical = canonicalAyetQuery(rawQuery);
    expect(canonical?.canonical).toBe(
      'amount=0.10&click_id=1234abcd5678021&offer_name=TEST+OFFER&payout=1.50&transaction_id=8ee08f32ae611231b0a49d1bd66e9bf193132561&user_id=testuser123456'
    );

    const signature = createHmac(
      'sha256',
      '9f2228fea0d8e7ce10b2ac36053db14c'
    )
      .update(canonical!.canonical)
      .digest('hex');
    expect(signature).toBe(
      '62a32725866780ada1dec3d62232645f2801e05a91df7b0202e9b780f804f04b'
    );
    expect(
      verifyAyetCallback(
        rawQuery,
        signature,
        '9f2228fea0d8e7ce10b2ac36053db14c'
      )?.get('user_id')
    ).toBe('testuser123456');
  });

  it('applies the documented canonicalization test vectors', () => {
    const cases: Array<[string, string]> = [
      ['b=2&a=1', 'a=1&b=2'],
      ['name=TEST%20OFFER', 'name=TEST+OFFER'],
      ['id=a*b&note=a~b', 'id=a%2Ab&note=a%7Eb'],
      ['name=caf%c3%a9', 'name=caf%C3%A9'],
      ['custom_1=&flag', 'custom_1=&flag='],
      ['&a=1&&b=2&', 'a=1&b=2'],
      ['d=b=c', 'd=b%3Dc'],
    ];
    for (const [raw, expected] of cases) {
      expect(canonicalAyetQuery(raw)?.canonical).toBe(expected);
    }
  });
});

describe('ayet callback routes', { timeout: 30000 }, () => {
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
    await Promise.all([
      User.deleteMany({}),
      RefreshToken.deleteMany({}),
      CallbackEvent.deleteMany({}),
      // LedgerEntry is append-only; bypass Mongoose hooks for test cleanup.
      LedgerEntry.collection.deleteMany({}),
      Wallet.deleteMany({}),
    ]);

    mocks.sendVerificationOTPEmail.mockImplementation(
      async (_email: string, otp: string) => {
        sentOtp = otp;
        return { messageId: 'test-message-id' };
      }
    );
  });

  it('rejects a callback with a missing or invalid signature', async () => {
    const rawQuery = callbackQuery(conversionParams('someone'));

    await ayetGet(rawQuery).expect(403).expect((res) => {
      expect(res.body.error.code).toBe('INVALID_SIGNATURE');
    });

    await ayetGet(`${rawQuery}&extra=1`, signQuery(rawQuery)).expect(403);
  });

  it('credits the user share of payout_usd for a valid conversion', async () => {
    const user = await createVerifiedUser('reward@example.com');
    const rawQuery = callbackQuery(conversionParams(user.publicId));

    const res = await signedGet(rawQuery).expect(200);
    expect(res.body.data.status).toBe('processed');

    const entry = await LedgerEntry.findOne({});
    expect(entry?.type).toBe('reward');
    expect(entry?.amountMicroUsd).toBe(CREDIT_036);
    expect(entry?.networkPayoutMicroUsd).toBe(360_000);
    expect(entry?.externalTransactionId).toBe('tx-1');
    expect(entry?.user.toString()).toBe(user._id.toString());

    const wallet = await Wallet.findOne({ user: user._id });
    expect(wallet?.availableMicroUsd).toBe(CREDIT_036);

    const event = await CallbackEvent.findOne({});
    expect(event?.status).toBe('processed');
    expect(event?.ledgerEntryId?.toString()).toBe(entry!._id.toString());
  });

  it('credits a rewarded video callback from the video adslot', async () => {
    const user = await createVerifiedUser('video@example.com');
    const rawQuery = callbackQuery(
      conversionParams(user.publicId, {
        transaction_id: 'tx-video-1',
        payout_usd: '0.007',
        currency_amount: '10',
        adslot_id: env.AYET_REWARDED_VIDEO_ADSLOT_ID as string,
      })
    );

    const res = await signedGet(rawQuery).expect(200);
    expect(res.body.data.status).toBe('processed');

    const entry = await LedgerEntry.findOne({});
    expect(entry?.amountMicroUsd).toBe(4_900); // 7000 * 0.7
    expect(entry?.networkPayoutMicroUsd).toBe(7_000);
  });

  it('never credits the same transaction_id twice', async () => {
    const user = await createVerifiedUser('dup@example.com');
    const rawQuery = callbackQuery(conversionParams(user.publicId));

    await signedGet(rawQuery).expect(200);
    const res = await signedGet(rawQuery).expect(200);
    expect(res.body.data.status).toBe('duplicate');

    expect(await LedgerEntry.countDocuments({})).toBe(1);
    expect(await CallbackEvent.countDocuments({})).toBe(1);
    const wallet = await Wallet.findOne({ user: user._id });
    expect(wallet?.availableMicroUsd).toBe(CREDIT_036);
  });

  it('records a chargeback reversal linked to the original reward', async () => {
    const user = await createVerifiedUser('reverse@example.com');
    await signedGet(callbackQuery(conversionParams(user.publicId))).expect(200);

    const reversalQuery = callbackQuery(
      conversionParams(user.publicId, {
        transaction_id: 'r-tx-1',
        payout_usd: '-0.36',
        is_chargeback: '1',
        callback_type: 'chargeback',
      })
    );
    const res = await signedGet(reversalQuery).expect(200);
    expect(res.body.data.status).toBe('reversal_processed');

    const reward = await LedgerEntry.findOne({ type: 'reward' });
    const reversal = await LedgerEntry.findOne({ type: 'reversal' });
    expect(reversal?.amountMicroUsd).toBe(-CREDIT_036);
    expect(reversal?.networkPayoutMicroUsd).toBe(-360_000);
    expect(reversal?.relatedEntryId?.toString()).toBe(reward!._id.toString());

    const wallet = await Wallet.findOne({ user: user._id });
    expect(wallet?.availableMicroUsd).toBe(0);

    const events = await CallbackEvent.find({}).sort({ createdAt: 1 });
    expect(events).toHaveLength(2);
    expect(events[1].isChargeback).toBe(true);
  });

  it('lets a reversal take the balance below zero', async () => {
    const user = await createVerifiedUser('negative@example.com');
    await signedGet(callbackQuery(conversionParams(user.publicId))).expect(200);

    await signedGet(
      callbackQuery(
        conversionParams(user.publicId, {
          transaction_id: 'r-tx-1',
          payout_usd: '-2.00',
          is_chargeback: '1',
          callback_type: 'chargeback',
        })
      )
    ).expect(200);

    const wallet = await Wallet.findOne({ user: user._id });
    expect(wallet?.availableMicroUsd).toBe(CREDIT_036 - 1_400_000);
  });

  it('records but does not credit callbacks for unknown users', async () => {
    const rawQuery = callbackQuery(
      conversionParams('nonexistent-public-id')
    );
    const res = await signedGet(rawQuery).expect(200);
    expect(res.body.data.status).toBe('unknown_user');

    expect(await LedgerEntry.countDocuments({})).toBe(0);
    const event = await CallbackEvent.findOne({});
    expect(event?.status).toBe('unknown_user');
    expect(event?.user).toBeUndefined();
  });

  it('does not credit sandbox callbacks', async () => {
    const user = await createVerifiedUser('sandbox@example.com');
    const rawQuery = callbackQuery(
      conversionParams(user.publicId, {
        transaction_id: 'tx-sandbox',
        is_sandbox: '1',
      })
    );

    const res = await signedGet(rawQuery).expect(200);
    expect(res.body.data.status).toBe('ignored');

    expect(await LedgerEntry.countDocuments({})).toBe(0);
    const event = await CallbackEvent.findOne({});
    expect(event?.status).toBe('processed');
    expect(event?.transactionId).toBe('tx-sandbox:sandbox');
  });

  it('does not let optional event callbacks block the conversion', async () => {
    const user = await createVerifiedUser('events@example.com');

    await signedGet(
      callbackQuery(
        conversionParams(user.publicId, {
          transaction_id: 'tx-shared',
          callback_type: 'optional',
          event_name: 'level_up',
        })
      )
    ).expect(200);

    const res = await signedGet(
      callbackQuery(conversionParams(user.publicId, { transaction_id: 'tx-shared' }))
    ).expect(200);
    expect(res.body.data.status).toBe('processed');

    const entry = await LedgerEntry.findOne({});
    expect(entry?.amountMicroUsd).toBe(CREDIT_036);
    expect(await CallbackEvent.countDocuments({})).toBe(2);
  });

  it('does not credit callbacks from an unknown adslot', async () => {
    const user = await createVerifiedUser('adslot@example.com');
    const rawQuery = callbackQuery(
      conversionParams(user.publicId, { adslot_id: 'someone-elses-adslot' })
    );

    const res = await signedGet(rawQuery).expect(200);
    expect(res.body.data.status).toBe('error');

    expect(await LedgerEntry.countDocuments({})).toBe(0);
    const event = await CallbackEvent.findOne({});
    expect(event?.status).toBe('error');
    expect(event?.error).toBe('UNKNOWN_ADSLOT');
  });

  it('acknowledges malformed callbacks without crediting', async () => {
    const rawQuery = callbackQuery({
      external_identifier: 'someone',
      payout_usd: '0.36',
      callback_type: 'conversion',
      // transaction_id intentionally missing: no dedupe key exists, so the
      // verified callback cannot be persisted.
    });

    const res = await signedGet(rawQuery).expect(200);
    expect(res.body.data.status).toBe('malformed');
    expect(await CallbackEvent.countDocuments({})).toBe(0);
  });

  it('records verified financial callbacks with a missing or invalid payout', async () => {
    const user = await createVerifiedUser('badpayout@example.com');

    const missing = await signedGet(
      callbackQuery({
        transaction_id: 'tx-no-payout',
        external_identifier: user.publicId,
        callback_type: 'conversion',
      })
    ).expect(200);
    expect(missing.body.data.status).toBe('error');

    const invalid = await signedGet(
      callbackQuery(
        conversionParams(user.publicId, {
          transaction_id: 'tx-bad-payout',
          payout_usd: 'not-a-number',
        })
      )
    ).expect(200);
    expect(invalid.body.data.status).toBe('error');

    expect(await LedgerEntry.countDocuments({})).toBe(0);
    const events = await CallbackEvent.find({}).sort({ createdAt: 1 });
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.error)).toEqual([
      'INVALID_PAYOUT',
      'INVALID_PAYOUT',
    ]);
    expect(events[0].status).toBe('error');
  });

  it('applies a reversal that arrived before its reward', async () => {
    const user = await createVerifiedUser('earlyrev@example.com');

    const reversalQuery = callbackQuery(
      conversionParams(user.publicId, {
        transaction_id: 'r-tx-early',
        payout_usd: '-0.36',
        is_chargeback: '1',
        callback_type: 'chargeback',
      })
    );
    const early = await signedGet(reversalQuery).expect(200);
    expect(early.body.data.status).toBe('error');

    const pending = await CallbackEvent.findOne({});
    expect(pending?.status).toBe('error');
    expect(pending?.error).toBe('ORIGINAL_NOT_FOUND');

    const reward = await signedGet(
      callbackQuery(
        conversionParams(user.publicId, { transaction_id: 'tx-early' })
      )
    ).expect(200);
    expect(reward.body.data.status).toBe('processed');

    const wallet = await Wallet.findOne({ user: user._id });
    expect(wallet?.availableMicroUsd).toBe(0);

    const reversalEntry = await LedgerEntry.findOne({ type: 'reversal' });
    expect(reversalEntry?.amountMicroUsd).toBe(-CREDIT_036);
    expect(reversalEntry?.relatedEntryId).toBeDefined();

    const reconciled = await CallbackEvent.findOne({
      transactionId: 'r-tx-early',
    });
    expect(reconciled?.status).toBe('processed');
    expect(reconciled?.ledgerEntryId?.toString()).toBe(
      reversalEntry!._id.toString()
    );

    // A resent reversal must not debit a second time.
    const resend = await signedGet(reversalQuery).expect(200);
    expect(resend.body.data.status).toBe('duplicate');
    const walletAfter = await Wallet.findOne({ user: user._id });
    expect(walletAfter?.availableMicroUsd).toBe(0);
    expect(await LedgerEntry.countDocuments({ type: 'reversal' })).toBe(1);
  });
});
