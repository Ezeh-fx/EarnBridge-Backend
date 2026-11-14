import nodemailer from 'nodemailer';
import type { SendMailOptions, Transporter } from 'nodemailer';
import type {
  EmailDeliveryMetadata,
  EmailMessage,
  EmailProvider,
} from './types';

export interface SmtpEmailProviderConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
  from: string;
  connectionTimeout?: number;
  greetingTimeout?: number;
  socketTimeout?: number;
}

export interface EmailTransportSendInfo {
  messageId: string;
  accepted?: unknown[];
  rejected?: unknown[];
}

export interface EmailTransport {
  sendMail(options: SendMailOptions): Promise<EmailTransportSendInfo>;
  verify(): Promise<unknown>;
  close?(): void;
}

export const SMTP_CONNECTION_TIMEOUT_MS = 10_000;
export const SMTP_GREETING_TIMEOUT_MS = 10_000;
export const SMTP_SOCKET_TIMEOUT_MS = 20_000;

export const buildSmtpTransportOptions = (config: SmtpEmailProviderConfig) => ({
  host: config.host,
  port: config.port,
  secure: config.secure,
  auth: {
    user: config.auth.user,
    pass: config.auth.pass,
  },
  connectionTimeout: config.connectionTimeout ?? SMTP_CONNECTION_TIMEOUT_MS,
  greetingTimeout: config.greetingTimeout ?? SMTP_GREETING_TIMEOUT_MS,
  socketTimeout: config.socketTimeout ?? SMTP_SOCKET_TIMEOUT_MS,
});

export const createSmtpTransporter = (
  config: SmtpEmailProviderConfig
): Transporter => nodemailer.createTransport(buildSmtpTransportOptions(config));

export const createNodemailerEmailProvider = (
  config: SmtpEmailProviderConfig,
  transport: EmailTransport = createSmtpTransporter(config)
): EmailProvider => ({
  sendEmail: async (message: EmailMessage): Promise<EmailDeliveryMetadata> => {
    const info = await transport.sendMail({
      from: message.from ?? config.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });

    return {
      messageId: info.messageId,
      acceptedCount: info.accepted?.length ?? 0,
      rejectedCount: info.rejected?.length ?? 0,
    };
  },

  verifyConnection: async (): Promise<void> => {
    await transport.verify();
  },

  close: async (): Promise<void> => {
    transport.close?.();
  },
});
