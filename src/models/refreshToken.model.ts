import { Document, model, Schema, Types } from 'mongoose';

export interface IRefreshToken {
  user: Types.ObjectId;
  tokenHash: string;
  familyId: string;
  userAgent?: string;
  expiresAt: Date;
  usedAt?: Date;
  revokedAt?: Date;
}

export interface RefreshTokenDocument extends IRefreshToken, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const refreshTokenSchema = new Schema<RefreshTokenDocument>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    tokenHash: { type: String, required: true, unique: true },
    familyId: { type: String, required: true },
    userAgent: { type: String },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date },
    revokedAt: { type: Date },
  },
  { timestamps: true },
);

refreshTokenSchema.index({ user: 1, createdAt: -1 });
refreshTokenSchema.index({ familyId: 1 });
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshToken = model<RefreshTokenDocument>('RefreshToken', refreshTokenSchema);
