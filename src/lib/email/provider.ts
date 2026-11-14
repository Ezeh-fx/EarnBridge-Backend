import { env } from '../../config/env';
import { createNodemailerEmailProvider } from './nodemailerProvider';
import type { EmailProvider } from './types';

let emailProvider: EmailProvider | undefined;

const formatFromAddress = (): string => {
  const fromName = env.EMAIL_FROM_NAME ?? env.EMAIL_APP_NAME;
  return `${fromName} <${env.EMAIL_FROM}>`;
};

export const getEmailProvider = (): EmailProvider => {
  if (!emailProvider) {
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

  return emailProvider;
};
