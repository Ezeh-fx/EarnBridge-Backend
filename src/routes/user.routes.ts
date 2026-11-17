import { Router } from 'express';
import {
  changePassword,
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
} from '../controllers/user.controller';
import {
  emailVerificationRateLimit,
  loginRateLimit,
  passwordResetRateLimit,
  refreshRateLimit,
  registerRateLimit,
} from '../lib/arcjet';
import { arcjetProtect } from '../middleware/arcjet';
import { requireAuth } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
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
} from '../types/user.types';

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
meRouter.post(
  '/password',
  requireAuth,
  changePasswordGuard,
  validateBody(changePasswordSchema),
  changePassword
);
