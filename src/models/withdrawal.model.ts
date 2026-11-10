import { Document, model, Schema, Types } from 'mongoose';

export type WithdrawalStatus = 'pending' | 'approved' | 'paid' | 'rejected';

export interface IWithdrawal {
  user: Types.ObjectId;
  amountMicroUsd: number;
  currency: string;
  status: WithdrawalStatus;
  method?: string;
  payoutDetails?: Record<string, unknown>;
  holdEntryId?: Types.ObjectId;
  releaseEntryId?: Types.ObjectId;
  reviewedBy?: Types.ObjectId;
  reviewedAt?: Date;
  rejectionReason?: string;
  paidAt?: Date;
  payoutReference?: string;
}

export interface WithdrawalDocument extends IWithdrawal, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const withdrawalSchema = new Schema<WithdrawalDocument>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    amountMicroUsd: { type: Number, required: true, min: 1 },
    currency: { type: String, required: true, default: 'USD' },
    status: {
      type: String,
      enum: ['pending', 'approved', 'paid', 'rejected'],
      default: 'pending',
    },
    method: { type: String },
    payoutDetails: { type: Schema.Types.Mixed, select: false },
    holdEntryId: { type: Schema.Types.ObjectId, ref: 'LedgerEntry' },
    releaseEntryId: { type: Schema.Types.ObjectId, ref: 'LedgerEntry' },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    rejectionReason: { type: String },
    paidAt: { type: Date },
    payoutReference: { type: String },
  },
  { timestamps: true },
);

withdrawalSchema.index({ user: 1, createdAt: -1 });
withdrawalSchema.index({ status: 1, createdAt: -1 });

export const Withdrawal = model<WithdrawalDocument>('Withdrawal', withdrawalSchema);
