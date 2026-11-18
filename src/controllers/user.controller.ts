import { Request, Response } from 'express';
import { AUTH_COOKIES } from '../config/constants.js';
import { env } from '../config/env.js';
import { HttpStatus } from '../config/httpStatus.js';
import { sendData } from '../lib/response.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  changePassword as changePasswordService,
  forgotPassword as forgotPasswordService,
  getMe,
  googleLogin,
  loginUser,
  logoutUser,
  refreshSession,
  registerUser,
  resetPassword as resetPasswordService,
  verifyEmailOtp,
  verifyPasswordResetToken,
  type AuthSession,
} from '../services/user.service.js';
import type {
  ChangePasswordInput,
  ForgotPasswordInput,
  GoogleAuthInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
  VerifyOtpInput,
  VerifyResetTokenInput,
} from '../types/user.types.js';

const cookieOptions = () => ({
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
});

const setAuthCookies = (res: Response, session: AuthSession): void => {
  const options = cookieOptions();
  res.cookie(AUTH_COOKIES.accessToken, session.accessToken, {
    ...options,
    maxAge: Math.max(0, session.accessTokenExpiresAt.getTime() - Date.now()),
  });
  res.cookie(AUTH_COOKIES.refreshToken, session.refreshToken, {
    ...options,
    maxAge: Math.max(0, session.refreshTokenExpiresAt.getTime() - Date.now()),
  });
};

const clearAuthCookies = (res: Response): void => {
  const options = cookieOptions();
  res.clearCookie(AUTH_COOKIES.accessToken, options);
  res.clearCookie(AUTH_COOKIES.refreshToken, options);
};

const userAgent = (req: Request): string | undefined =>
  req.get('user-agent') || undefined;

export const register = asyncHandler(async (req: Request, res: Response) => {
  await registerUser(req.body as RegisterInput);
  sendData(
    res,
    {
      message:
        'If this email can be registered, a verification code has been sent.',
    },
    HttpStatus.CREATED
  );
});

export const verifyOtp = asyncHandler(async (req: Request, res: Response) => {
  const user = await verifyEmailOtp(req.body as VerifyOtpInput);
  sendData(res, { user });
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const session = await loginUser(req.body as LoginInput, userAgent(req));
  setAuthCookies(res, session);
  sendData(res, { user: session.user });
});

export const google = asyncHandler(async (req: Request, res: Response) => {
  const session = await googleLogin(
    req.body as GoogleAuthInput,
    userAgent(req)
  );
  setAuthCookies(res, session);
  sendData(res, { user: session.user });
});

export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const refreshToken = req.cookies?.[AUTH_COOKIES.refreshToken] as
    | string
    | undefined;
  const session = await refreshSession(refreshToken, userAgent(req));
  setAuthCookies(res, session);
  sendData(res, { user: session.user });
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  const refreshToken = req.cookies?.[AUTH_COOKIES.refreshToken] as
    | string
    | undefined;
  await logoutUser(refreshToken);
  clearAuthCookies(res);
  sendData(res, { message: 'Logged out' });
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  const user = await getMe(req.user!.id);
  sendData(res, { user });
});

export const forgotPassword = asyncHandler(
  async (req: Request, res: Response) => {
    await forgotPasswordService(req.body as ForgotPasswordInput);
    sendData(res, {
      message: 'If an account exists for this email, reset instructions have been sent.',
    });
  }
);

export const verifyResetToken = asyncHandler(
  async (req: Request, res: Response) => {
    await verifyPasswordResetToken(req.body as VerifyResetTokenInput);
    sendData(res, { valid: true });
  }
);

export const resetPassword = asyncHandler(
  async (req: Request, res: Response) => {
    await resetPasswordService(req.body as ResetPasswordInput);
    sendData(res, { message: 'Password has been reset' });
  }
);

export const changePassword = asyncHandler(
  async (req: Request, res: Response) => {
    await changePasswordService(req.user!.id, req.body as ChangePasswordInput);
    clearAuthCookies(res);
    sendData(res, { message: 'Password has been updated' });
  }
);
