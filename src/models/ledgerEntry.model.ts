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
  updatedAt: Date;
}

const ledgerEntrySchema = new Schema<LedgerEntryDocument>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: {
      type: String,
      enum: ['reward', 'reversal', 'withdrawal_hold', 'withdrawal_release', 'adjustment'],
      required: true,
    },
    amountMicroUsd: { type: Number, required: true },
    networkPayoutMicroUsd: { type: Number },
    currency: { type: String, required: true, default: 'USD' },
    externalTransactionId: { type: String, unique: true, sparse: true },
    callbackEventId: { type: Schema.Types.ObjectId, ref: 'CallbackEvent' },
    withdrawalId: { type: Schema.Types.ObjectId, ref: 'Withdrawal' },
    relatedEntryId: { type: Schema.Types.ObjectId, ref: 'LedgerEntry' },
    availableAt: { type: Date },
    note: { type: String },
  },
  { timestamps: true },
);

ledgerEntrySchema.index({ user: 1, createdAt: -1 });
ledgerEntrySchema.index({ availableAt: 1 });

export const LedgerEntry = model<LedgerEntryDocument>('LedgerEntry', ledgerEntrySchema);
