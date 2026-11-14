import { describe, expect, it, vi } from 'vitest';
import {
  buildSmtpTransportOptions,
  createNodemailerEmailProvider,
  SMTP_CONNECTION_TIMEOUT_MS,
  SMTP_GREETING_TIMEOUT_MS,
  SMTP_SOCKET_TIMEOUT_MS,
} from '../lib/email/nodemailerProvider';
import type {
  EmailTransport,
  SmtpEmailProviderConfig,
} from '../lib/email/nodemailerProvider';

const config: SmtpEmailProviderConfig = {
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: 'sender@example.com',
    pass: 'test-app-password',
  },
  from: 'EarnBridge <sender@example.com>',
};

const createTransport = () => {
  const sendMail = vi.fn<EmailTransport['sendMail']>(async () => ({
    messageId: '<test-message@example.com>',
    accepted: ['user@example.com'],
    rejected: [],
  }));
  const verify = vi.fn<EmailTransport['verify']>(async () => true);
  const close = vi.fn<NonNullable<EmailTransport['close']>>(() => undefined);
  const transport: EmailTransport = { sendMail, verify, close };

  return { transport, sendMail, verify, close };
};

describe('SMTP transport configuration', () => {
  it('builds Gmail SMTP options with auth and timeouts', () => {
    expect(buildSmtpTransportOptions(config)).toEqual({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      requireTLS: false,
      auth: {
        user: 'sender@example.com',
        pass: 'test-app-password',
      },
      connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
      greetingTimeout: SMTP_GREETING_TIMEOUT_MS,
      socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
    });
  });

  it('requires STARTTLS when implicit TLS is disabled', () => {
    expect(
      buildSmtpTransportOptions({ ...config, port: 587, secure: false })
    ).toEqual(
      expect.objectContaining({
        port: 587,
        secure: false,
        requireTLS: true,
      })
    );
  });
});

describe('Nodemailer email provider', () => {
  it('sends email through the transport and returns delivery metadata', async () => {
    const { transport, sendMail } = createTransport();
    const provider = createNodemailerEmailProvider(config, transport);

    const result = await provider.sendEmail({
      to: ['user@example.com', 'other@example.com'],
      subject: 'Hello',
      html: '<p>Hello</p>',
      text: 'Hello',
    });

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: config.from,
        to: ['user@example.com', 'other@example.com'],
        subject: 'Hello',
        html: '<p>Hello</p>',
        text: 'Hello',
      })
    );
    expect(result).toEqual({
      messageId: '<test-message@example.com>',
      acceptedCount: 1,
      rejectedCount: 0,
    });
  });

  it('uses a caller-provided sender when supplied', async () => {
    const { transport, sendMail } = createTransport();
    const provider = createNodemailerEmailProvider(config, transport);

    await provider.sendEmail({
      to: 'user@example.com',
      subject: 'Hello',
      html: '<p>Hello</p>',
      from: 'Support <support@example.com>',
    });

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'Support <support@example.com>' })
    );
  });

  it('verifies the SMTP connection through the transport', async () => {
    const { transport, verify } = createTransport();
    const provider = createNodemailerEmailProvider(config, transport);

    await provider.verifyConnection();

    expect(verify).toHaveBeenCalledTimes(1);
  });

  it('propagates transport failures without swallowing them', async () => {
    const { transport, sendMail } = createTransport();
    sendMail.mockRejectedValueOnce(new Error('SMTP unavailable'));
    const provider = createNodemailerEmailProvider(config, transport);

    await expect(
      provider.sendEmail({
        to: 'user@example.com',
        subject: 'Hello',
        html: '<p>Hello</p>',
      })
    ).rejects.toThrow('SMTP unavailable');
  });

  it('closes the underlying transport when requested', async () => {
    const { transport, close } = createTransport();
    const provider = createNodemailerEmailProvider(config, transport);

    await provider.close?.();

    expect(close).toHaveBeenCalledTimes(1);
  });
});
