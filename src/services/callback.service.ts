import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { CallbackEvent } from '../models/callbackEvent.model.js';
import { LedgerEntry } from '../models/ledgerEntry.model.js';
import { User } from '../models/user.model.js';
import { Wallet } from '../models/wallet.model.js';
import {
  AYET_NON_FINANCIAL_CALLBACK_TYPES,
  type AyetCallbackInput,
} from '../types/callback.types.js';

export type CallbackOutcome =
  | 'processed'
  | 'reversal_processed'
  | 'duplicate'
  | 'unknown_user'
  | 'ignored'
  | 'malformed'
  | 'error';

const NON_FINANCIAL_CALLBACK_TYPES = new Set<string>(
  AYET_NON_FINANCIAL_CALLBACK_TYPES
);

const PAYOUT_PATTERN = /^-?\d+(\.\d{1,6})?$/;

const parsePayoutMicroUsd = (value: string): number | null => {
  if (!PAYOUT_PATTERN.test(value)) {
    return null;
  }
  const negative = value.startsWith('-');
  const unsigned = negative ? value.slice(1) : value;
  const [intPart, fracPart = ''] = unsigned.split('.');
  const micro =
    Number(intPart) * 1_000_000 + Number(fracPart.padEnd(6, '0'));
  if (!Number.isSafeInteger(micro)) {
    return null;
  }
  return negative ? -micro : micro;
};

const userShareMicroUsd = (amountMicroUsd: number): number =>
  Math.sign(amountMicroUsd) *
  Math.floor((Math.abs(amountMicroUsd) * env.REWARD_SHARE_BPS) / 10_000);

const isDuplicateKeyError = (err: unknown): boolean =>
  typeof err === 'object' &&
  err !== null &&
  (err as { code?: unknown }).code === 11000;

// Only a duplicate on the CallbackEvent (provider, transactionId) index
// means this callback was already handled. A 11000 from any other unique
// index (e.g. LedgerEntry.externalTransactionId) is a real failure and must
// propagate so ayeT retries instead of the reward being dropped.
const isCallbackEventDuplicate = (
  err: unknown,
  transactionId: string
): boolean => {
  if (!isDuplicateKeyError(err)) {
    return false;
  }
  const keyValue = (err as { keyValue?: Record<string, unknown> }).keyValue;
  return (
    keyValue?.provider === 'ayet' && keyValue?.transactionId === transactionId
  );
};

interface CallbackFields {
  transactionId: string;
  externalIdentifier: string;
  payoutUsd: string;
  // Null when payout_usd is missing or unparseable. Financial callbacks are
  // gated on this before any money logic runs.
  payoutMicroUsd: number | null;
  isChargeback: boolean;
  callbackType?: string;
  isSandbox: boolean;
  adslotId?: string;
  rawQuery: string;
}

const toFields = (
  input: AyetCallbackInput,
  rawQuery: string
): CallbackFields => {
  const payoutUsd = input.payout_usd;

  return {
    transactionId: input.transaction_id,
    externalIdentifier: input.external_identifier,
    payoutUsd: payoutUsd ?? '',
    payoutMicroUsd:
      payoutUsd === undefined ? null : parsePayoutMicroUsd(payoutUsd),
    isChargeback:
      input.is_chargeback === '1' || input.callback_type === 'chargeback',
    callbackType: input.callback_type,
    isSandbox: input.is_sandbox === '1',
    adslotId: input.adslot_id,
    rawQuery,
  };
};

const recordOnly = async (
  fields: CallbackFields,
  dedupeTransactionId: string,
  status: 'processed' | 'unknown_user' | 'error',
  userId?: mongoose.Types.ObjectId,
  error?: string
): Promise<void> => {
  try {
    await CallbackEvent.create({
      provider: 'ayet',
      transactionId: dedupeTransactionId,
      externalIdentifier: fields.externalIdentifier,
      rawQuery: fields.rawQuery,
      rawPayoutUsd: fields.payoutUsd,
      payoutMicroUsd: fields.payoutMicroUsd ?? undefined,
      isChargeback: fields.isChargeback,
      user: userId,
      status,
      processedAt: new Date(),
      error,
    });
  } catch (err) {
    if (!isDuplicateKeyError(err)) {
      throw err;
    }
  }
};

// A full chargeback (reversal payout magnitude equal to the original
// network payout) claws back exactly the amount that was credited, so the
// debit stays correct even if REWARD_SHARE_BPS changes between the reward
// and the reversal. Any other magnitude keeps the share-of-payout calc,
// which preserves partial-reversal and over-reversal (negative balance)
// behavior.
const reversalDebitMicroUsd = (
  reversalPayoutMicroUsd: number,
  originalEntry: {
    amountMicroUsd: number;
    networkPayoutMicroUsd?: number;
  }
): number => {
  const originalPayout = Math.abs(originalEntry.networkPayoutMicroUsd ?? 0);
  if (
    originalPayout > 0 &&
    Math.abs(reversalPayoutMicroUsd) === originalPayout
  ) {
    return -originalEntry.amountMicroUsd;
  }
  return userShareMicroUsd(-Math.abs(reversalPayoutMicroUsd));
};

// A reversal can arrive before the reward it reverses (ayeT retries and
// reordering). Those are stored as 'error'/ORIGINAL_NOT_FOUND; when the
// original reward commits, apply the pending debit in the same transaction
// so the reversal takes effect exactly once.
const reconcilePendingReversal = async (
  session: mongoose.ClientSession,
  rewardTransactionId: string,
  rewardEntry: {
    _id: mongoose.Types.ObjectId;
    amountMicroUsd: number;
    networkPayoutMicroUsd?: number;
  },
  userId: mongoose.Types.ObjectId
): Promise<void> => {
  const reversalTransactionId = `r-${rewardTransactionId}`;
  const pending = await CallbackEvent.findOne({
    provider: 'ayet',
    transactionId: reversalTransactionId,
    isChargeback: true,
    status: 'error',
    error: 'ORIGINAL_NOT_FOUND',
  }).session(session);

  if (
    !pending ||
    pending.payoutMicroUsd === undefined ||
    !pending.user?.equals(userId)
  ) {
    return;
  }

  const debitMicroUsd = reversalDebitMicroUsd(
    pending.payoutMicroUsd,
    rewardEntry
  );

  let reversalEntryId: mongoose.Types.ObjectId | undefined;
  if (debitMicroUsd !== 0) {
    const [reversalEntry] = await LedgerEntry.create(
      [
        {
          user: userId,
          type: 'reversal',
          amountMicroUsd: debitMicroUsd,
          networkPayoutMicroUsd: pending.payoutMicroUsd,
          currency: env.CURRENCY_CODE,
          externalTransactionId: reversalTransactionId,
          callbackEventId: pending._id,
          relatedEntryId: rewardEntry._id,
          availableAt: new Date(),
        },
      ],
      { session }
    );
    reversalEntryId = reversalEntry._id;

    await Wallet.findOneAndUpdate(
      { user: userId },
      { $inc: { availableMicroUsd: debitMicroUsd } },
      { session }
    );
  }

  await CallbackEvent.updateOne(
    { _id: pending._id },
    {
      $set: {
        status: 'processed',
        processedAt: new Date(),
        ...(reversalEntryId ? { ledgerEntryId: reversalEntryId } : {}),
      },
    },
    { session }
  );
};

const processReward = async (
  fields: CallbackFields,
  user: { _id: mongoose.Types.ObjectId }
): Promise<CallbackOutcome> => {
  const payoutMicroUsd = fields.payoutMicroUsd;
  if (payoutMicroUsd === null) {
    return 'error';
  }
  const creditMicroUsd = userShareMicroUsd(payoutMicroUsd);

  // A non-positive payout on a conversion credits nothing.
  if (creditMicroUsd <= 0) {
    await recordOnly(fields, fields.transactionId, 'processed', user._id);
    return 'ignored';
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const [event] = await CallbackEvent.create(
        [
          {
            provider: 'ayet',
            transactionId: fields.transactionId,
            externalIdentifier: fields.externalIdentifier,
            rawQuery: fields.rawQuery,
            rawPayoutUsd: fields.payoutUsd,
            payoutMicroUsd,
            isChargeback: false,
            user: user._id,
            status: 'received',
          },
        ],
        { session }
      );

      const [entry] = await LedgerEntry.create(
        [
          {
            user: user._id,
            type: 'reward',
            amountMicroUsd: creditMicroUsd,
            networkPayoutMicroUsd: payoutMicroUsd,
            currency: env.CURRENCY_CODE,
            externalTransactionId: fields.transactionId,
            callbackEventId: event._id,
            availableAt: new Date(),
          },
        ],
        { session }
      );

      await Wallet.findOneAndUpdate(
        { user: user._id },
        { $inc: { availableMicroUsd: creditMicroUsd } },
        { upsert: true, session }
      );

      await CallbackEvent.updateOne(
        { _id: event._id },
        {
          $set: {
            status: 'processed',
            processedAt: new Date(),
            ledgerEntryId: entry._id,
          },
        },
        { session }
      );

      await reconcilePendingReversal(
        session,
        fields.transactionId,
        entry,
        user._id
      );
    });
    return 'processed';
  } catch (err) {
    if (isCallbackEventDuplicate(err, fields.transactionId)) {
      return 'duplicate';
    }
    throw err;
  } finally {
    await session.endSession();
  }
};

const processReversal = async (
  fields: CallbackFields,
  user: { _id: mongoose.Types.ObjectId }
): Promise<CallbackOutcome> => {
  const payoutMicroUsd = fields.payoutMicroUsd;
  if (payoutMicroUsd === null) {
    return 'error';
  }

  const originalTransactionId = fields.transactionId.startsWith('r-')
    ? fields.transactionId.slice(2)
    : fields.transactionId;

  const originalEntry = await LedgerEntry.findOne({
    externalTransactionId: originalTransactionId,
    type: 'reward',
  });

  if (!originalEntry || !originalEntry.user.equals(user._id)) {
    await recordOnly(
      fields,
      fields.transactionId,
      'error',
      user._id,
      'ORIGINAL_NOT_FOUND'
    );
    return 'error';
  }

  const debitMicroUsd = reversalDebitMicroUsd(payoutMicroUsd, originalEntry);

  if (debitMicroUsd === 0) {
    await recordOnly(fields, fields.transactionId, 'processed', user._id);
    return 'ignored';
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const [event] = await CallbackEvent.create(
        [
          {
            provider: 'ayet',
            transactionId: fields.transactionId,
            externalIdentifier: fields.externalIdentifier,
            rawQuery: fields.rawQuery,
            rawPayoutUsd: fields.payoutUsd,
            payoutMicroUsd,
            isChargeback: true,
            user: user._id,
            status: 'received',
          },
        ],
        { session }
      );

      const [entry] = await LedgerEntry.create(
        [
          {
            user: user._id,
            type: 'reversal',
            amountMicroUsd: debitMicroUsd,
            networkPayoutMicroUsd: payoutMicroUsd,
            currency: env.CURRENCY_CODE,
            externalTransactionId: fields.transactionId,
            callbackEventId: event._id,
            relatedEntryId: originalEntry._id,
            availableAt: new Date(),
          },
        ],
        { session }
      );

      await Wallet.findOneAndUpdate(
        { user: user._id },
        { $inc: { availableMicroUsd: debitMicroUsd } },
        { upsert: true, session }
      );

      await CallbackEvent.updateOne(
        { _id: event._id },
        {
          $set: {
            status: 'processed',
            processedAt: new Date(),
            ledgerEntryId: entry._id,
          },
        },
        { session }
      );
    });
    return 'reversal_processed';
  } catch (err) {
    if (isCallbackEventDuplicate(err, fields.transactionId)) {
      return 'duplicate';
    }
    throw err;
  } finally {
    await session.endSession();
  }
};

export const processAyetCallback = async (
  input: AyetCallbackInput,
  rawQuery: string
): Promise<CallbackOutcome> => {
  const fields = toFields(input, rawQuery);

  const knownAdslots = [
    env.AYET_ADSLOT_ID,
    env.AYET_REWARDED_VIDEO_ADSLOT_ID,
  ].filter((id): id is string => Boolean(id));

  if (
    fields.adslotId &&
    knownAdslots.length > 0 &&
    !knownAdslots.includes(fields.adslotId)
  ) {
    logger.warn(
      { transactionId: fields.transactionId, adslotId: fields.adslotId },
      'ayeT callback from unknown adslot'
    );
    await recordOnly(fields, fields.transactionId, 'error', undefined, 'UNKNOWN_ADSLOT');
    return 'error';
  }

  const isEventCallback =
    !fields.isSandbox &&
    !fields.isChargeback &&
    fields.callbackType !== undefined &&
    NON_FINANCIAL_CALLBACK_TYPES.has(fields.callbackType);

  if (fields.isSandbox || isEventCallback) {
    // callback_type is part of the key so distinct event types sharing a
    // transaction_id (e.g. optional vs iap) each get recorded, while an
    // identical resend still dedupes.
    const dedupeTransactionId = `${fields.transactionId}:${
      fields.isSandbox ? 'sandbox' : 'event'
    }:${fields.callbackType ?? 'none'}`;
    const user = await User.findOne({
      publicId: fields.externalIdentifier,
    }).select('_id');
    await recordOnly(
      fields,
      dedupeTransactionId,
      'processed',
      user?._id
    );
    return 'ignored';
  }

  const user = await User.findOne({ publicId: fields.externalIdentifier });
  if (!user) {
    logger.warn(
      { transactionId: fields.transactionId },
      'ayeT callback for unknown user'
    );
    await recordOnly(
      fields,
      fields.transactionId,
      'unknown_user'
    );
    return 'unknown_user';
  }

  // Everything past this point moves money, so a missing or unparseable
  // payout must be recorded as an error rather than processed or dropped.
  if (fields.payoutMicroUsd === null) {
    await recordOnly(
      fields,
      fields.transactionId,
      'error',
      user._id,
      'INVALID_PAYOUT'
    );
    return 'error';
  }

  if (fields.isChargeback) {
    return processReversal(fields, user);
  }

  return processReward(fields, user);
};
