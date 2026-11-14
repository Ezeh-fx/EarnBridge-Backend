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

ledgerEntrySchema.pre('save', async function (this: LedgerEntryDocument) {
  if (!this.isNew) {
    throw appendOnlyError();
  }
});

const blockMutation = async function (): Promise<void> {
  throw appendOnlyError();
};

ledgerEntrySchema.pre('deleteOne', { document: true, query: true }, blockMutation);
ledgerEntrySchema.pre('updateOne', { document: false, query: true }, blockMutation);
ledgerEntrySchema.pre('updateMany', { document: false, query: true }, blockMutation);
ledgerEntrySchema.pre('findOneAndUpdate', { document: false, query: true }, blockMutation);
ledgerEntrySchema.pre('replaceOne', { document: false, query: true }, blockMutation);
ledgerEntrySchema.pre('deleteMany', { document: false, query: true }, blockMutation);
ledgerEntrySchema.pre('findOneAndDelete', { document: false, query: true }, blockMutation);

ledgerEntrySchema.index({ user: 1, createdAt: -1 });
ledgerEntrySchema.index({ availableAt: 1 });
ledgerEntrySchema.index(
  { withdrawalId: 1 },
  {
    name: 'ledger_withdrawal_hold_unique',
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
    name: 'ledger_withdrawal_release_unique',
    unique: true,
    partialFilterExpression: {
      withdrawalId: { $exists: true },
      type: 'withdrawal_release',
    },
  }
);

export const LedgerEntry = model<LedgerEntryDocument>('LedgerEntry', ledgerEntrySchema);
