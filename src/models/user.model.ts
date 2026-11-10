import { Document, model, Schema, Types } from 'mongoose';

export type UserRole = 'user' | 'admin';
export type UserStatus = 'active' | 'suspended' | 'deleted';

export interface IUser {
  email: string;
  displayName?: string;
  avatarUrl?: string;
  passwordHash?: string;
  googleId?: string;
  publicId: string;
  role: UserRole;
  status: UserStatus;
  lastLoginAt?: Date;
  deletedAt?: Date;
}

export interface UserDocument extends IUser, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<UserDocument>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    displayName: { type: String, trim: true },
    avatarUrl: { type: String },
    passwordHash: { type: String, select: false },
    googleId: { type: String, unique: true, sparse: true },
    publicId: { type: String, required: true, unique: true },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    status: { type: String, enum: ['active', 'suspended', 'deleted'], default: 'active' },
    lastLoginAt: { type: Date },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);

export const User = model<UserDocument>('User', userSchema);
