import { Document, model, Schema, Types } from 'mongoose';

export type LedgerEntryType =
  | 'reward'
  | 'reversal'
  | 'withdrawal_hold'
  | 'withdrawal_release'
  | 'adjustment';

export interface ILedgerEntry {
  user: Types.ObjectId;
  type: LedgerEntryType;
  amountMicroUsd: number;
  networkPayoutMicroUsd?: number;
  currency: string;
  externalTransactionId?: string;
  callbackEventId?: Types.ObjectId;
  withdrawalId?: Types.ObjectId;
  relatedEntryId?: Types.ObjectId;
  availableAt?: Date;
  note?: string;
}

export interface LedgerEntryDocument extends ILedgerEntry, Document {
  _id: Types.ObjectId;
  createdAt: Date;
}

const expectedAmountSign: Record<LedgerEntryType, 1 | -1 | 0> = {
  reward: 1,
  reversal: -1,
  withdrawal_hold: -1,
  withdrawal_release: 1,
  adjustment: 0,
};

const isSafeNonZeroInteger = (value: number) => Number.isSafeInteger(value) && value !== 0;

const ledgerEntrySchema = new Schema<LedgerEntryDocument>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: {
      type: String,
      enum: ['reward', 'reversal', 'withdrawal_hold', 'withdrawal_release', 'adjustment'],
      required: true,
    },
    amountMicroUsd: {
      type: Number,
      required: true,
      validate: {
        validator: function (this: unknown, value: number) {
          if (!isSafeNonZeroInteger(value)) {
            return false;
          }
          const entryType = (this as { type?: LedgerEntryType }).type;
          if (!entryType) {
            return false;
          }
          const expected = expectedAmountSign[entryType];
          if (expected === 0) {
            return true;
          }
          return Math.sign(value) === expected;
        },
        message: 'amountMicroUsd must be a nonzero safe integer with the correct sign for its type',
      },
    },
    networkPayoutMicroUsd: {
      type: Number,
      validate: {
        validator: (value: number) => Number.isSafeInteger(value),
        message: 'networkPayoutMicroUsd must be a safe integer',
      },
    },
    currency: { type: String, required: true, default: 'USD' },
    externalTransactionId: { type: String, unique: true, sparse: true },
    callbackEventId: { type: Schema.Types.ObjectId, ref: 'CallbackEvent' },
    withdrawalId: { type: Schema.Types.ObjectId, ref: 'Withdrawal' },
    relatedEntryId: { type: Schema.Types.ObjectId, ref: 'LedgerEntry' },
    availableAt: { type: Date },
    note: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

const appendOnlyError = () => new Error('LedgerEntry is append-only');

const lastArgAsNext = (args: unknown[]): ((err?: Error) => void) | undefined => {
  const next = args[args.length - 1];
  return typeof next === 'function' ? (next as (err?: Error) => void) : undefined;
};

ledgerEntrySchema.pre('save', function (this: LedgerEntryDocument, ...args: unknown[]) {
  const next = lastArgAsNext(args);
  if (!next) {
    return;
  }
  if (this.isNew) {
    next();
    return;
  }
  next(appendOnlyError());
});

ledgerEntrySchema.pre(
  'deleteOne',
  { document: true, query: false },
  function (...args: unknown[]) {
    lastArgAsNext(args)?.(appendOnlyError());
  }
);

const blockQueryMutation = function (...args: unknown[]) {
  lastArgAsNext(args)?.(appendOnlyError());
};

ledgerEntrySchema.pre('updateOne', blockQueryMutation);
ledgerEntrySchema.pre('updateMany', blockQueryMutation);
ledgerEntrySchema.pre('findOneAndUpdate', blockQueryMutation);
ledgerEntrySchema.pre('replaceOne', blockQueryMutation);
ledgerEntrySchema.pre('deleteOne', blockQueryMutation);
ledgerEntrySchema.pre('deleteMany', blockQueryMutation);
ledgerEntrySchema.pre('findOneAndDelete', blockQueryMutation);

ledgerEntrySchema.index({ user: 1, createdAt: -1 });
ledgerEntrySchema.index({ availableAt: 1 });
ledgerEntrySchema.index(
  { withdrawalId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      withdrawalId: { $exists: true },
      type: 'withdrawal_hold',
    },
  }
);
ledgerEntrySchema.index(
  { withdrawalId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      withdrawalId: { $exists: true },
      type: 'withdrawal_release',
    },
  }
);

export const LedgerEntry = model<LedgerEntryDocument>('LedgerEntry', ledgerEntrySchema);
