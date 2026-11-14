import { z } from 'zod';
import { env } from '../config/env';
import { HttpStatus } from '../config/httpStatus';
import { logger } from '../config/logger';
import { AppError } from '../lib/errors';
import {
  getEmailErrorCode,
  getEmailErrorResponseCode,
  getEmailProvider,
  sanitizeEmailError,
  type EmailDeliveryMetadata,
  type EmailProvider,
} from '../lib/email';
import { renderEmailTemplate } from './email.templates';

const emailAddressSchema = z.string().trim().email().max(320);
const hasNoLineBreaks = (value: string): boolean => !/[\r\n]/.test(value);

const sendEmailSchema = z
  .object({
    to: z.union([
      emailAddressSchema,
      z.array(emailAddressSchema).min(1).max(20),
    ]),
    subject: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .refine(hasNoLineBreaks, 'Subject must be a single line'),
    html: z.string().min(1).max(100_000),
    text: z.string().min(1).max(100_000).optional(),
    from: z
      .string()
      .trim()
      .min(3)
      .max(320)
      .refine(hasNoLineBreaks, 'Sender must be a single line')
      .optional(),
  })
  .strict();

const expiresInMinutesSchema = z.number().int().positive().max(1440);

const verificationOtpEmailSchema = z
  .object({
    email: emailAddressSchema,
    otp: z
      .string()
      .trim()
      .min(4)
      .max(32)
      .refine(hasNoLineBreaks, 'OTP must be a single line'),
    expiresInMinutes: expiresInMinutesSchema.optional(),
  })
  .strict();

const passwordResetEmailSchema = z
  .object({
    email: emailAddressSchema,
    resetUrl: z
      .string()
      .trim()
      .url()
      .max(2048)
      .refine((value) => {
        try {
          const protocol = new URL(value).protocol;
          return protocol === 'https:' || protocol === 'http:';
        } catch {
          return false;
        }
      }, 'Reset URL must use HTTP or HTTPS'),
    expiresInMinutes: expiresInMinutesSchema.optional(),
  })
  .strict();

const notificationEmailSchema = z
  .object({
    email: emailAddressSchema,
    subject: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .refine(hasNoLineBreaks, 'Subject must be a single line'),
    message: z.string().trim().min(1).max(10_000),
  })
  .strict();

export type SendEmailInput = z.input<typeof sendEmailSchema>;

export interface EmailExpiryOptions {
  expiresInMinutes?: number;
}

export interface EmailService {
  sendEmail(input: SendEmailInput): Promise<EmailDeliveryMetadata>;
  sendVerificationOTPEmail(
    email: string,
    otp: string,
    options?: EmailExpiryOptions
  ): Promise<EmailDeliveryMetadata>;
  sendPasswordResetEmail(
    email: string,
    resetUrl: string,
    options?: EmailExpiryOptions
  ): Promise<EmailDeliveryMetadata>;
  sendNotificationEmail(
    email: string,
    subject: string,
    message: string
  ): Promise<EmailDeliveryMetadata>;
  verifyEmailConnection(): Promise<void>;
}

const AUTH_ERROR_CODES = new Set(['EAUTH']);
const CONNECTION_ERROR_CODES = new Set([
  'ETIMEDOUT',
  'ESOCKET',
  'ECONNECTION',
  'ECONNRESET',
  'ECONNREFUSED',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EAI_AGAIN',
  'EDNS',
]);
const RECIPIENT_ERROR_CODES = new Set(['EENVELOPE', 'EINVALID']);
const TEMPORARY_RESPONSE_CODES = new Set([421, 450, 451, 452]);
const RECIPIENT_RESPONSE_CODES = new Set([550, 551, 553]);

const toEmailError = (
  err: unknown,
  operation: string,
  fallbackCode: string,
  fallbackMessage: string
): never => {
  logger.error(
    { operation, err: sanitizeEmailError(err) },
    'Email operation failed'
  );

  if (err instanceof AppError) {
    throw err;
  }

  const code = getEmailErrorCode(err);
  const responseCode = getEmailErrorResponseCode(err);

  if (
    (code !== undefined && AUTH_ERROR_CODES.has(code)) ||
    responseCode === 535
  ) {
    throw AppError.internal('EMAIL_AUTH_FAILED', 'Email authentication failed');
  }

  if (
    (code !== undefined && CONNECTION_ERROR_CODES.has(code)) ||
    (responseCode !== undefined && TEMPORARY_RESPONSE_CODES.has(responseCode))
  ) {
    throw AppError.internal(
      'EMAIL_CONNECTION_FAILED',
      'Email service is temporarily unavailable'
    );
  }

  if (
    (code !== undefined && RECIPIENT_ERROR_CODES.has(code)) ||
    (responseCode !== undefined && RECIPIENT_RESPONSE_CODES.has(responseCode))
  ) {
    throw new AppError(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'EMAIL_RECIPIENT_REJECTED',
      'Invalid recipient address'
    );
  }

  throw AppError.internal(fallbackCode, fallbackMessage);
};

const baseTemplateData = (): Record<string, unknown> => ({
  appName: env.EMAIL_APP_NAME,
  clientUrl: env.CLIENT_URL,
  currentYear: new Date().getFullYear(),
});

export const createEmailService = (provider?: EmailProvider): EmailService => {
  const getProvider = (): EmailProvider => provider ?? getEmailProvider();

  const sendEmail = async (input: SendEmailInput): Promise<EmailDeliveryMetadata> => {
    const message = sendEmailSchema.parse(input);

    try {
      const delivery = await getProvider().sendEmail(message);
      logger.info(
        {
          messageId: delivery.messageId,
          acceptedCount: delivery.acceptedCount,
          rejectedCount: delivery.rejectedCount,
        },
        'Email sent'
      );
      return delivery;
    } catch (err) {
      return toEmailError(err, 'sendEmail', 'EMAIL_DELIVERY_FAILED', 'Failed to send email');
    }
  };

  const sendVerificationOTPEmail = async (
    email: string,
    otp: string,
    options: EmailExpiryOptions = {}
  ): Promise<EmailDeliveryMetadata> => {
    const input = verificationOtpEmailSchema.parse({
      email,
      otp,
      expiresInMinutes: options.expiresInMinutes,
    });
    const { html, text } = await renderEmailTemplate('verification-otp', {
      ...baseTemplateData(),
      otp: input.otp,
      expiresInMinutes: input.expiresInMinutes,
    });

    return sendEmail({
      to: input.email,
      subject: `Your ${env.EMAIL_APP_NAME} verification code`,
      html,
      text,
    });
  };

  const sendPasswordResetEmail = async (
    email: string,
    resetUrl: string,
    options: EmailExpiryOptions = {}
  ): Promise<EmailDeliveryMetadata> => {
    const input = passwordResetEmailSchema.parse({
      email,
      resetUrl,
      expiresInMinutes: options.expiresInMinutes,
    });
    const { html, text } = await renderEmailTemplate('password-reset', {
      ...baseTemplateData(),
      resetUrl: input.resetUrl,
      expiresInMinutes: input.expiresInMinutes,
    });

    return sendEmail({
      to: input.email,
      subject: `Reset your ${env.EMAIL_APP_NAME} password`,
      html,
      text,
    });
  };

  const sendNotificationEmail = async (
    email: string,
    subject: string,
    message: string
  ): Promise<EmailDeliveryMetadata> => {
    const input = notificationEmailSchema.parse({ email, subject, message });
    const { html, text } = await renderEmailTemplate('account-notification', {
      ...baseTemplateData(),
      title: input.subject,
      message: input.message,
    });

    return sendEmail({
      to: input.email,
      subject: input.subject,
      html,
      text,
    });
  };

  const verifyEmailConnection = async (): Promise<void> => {
    try {
      await getProvider().verifyConnection();
      logger.info('Email SMTP connection verified');
    } catch (err) {
      toEmailError(
        err,
        'verifyEmailConnection',
        'EMAIL_CONNECTION_FAILED',
        'Failed to verify email connection'
      );
    }
  };

  return {
    sendEmail,
    sendVerificationOTPEmail,
    sendPasswordResetEmail,
    sendNotificationEmail,
    verifyEmailConnection,
  };
};

export const emailService = createEmailService();

export const sendEmail = emailService.sendEmail;
export const sendVerificationOTPEmail = emailService.sendVerificationOTPEmail;
export const sendPasswordResetEmail = emailService.sendPasswordResetEmail;
export const sendNotificationEmail = emailService.sendNotificationEmail;
export const verifyEmailConnection = emailService.verifyEmailConnection;
