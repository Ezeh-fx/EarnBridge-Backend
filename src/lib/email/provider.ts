import { env } from '../../config/env.js';
import { createBrevoEmailProvider } from './brevoProvider.js';
import { createNodemailerEmailProvider } from './nodemailerProvider.js';
import type { EmailProvider } from './types.js';

let emailProvider: EmailProvider | undefined;

const formatFromAddress = (): string => {
  const fromName = env.EMAIL_FROM_NAME ?? env.EMAIL_APP_NAME;
  return `${fromName} <${env.EMAIL_FROM}>`;
};

export const getEmailProvider = (): EmailProvider => {
  if (!emailProvider) {
    if (env.EMAIL_PROVIDER === 'brevo') {
      if (!env.BREVO_API_KEY) {
        throw new Error('BREVO_API_KEY is required for the brevo email provider');
      }
      emailProvider = createBrevoEmailProvider({
        apiKey: env.BREVO_API_KEY,
        fromEmail: env.EMAIL_FROM,
        fromName: env.EMAIL_FROM_NAME ?? env.EMAIL_APP_NAME,
      });
    } else {
      if (!env.EMAIL_USER || !env.EMAIL_PASSWORD) {
        throw new Error(
          'EMAIL_USER and EMAIL_PASSWORD are required for the smtp email provider'
        );
      }
      emailProvider = createNodemailerEmailProvider({
        host: env.EMAIL_HOST,
        port: env.EMAIL_PORT,
        secure: env.EMAIL_SECURE,
        auth: {
          user: env.EMAIL_USER,
          pass: env.EMAIL_PASSWORD,
        },
        from: formatFromAddress(),
      });
    }
  }

  return emailProvider;
};
