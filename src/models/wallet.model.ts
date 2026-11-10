import { Document, model, Schema, Types } from 'mongoose';

export interface IWallet {
  user: Types.ObjectId;
  availableMicroUsd: number;
  heldMicroUsd: number;
}

export interface WalletDocument extends IWallet, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const walletSchema = new Schema<WalletDocument>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    availableMicroUsd: { type: Number, required: true, default: 0, min: 0 },
    heldMicroUsd: { type: Number, required: true, default: 0, min: 0 },
  },
  { timestamps: true },
);

export const Wallet = model<WalletDocument>('Wallet', walletSchema);
