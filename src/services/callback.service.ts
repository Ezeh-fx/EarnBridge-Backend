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

interface CallbackFields {
  transactionId: string;
  externalIdentifier: string;
  payoutUsd: string;
  payoutMicroUsd: number;
  isChargeback: boolean;
  callbackType?: string;
  isSandbox: boolean;
  adslotId?: string;
  rawQuery: string;
}

const toFields = (
  input: AyetCallbackInput,
  rawQuery: string
): CallbackFields | null => {
  const payoutUsd = input.payout_usd;
  const payoutMicroUsd = payoutUsd ? parsePayoutMicroUsd(payoutUsd) : 0;
  if (payoutMicroUsd === null) {
    return null;
  }

  return {
    transactionId: input.transaction_id,
    externalIdentifier: input.external_identifier,
    payoutUsd: payoutUsd ?? '',
    payoutMicroUsd,
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
      payoutMicroUsd: fields.payoutMicroUsd,
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

const processReward = async (
  fields: CallbackFields,
  user: { _id: mongoose.Types.ObjectId }
): Promise<CallbackOutcome> => {
  const creditMicroUsd = userShareMicroUsd(fields.payoutMicroUsd);

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
            payoutMicroUsd: fields.payoutMicroUsd,
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
            networkPayoutMicroUsd: fields.payoutMicroUsd,
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
    });
    return 'processed';
  } catch (err) {
    if (isDuplicateKeyError(err)) {
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

  const debitMicroUsd = userShareMicroUsd(-Math.abs(fields.payoutMicroUsd));

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
            payoutMicroUsd: fields.payoutMicroUsd,
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
            networkPayoutMicroUsd: fields.payoutMicroUsd,
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
    if (isDuplicateKeyError(err)) {
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
  if (!fields) {
    return 'malformed';
  }

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
    const dedupeTransactionId = `${fields.transactionId}:${
      fields.isSandbox ? 'sandbox' : 'event'
    }`;
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

  if (fields.isChargeback) {
    return processReversal(fields, user);
  }

  return processReward(fields, user);
};
