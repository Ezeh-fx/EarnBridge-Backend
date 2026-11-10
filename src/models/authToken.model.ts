import { Document, model, Schema, Types } from 'mongoose';

export type AuthTokenType = 'password_reset' | 'email_verification';

export interface IAuthToken {
  user: Types.ObjectId;
  type: AuthTokenType;
  tokenHash: string;
  expiresAt: Date;
  usedAt?: Date;
}

export interface AuthTokenDocument extends IAuthToken, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const authTokenSchema = new Schema<AuthTokenDocument>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['password_reset', 'email_verification'], required: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date },
  },
  { timestamps: true },
);

authTokenSchema.index({ user: 1, type: 1 });
authTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const AuthToken = model<AuthTokenDocument>('AuthToken', authTokenSchema);
