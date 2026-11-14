import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import type {
  EmailDeliveryMetadata,
  EmailProvider,
} from '../lib/email';
import { createEmailService } from '../services/email.service';

const createProvider = () => {
  const sendEmail = vi.fn<EmailProvider['sendEmail']>(
    async (): Promise<EmailDeliveryMetadata> => ({
      messageId: '<test-message@example.com>',
      acceptedCount: 1,
      rejectedCount: 0,
    })
  );
  const verifyConnection = vi.fn<EmailProvider['verifyConnection']>(
    async () => undefined
  );
  const provider: EmailProvider = { sendEmail, verifyConnection };

  return { provider, sendEmail, verifyConnection };
};

const validMessage = {
  to: 'user@example.com',
  subject: 'Hello',
  html: '<p>Hello</p>',
  text: 'Hello',
};

describe('emailService.sendEmail', () => {
  it('sends a validated message and returns delivery metadata', async () => {
    const { provider, sendEmail } = createProvider();
    const service = createEmailService(provider);

    const result = await service.sendEmail({
      to: ['user@example.com', 'other@example.com'],
      subject: 'Hello',
      html: '<p>Hello</p>',
      text: 'Hello',
      from: 'Support <support@example.com>',
    });

    expect(sendEmail).toHaveBeenCalledWith({
      to: ['user@example.com', 'other@example.com'],
      subject: 'Hello',
      html: '<p>Hello</p>',
      text: 'Hello',
      from: 'Support <support@example.com>',
    });
    expect(result).toEqual({
      messageId: '<test-message@example.com>',
      acceptedCount: 1,
      rejectedCount: 0,
    });
  });

  it('rejects invalid recipients before calling the provider', async () => {
    const { provider, sendEmail } = createProvider();
    const service = createEmailService(provider);

    await expect(
      service.sendEmail({ ...validMessage, to: 'not-an-email' })
    ).rejects.toBeInstanceOf(ZodError);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('maps SMTP authentication failures to a sanitized app error', async () => {
    const { provider, sendEmail } = createProvider();
    sendEmail.mockRejectedValueOnce(
      Object.assign(new Error('Invalid login'), {
        code: 'EAUTH',
        responseCode: 535,
      })
    );
    const service = createEmailService(provider);

    await expect(service.sendEmail(validMessage)).rejects.toMatchObject({
      name: 'AppError',
      code: 'EMAIL_AUTH_FAILED',
      statusCode: 500,
    });
  });

  it('maps SMTP timeouts and unavailable connections to a service error', async () => {
    const { provider, sendEmail } = createProvider();
    sendEmail.mockRejectedValueOnce(
      Object.assign(new Error('Connection timed out'), { code: 'ETIMEDOUT' })
    );
    const service = createEmailService(provider);

    await expect(service.sendEmail(validMessage)).rejects.toMatchObject({
      code: 'EMAIL_CONNECTION_FAILED',
    });
  });

  it('maps SMTP recipient rejections to a validation error', async () => {
    const { provider, sendEmail } = createProvider();
    sendEmail.mockRejectedValueOnce(
      Object.assign(new Error('Mailbox unavailable'), { responseCode: 550 })
    );
    const service = createEmailService(provider);

    await expect(service.sendEmail(validMessage)).rejects.toMatchObject({
      code: 'EMAIL_RECIPIENT_REJECTED',
      statusCode: 422,
    });
  });

  it('maps unexpected delivery failures to a generic app error', async () => {
    const { provider, sendEmail } = createProvider();
    sendEmail.mockRejectedValueOnce(new Error('Provider exploded'));
    const service = createEmailService(provider);

    await expect(service.sendEmail(validMessage)).rejects.toMatchObject({
      code: 'EMAIL_DELIVERY_FAILED',
    });
  });
});

describe('dedicated email functions', () => {
  it('sends a verification OTP email with HTML and plain text', async () => {
    const { provider, sendEmail } = createProvider();
    const service = createEmailService(provider);

    await service.sendVerificationOTPEmail('user@example.com', '123456', {
      expiresInMinutes: 10,
    });

    const sent = sendEmail.mock.calls[0]?.[0];
    expect(sent).toMatchObject({
      to: 'user@example.com',
      subject: 'Your EarnBridge verification code',
    });
    expect(sent?.html ?? '').toContain('123456');
    expect(sent?.html ?? '').toContain('expires in 10 minutes');
    expect(sent?.text ?? '').toContain('123456');
  });

  it('sends a password reset email with an escaped HTML link and plain text', async () => {
    const { provider, sendEmail } = createProvider();
    const service = createEmailService(provider);
    const resetUrl =
      'https://app.example.com/reset-password?token=abc123&foo=bar';

    await service.sendPasswordResetEmail('user@example.com', resetUrl, {
      expiresInMinutes: 30,
    });

    const sent = sendEmail.mock.calls[0]?.[0];
    expect(sent).toMatchObject({
      to: 'user@example.com',
      subject: 'Reset your EarnBridge password',
    });
    expect(sent?.html ?? '').toContain('token=abc123&amp;foo=bar');
    expect(sent?.text ?? '').toContain('token=abc123&foo=bar');
  });

  it('rejects malformed password reset URLs with a validation error', async () => {
    const { provider, sendEmail } = createProvider();
    const service = createEmailService(provider);

    await expect(
      service.sendPasswordResetEmail('user@example.com', 'not a url')
    ).rejects.toBeInstanceOf(ZodError);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('sends a general account notification email', async () => {
    const { provider, sendEmail } = createProvider();
    const service = createEmailService(provider);

    await service.sendNotificationEmail(
      'user@example.com',
      'Withdrawal update',
      'Your withdrawal is being reviewed.'
    );

    const sent = sendEmail.mock.calls[0]?.[0];
    expect(sent).toMatchObject({
      to: 'user@example.com',
      subject: 'Withdrawal update',
    });
    expect(sent?.html ?? '').toContain('Your withdrawal is being reviewed.');
    expect(sent?.text ?? '').toContain('Your withdrawal is being reviewed.');
  });
});

describe('emailService.verifyEmailConnection', () => {
  it('verifies the provider connection successfully', async () => {
    const { provider, verifyConnection } = createProvider();
    const service = createEmailService(provider);

    await expect(service.verifyEmailConnection()).resolves.toBeUndefined();
    expect(verifyConnection).toHaveBeenCalledTimes(1);
  });

  it('maps connection failures to a sanitized app error', async () => {
    const { provider, verifyConnection } = createProvider();
    verifyConnection.mockRejectedValueOnce(
      Object.assign(new Error('Connection refused'), { code: 'ECONNREFUSED' })
    );
    const service = createEmailService(provider);

    await expect(service.verifyEmailConnection()).rejects.toMatchObject({
      code: 'EMAIL_CONNECTION_FAILED',
    });
  });
});
