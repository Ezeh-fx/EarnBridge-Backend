import { Router } from 'express';
import {
  changePassword,
  deleteAccount,
  forgotPassword,
  google,
  login,
  logout,
  me,
  refresh,
  register,
  resetPassword,
  verifyOtp,
  verifyResetToken,
} from '../controllers/user.controller.js';
import {
  emailVerificationRateLimit,
  loginRateLimit,
  passwordResetRateLimit,
  refreshRateLimit,
  registerRateLimit,
} from '../lib/arcjet.js';
import { arcjetProtect } from '../middleware/arcjet.js';
import { requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import {
  changePasswordSchema,
  emptyBodySchema,
  forgotPasswordSchema,
  googleAuthSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  verifyOtpSchema,
  verifyResetTokenSchema,
} from '../types/user.types.js';

const registerGuard = arcjetProtect(registerRateLimit, { failClosed: true });
const emailVerificationGuard = arcjetProtect(emailVerificationRateLimit, {
  failClosed: true,
});
const loginGuard = arcjetProtect(loginRateLimit, { failClosed: true });
const passwordResetGuard = arcjetProtect(passwordResetRateLimit, {
  failClosed: true,
});
const refreshGuard = arcjetProtect(refreshRateLimit, { failClosed: false });
const changePasswordGuard = arcjetProtect(loginRateLimit, {
  failClosed: true,
});

export const authRouter = Router();

authRouter.post(
  '/register',
  registerGuard,
  validateBody(registerSchema),
  register
);
authRouter.post(
  '/verify-otp',
  emailVerificationGuard,
  validateBody(verifyOtpSchema),
  verifyOtp
);
authRouter.post('/login', loginGuard, validateBody(loginSchema), login);
authRouter.post(
  '/google',
  loginGuard,
  validateBody(googleAuthSchema),
  google
);
authRouter.post(
  '/forgot-password',
  passwordResetGuard,
  validateBody(forgotPasswordSchema),
  forgotPassword
);
authRouter.post(
  '/verify-reset-token',
  passwordResetGuard,
  validateBody(verifyResetTokenSchema),
  verifyResetToken
);
authRouter.post(
  '/reset-password',
  passwordResetGuard,
  validateBody(resetPasswordSchema),
  resetPassword
);
authRouter.post(
  '/refresh',
  refreshGuard,
  validateBody(emptyBodySchema),
  refresh
);
authRouter.post('/logout', validateBody(emptyBodySchema), logout);

export const meRouter = Router();

meRouter.get('/', requireAuth, me);
meRouter.delete(
  '/',
  requireAuth,
  validateBody(emptyBodySchema),
  deleteAccount
);
meRouter.post(
  '/password',
  requireAuth,
  changePasswordGuard,
  validateBody(changePasswordSchema),
  changePassword
);
