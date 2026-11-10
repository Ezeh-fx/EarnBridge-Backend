import { Document, model, Schema, Types } from 'mongoose';

export type CallbackEventStatus = 'received' | 'processed' | 'duplicate' | 'unknown_user' | 'error';

export interface ICallbackEvent {
  provider: string;
  transactionId: string;
  externalIdentifier: string;
  rawQuery?: string;
  payoutUsd: string;
  isChargeback: boolean;
  user?: Types.ObjectId;
  ledgerEntryId?: Types.ObjectId;
  status: CallbackEventStatus;
  processedAt?: Date;
  error?: string;
}

export interface CallbackEventDocument extends ICallbackEvent, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const callbackEventSchema = new Schema<CallbackEventDocument>(
  {
    provider: { type: String, required: true, default: 'ayet' },
    transactionId: { type: String, required: true },
    externalIdentifier: { type: String, required: true },
    rawQuery: { type: String },
    payoutUsd: { type: String, required: true },
    isChargeback: { type: Boolean, required: true, default: false },
    user: { type: Schema.Types.ObjectId, ref: 'User' },
    ledgerEntryId: { type: Schema.Types.ObjectId, ref: 'LedgerEntry' },
    status: {
      type: String,
      enum: ['received', 'processed', 'duplicate', 'unknown_user', 'error'],
      default: 'received',
    },
    processedAt: { type: Date },
    error: { type: String },
  },
  { timestamps: true },
);

callbackEventSchema.index({ transactionId: 1 });
callbackEventSchema.index({ externalIdentifier: 1 });
callbackEventSchema.index({ status: 1 });

export const CallbackEvent = model<CallbackEventDocument>('CallbackEvent', callbackEventSchema);
