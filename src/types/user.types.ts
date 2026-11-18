import { z } from 'zod';

const emailSchema = z.string().trim().toLowerCase().email().max(320);
const passwordSchema = z.string().min(8).max(128);
const otpSchema = z.string().regex(/^\d{6}$/, 'OTP must be 6 digits');
const resetTokenSchema = z
  .string()
  .trim()
  .min(32)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, 'Invalid reset token');

export const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    displayName: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

export const verifyOtpSchema = z
  .object({
    email: emailSchema,
    otp: otpSchema,
  })
  .strict();

export const loginSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1).max(128),
  })
  .strict();

export const googleAuthSchema = z
  .object({
    idToken: z.string().trim().min(1).max(8192),
  })
  .strict();

export const forgotPasswordSchema = z
  .object({
    email: emailSchema,
  })
  .strict();

export const verifyResetTokenSchema = z
  .object({
    token: resetTokenSchema,
  })
  .strict();

export const resetPasswordSchema = z
  .object({
    token: resetTokenSchema,
    newPassword: passwordSchema,
  })
  .strict();

export const emptyBodySchema = z.object({}).strict().optional();

export const changePasswordSchema = z
  .object({
    oldPassword: passwordSchema,
    newPassword: passwordSchema,
  })
  .strict();

export type RegisterInput = z.infer<typeof registerSchema>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type GoogleAuthInput = z.infer<typeof googleAuthSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type VerifyResetTokenInput = z.infer<typeof verifyResetTokenSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
