import argon2 from 'argon2';
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import mongoose, { type ClientSession, type Types } from 'mongoose';
import {
  ACCESS_TOKEN_TYPE,
  EMAIL_VERIFICATION_OTP_TTL_MINUTES,
  PASSWORD_RESET_TTL_MINUTES,
} from '../config/constants.js';
import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import { verifyGoogleIdToken } from '../lib/google.js';
import { RefreshToken } from '../models/refreshToken.model.js';
import { User, type UserDocument } from '../models/user.model.js';
import {
  sendPasswordResetEmail,
  sendVerificationOTPEmail,
} from './email.service.js';
import type { PublicUser } from '../types/auth.types.js';
import type {
  ChangePasswordInput,
  ForgotPasswordInput,
  GoogleAuthInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
  VerifyOtpInput,
  VerifyResetTokenInput,
  UpdateProfileInput,
} from '../types/user.types.js';

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
  user: PublicUser;
}

const sha256 = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

const generateOpaqueToken = (): string => randomBytes(32).toString('base64url');

const generateOtp = (): string =>
  randomInt(0, 1_000_000).toString().padStart(6, '0');

const durationToMs = (value: string): number => {
  const match = /^(\d+)(ms|s|m|h|d|w|y)$/.exec(value.trim());
  if (!match) {
    throw AppError.internal(
      'INVALID_TOKEN_EXPIRY',
      'Token expiry configuration is invalid'
    );
  }

  const units: Record<string, number> = {
    ms: 1,
    s: 1_000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
    w: 604_800_000,
    y: 31_536_000_000,
  };
  const ms = Number(match[1]) * units[match[2]];

  if (!Number.isSafeInteger(ms) || ms <= 0) {
    throw AppError.internal(
      'INVALID_TOKEN_EXPIRY',
      'Token expiry configuration is invalid'
    );
  }

  return ms;
};

const toPublicUser = (user: UserDocument): PublicUser => ({
  id: user._id.toString(),
  publicId: user.publicId,
  email: user.email,
  displayName: user.displayName || undefined,
  avatarUrl: user.avatarUrl || undefined,
  role: user.role,
  emailVerified: Boolean(user.emailVerifiedAt),
});

const invalidCredentials = (): AppError =>
  AppError.unauthorized('INVALID_CREDENTIALS', 'Invalid email or password');

let dummyPasswordHash: string | undefined;

const getDummyPasswordHash = async (): Promise<string> => {
  dummyPasswordHash ??= await argon2.hash('timing-equalization-placeholder');
  return dummyPasswordHash;
};

const isDuplicateKeyError = (err: unknown): boolean =>
  typeof err === 'object' &&
  err !== null &&
  (err as { code?: unknown }).code === 11000;

const sendVerificationOtp = async (user: UserDocument): Promise<void> => {
  const otp = generateOtp();
  user.emailVerificationOtpHash = await argon2.hash(otp);
  user.emailVerificationOtpExpiresAt = new Date(
    Date.now() + EMAIL_VERIFICATION_OTP_TTL_MINUTES * 60_000
  );
  await user.save();
  await sendVerificationOTPEmail(user.email, otp, {
    expiresInMinutes: EMAIL_VERIFICATION_OTP_TTL_MINUTES,
  });
};

export const registerUser = async (input: RegisterInput): Promise<void> => {
  const existing = await User.findOne({ email: input.email }).select(
    '+passwordHash'
  );

  if (existing) {
    if (
      existing.status === 'active' &&
      existing.passwordHash &&
      !existing.emailVerifiedAt
    ) {
      existing.passwordHash = await argon2.hash(input.password);
      await sendVerificationOtp(existing);
    }
    return;
  }

  const passwordHash = await argon2.hash(input.password);

  try {
    const user = await User.create({
      email: input.email,
      passwordHash,
      displayName: input.displayName,
      publicId: randomUUID(),
      role: 'user',
      status: 'active',
    });

    await sendVerificationOtp(user);
  } catch (err) {
    if (!isDuplicateKeyError(err)) {
      throw err;
    }

    const racedUser = await User.findOne({ email: input.email }).select(
      '+passwordHash'
    );
    if (
      racedUser?.status === 'active' &&
      racedUser.passwordHash &&
      !racedUser.emailVerifiedAt
    ) {
      racedUser.passwordHash = await argon2.hash(input.password);
      await sendVerificationOtp(racedUser);
    }
  }
};

export const verifyEmailOtp = async (
  input: VerifyOtpInput
): Promise<PublicUser> => {
  const user = await User.findOne({ email: input.email }).select(
    '+emailVerificationOtpHash +emailVerificationOtpExpiresAt'
  );

  if (!user || user.status !== 'active') {
    throw AppError.badRequest('INVALID_OTP', 'Invalid or expired OTP');
  }

  const otpHash = user.emailVerificationOtpHash;
  const otpExpiresAt = user.emailVerificationOtpExpiresAt;

  if (!otpHash || !otpExpiresAt || otpExpiresAt.getTime() <= Date.now()) {
    throw AppError.badRequest('INVALID_OTP', 'Invalid or expired OTP');
  }

  const otpMatches = await argon2.verify(otpHash, input.otp).catch(() => false);
  if (!otpMatches) {
    throw AppError.badRequest('INVALID_OTP', 'Invalid or expired OTP');
  }

  user.emailVerifiedAt = user.emailVerifiedAt ?? new Date();
  user.emailVerificationOtpHash = undefined;
  user.emailVerificationOtpExpiresAt = undefined;
  await user.save();

  return toPublicUser(user);
};

export const loginUser = async (
  input: LoginInput,
  userAgent?: string
): Promise<AuthSession> => {
  const user = await User.findOne({ email: input.email }).select(
    '+passwordHash'
  );

  const passwordHash = user?.passwordHash ?? (await getDummyPasswordHash());
  const passwordMatches = await argon2
    .verify(passwordHash, input.password)
    .catch(() => false);

  if (!user?.passwordHash || !passwordMatches) {
    throw invalidCredentials();
  }

  if (user.status === 'suspended') {
    throw AppError.forbidden('ACCOUNT_SUSPENDED', 'This account is suspended');
  }

  if (user.status !== 'active') {
    throw invalidCredentials();
  }

  if (!user.emailVerifiedAt) {
    throw AppError.forbidden(
      'EMAIL_NOT_VERIFIED',
      'Verify your email before logging in'
    );
  }

  user.lastLoginAt = new Date();
  await user.save();

  return issueAuthSession(user, userAgent);
};

export const googleLogin = async (
  input: GoogleAuthInput,
  userAgent?: string
): Promise<AuthSession> => {
  const googleUser = await verifyGoogleIdToken(input.idToken);
  let user = await User.findOne({ googleId: googleUser.googleId });

  if (!user) {
    const existingByEmail = await User.findOne({
      email: googleUser.email,
    }).select('_id googleId');

    if (existingByEmail) {
      throw AppError.conflict(
        'GOOGLE_ACCOUNT_LINK_REQUIRED',
        'An account already exists for this email. Log in with your password.'
      );
    }

    const displayName = [googleUser.firstName, googleUser.lastName]
      .filter(Boolean)
      .join(' ');

    user = await User.create({
      email: googleUser.email,
      displayName: displayName || undefined,
      avatarUrl: googleUser.picture,
      googleId: googleUser.googleId,
      publicId: randomUUID(),
      role: 'user',
      status: 'active',
      emailVerifiedAt: new Date(),
    });
  } else {
    if (user.status === 'suspended') {
      throw AppError.forbidden('ACCOUNT_SUSPENDED', 'This account is suspended');
    }

    if (user.status !== 'active') {
      throw AppError.unauthorized('UNAUTHORIZED', 'Authentication required');
    }

    const displayName = [googleUser.firstName, googleUser.lastName]
      .filter(Boolean)
      .join(' ');
    if (displayName) {
      user.displayName = displayName;
    }
    if (googleUser.picture) {
      user.avatarUrl = googleUser.picture;
    }
    user.emailVerifiedAt = user.emailVerifiedAt ?? new Date();
  }

  user.lastLoginAt = new Date();
  await user.save();

  return issueAuthSession(user, userAgent);
};

const issueAuthSession = async (
  user: UserDocument,
  userAgent?: string,
  options: { session?: ClientSession; familyId?: string } = {}
): Promise<AuthSession> => {
  const accessTokenExpiresAt = new Date(
    Date.now() + durationToMs(env.JWT_ACCESS_EXPIRY)
  );
  const refreshTokenExpiresAt = new Date(
    Date.now() + durationToMs(env.JWT_REFRESH_EXPIRY)
  );
  const accessToken = jwt.sign(
    {
      sub: user._id.toString(),
      publicId: user.publicId,
      role: user.role,
      type: ACCESS_TOKEN_TYPE,
    },
    env.JWT_ACCESS_SECRET,
    { expiresIn: env.JWT_ACCESS_EXPIRY as SignOptions['expiresIn'] }
  );
  const refreshToken = generateOpaqueToken();

  const refreshTokenDoc = new RefreshToken({
    user: user._id,
    tokenHash: sha256(refreshToken),
    familyId: options.familyId ?? randomUUID(),
    userAgent: userAgent?.slice(0, 512),
    expiresAt: refreshTokenExpiresAt,
  });

  if (options.session) {
    await refreshTokenDoc.save({ session: options.session });
  } else {
    await refreshTokenDoc.save();
  }

  return {
    accessToken,
    refreshToken,
    accessTokenExpiresAt,
    refreshTokenExpiresAt,
    user: toPublicUser(user),
  };
};

const revokeRefreshTokenFamily = async (familyId: string): Promise<void> => {
  await RefreshToken.updateMany(
    { familyId, revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() } }
  );
};

const revokeAllRefreshTokens = async (
  userId: Types.ObjectId | string,
  session?: ClientSession
) => {
  await RefreshToken.updateMany(
    { user: userId, revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() } },
    session ? { session } : undefined
  );
};

export const refreshSession = async (
  refreshToken: string | undefined,
  userAgent?: string
): Promise<AuthSession> => {
  if (!refreshToken) {
    throw AppError.unauthorized('INVALID_REFRESH_TOKEN', 'Invalid refresh token');
  }

  const tokenHash = sha256(refreshToken);
  const existing = await RefreshToken.findOne({ tokenHash });

  if (!existing) {
    throw AppError.unauthorized('INVALID_REFRESH_TOKEN', 'Invalid refresh token');
  }

  if (existing.revokedAt || existing.usedAt) {
    await revokeRefreshTokenFamily(existing.familyId);
    throw AppError.unauthorized(
      'REFRESH_TOKEN_REUSED',
      'Refresh token reuse detected'
    );
  }

  if (existing.expiresAt.getTime() <= Date.now()) {
    throw AppError.unauthorized('REFRESH_TOKEN_EXPIRED', 'Refresh token expired');
  }

  const session = await mongoose.startSession();
  let authSession: AuthSession | undefined;

  try {
    await session.withTransaction(async () => {
      const claimed = await RefreshToken.findOneAndUpdate(
        {
          _id: existing._id,
          usedAt: { $exists: false },
          revokedAt: { $exists: false },
          expiresAt: { $gt: new Date() },
        },
        { $set: { usedAt: new Date() } },
        { returnDocument: 'after', session }
      );

      if (!claimed) {
        throw AppError.unauthorized(
          'INVALID_REFRESH_TOKEN',
          'Invalid refresh token'
        );
      }

      const user = await User.findById(existing.user).session(session);
      if (!user || user.status !== 'active') {
        throw AppError.unauthorized('UNAUTHORIZED', 'Authentication required');
      }

      authSession = await issueAuthSession(user, userAgent, {
        session,
        familyId: existing.familyId,
      });
    });
  } catch (err) {
    if (err instanceof AppError && err.code === 'INVALID_REFRESH_TOKEN') {
      const latest = await RefreshToken.findById(existing._id);
      if (latest?.usedAt || latest?.revokedAt) {
        await revokeRefreshTokenFamily(latest.familyId);
        throw AppError.unauthorized(
          'REFRESH_TOKEN_REUSED',
          'Refresh token reuse detected'
        );
      }
    }
    throw err;
  } finally {
    await session.endSession();
  }

  if (!authSession) {
    throw AppError.internal('REFRESH_FAILED', 'Failed to refresh session');
  }

  return authSession;
};

export const logoutUser = async (
  refreshToken: string | undefined
): Promise<void> => {
  if (!refreshToken) {
    return;
  }

  await RefreshToken.updateOne(
    {
      tokenHash: sha256(refreshToken),
      usedAt: { $exists: false },
      revokedAt: { $exists: false },
    },
    { $set: { revokedAt: new Date() } }
  );
};

export const getMe = async (userId: Types.ObjectId | string) => {
  const user = await User.findById(userId);
  if (!user || user.status !== 'active') {
    throw AppError.unauthorized('UNAUTHORIZED', 'Authentication required');
  }
  return toPublicUser(user);
};

export const forgotPassword = async (
  input: ForgotPasswordInput
): Promise<void> => {
  const user = await User.findOne({ email: input.email }).select(
    '+passwordHash'
  );

  if (
    !user ||
    !user.passwordHash ||
    !user.emailVerifiedAt ||
    user.status !== 'active'
  ) {
    return;
  }

  const token = generateOpaqueToken();
  user.passwordResetTokenHash = sha256(token);
  user.passwordResetExpiresAt = new Date(
    Date.now() + PASSWORD_RESET_TTL_MINUTES * 60_000
  );
  await user.save();

  const resetUrl = `${env.CLIENT_URL.replace(/\/+$/, '')}/reset-password?token=${encodeURIComponent(
    token
  )}`;
  await sendPasswordResetEmail(user.email, resetUrl, {
    expiresInMinutes: PASSWORD_RESET_TTL_MINUTES,
  });
};

export const verifyPasswordResetToken = async (
  input: VerifyResetTokenInput
): Promise<void> => {
  const user = await User.findOne({
    passwordResetTokenHash: sha256(input.token),
    passwordResetExpiresAt: { $gt: new Date() },
    status: 'active',
  }).select('_id');

  if (!user) {
    throw AppError.badRequest(
      'INVALID_RESET_TOKEN',
      'Invalid or expired reset token'
    );
  }
};

export const resetPassword = async (
  input: ResetPasswordInput
): Promise<void> => {
  const passwordHash = await argon2.hash(input.newPassword);
  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      const user = await User.findOneAndUpdate(
        {
          passwordResetTokenHash: sha256(input.token),
          passwordResetExpiresAt: { $gt: new Date() },
          status: 'active',
        },
        {
          $set: { passwordHash },
          $unset: {
            passwordResetTokenHash: '',
            passwordResetExpiresAt: '',
          },
        },
        { returnDocument: 'after', session }
      );

      if (!user) {
        throw AppError.badRequest(
          'INVALID_RESET_TOKEN',
          'Invalid or expired reset token'
        );
      }

      await revokeAllRefreshTokens(user._id, session);
    });
  } finally {
    await session.endSession();
  }
};

export const changePassword = async (
  userId: Types.ObjectId | string,
  input: ChangePasswordInput
): Promise<void> => {
  const user = await User.findById(userId).select('+passwordHash');

  if (!user || !user.passwordHash) {
    throw AppError.badRequest('PASSWORD_NOT_SET', 'Password is not set');
  }

  const passwordMatches = await argon2
    .verify(user.passwordHash, input.oldPassword)
    .catch(() => false);

  if (!passwordMatches) {
    throw AppError.badRequest(
      'INVALID_CURRENT_PASSWORD',
      'Current password is incorrect'
    );
  }

  const passwordHash = await argon2.hash(input.newPassword);
  const result = await User.updateOne(
    { _id: user._id, passwordHash: user.passwordHash },
    {
      $set: { passwordHash },
      $unset: {
        passwordResetTokenHash: '',
        passwordResetExpiresAt: '',
      },
    }
  );

  if (result.matchedCount === 0) {
    throw AppError.badRequest(
      'INVALID_CURRENT_PASSWORD',
      'Current password is incorrect'
    );
  }

  await revokeAllRefreshTokens(user._id);
};

export const deleteUser = async (
  userId: Types.ObjectId | string
): Promise<void> => {
  const session = await mongoose.startSession();

  try {
    await session.withTransaction(async () => {
      const result = await User.updateOne(
        { _id: userId, status: 'active' },
        {
          $set: { status: 'deleted', deletedAt: new Date() },
          $unset: {
            passwordHash: '',
            emailVerificationOtpHash: '',
            emailVerificationOtpExpiresAt: '',
            passwordResetTokenHash: '',
            passwordResetExpiresAt: '',
          },
        },
        { session }
      );

      if (result.matchedCount === 0) {
        throw AppError.notFound('USER_NOT_FOUND', 'User not found');
      }

      await revokeAllRefreshTokens(userId, session);
    });
  } finally {
    await session.endSession();
  }
};

export const updateProfile = async (
  userId: Types.ObjectId | string,
  input: UpdateProfileInput
): Promise<PublicUser> => {
  const user = await User.findById(userId);

  if (!user || user.status !== 'active') {
    throw AppError.unauthorized('UNAUTHORIZED', 'Authentication required');
  }

  const newEmail = input.email;
  const emailChanged = newEmail !== undefined && newEmail !== user.email;

  if (emailChanged) {
    const existing = await User.findOne({ email: newEmail }).select('_id');
    if (existing) {
      throw AppError.conflict('EMAIL_TAKEN', 'Email is already in use');
    }
    user.email = newEmail;
    user.emailVerifiedAt = undefined;
  }

  if (input.displayName !== undefined) {
    user.displayName = input.displayName;
  }

  try {
    if (emailChanged) {
      // Saves the user (new email, cleared verification, OTP fields) then
      // emails the OTP to the new address.
      await sendVerificationOtp(user);
    } else {
      await user.save();
    }
  } catch (err) {
    if (isDuplicateKeyError(err)) {
      throw AppError.conflict('EMAIL_TAKEN', 'Email is already in use');
    }
    throw err;
  }

  return toPublicUser(user);
};
