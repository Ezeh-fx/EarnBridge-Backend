import type { Types } from 'mongoose';
import type { UserRole } from '../models/user.model';

export interface AccessTokenPayload {
  sub: string;
  publicId: string;
  role: UserRole;
  type: 'access';
  iat?: number;
  exp?: number;
}

export interface AuthenticatedUser {
  id: Types.ObjectId;
  publicId: string;
  email: string;
  displayName?: string;
  role: UserRole;
  status: 'active' | 'suspended' | 'deleted';
}
