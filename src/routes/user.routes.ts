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
  updateProfileHandler,
  verifyOtp,
  verifyResetToken,
} from '../controllers/user.controller.js';
import {
  changePasswordRateLimit,
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
  updateProfileSchema,
  verifyOtpSchema,
  verifyResetTokenSchema,
  type RegisterInput,
} from '../types/user.types.js';

// validateBody runs before the guard so the email rule receives a
// validated string; malformed bodies are rejected before Arcjet runs.
const registerGuard = arcjetProtect(registerRateLimit, {
  failClosed: true,
  props: (req) => ({ email: (req.body as RegisterInput).email }),
});
const emailVerificationGuard = arcjetProtect(emailVerificationRateLimit, {
  failClosed: true,
});
const loginGuard = arcjetProtect(loginRateLimit, { failClosed: true });
const passwordResetGuard = arcjetProtect(passwordResetRateLimit, {
  failClosed: true,
});
const refreshGuard = arcjetProtect(refreshRateLimit, { failClosed: false });
const changePasswordGuard = arcjetProtect(changePasswordRateLimit, {
  failClosed: true,
  props: (req) => ({
    userId: req.user?.id.toString() ?? req.ip ?? 'unknown',
  }),
});

export const authRouter = Router();

authRouter.post(
  '/register',
  validateBody(registerSchema),
  registerGuard,
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
meRouter.patch(
  '/',
  requireAuth,
  validateBody(updateProfileSchema),
  updateProfileHandler
);
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
