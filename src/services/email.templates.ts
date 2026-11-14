import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import ejs from 'ejs';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { AppError } from '../lib/errors';
import { sanitizeEmailError } from '../lib/email/errors';

export type EmailTemplateName =
  | 'verification-otp'
  | 'password-reset'
  | 'account-notification';

export interface RenderedEmailTemplate {
  html: string;
  text: string;
}

interface TemplateFiles {
  html: string;
  text: string;
}

const templateFiles: Record<EmailTemplateName, TemplateFiles> = {
  'verification-otp': {
    html: 'verification-otp.html.ejs',
    text: 'verification-otp.txt.ejs',
  },
  'password-reset': {
    html: 'password-reset.html.ejs',
    text: 'password-reset.txt.ejs',
  },
  'account-notification': {
    html: 'account-notification.html.ejs',
    text: 'account-notification.txt.ejs',
  },
};

const renderTemplateFile = async (
  fileName: string,
  data: Record<string, unknown>
): Promise<string> => {
  const filePath = fileURLToPath(
    new URL(`./email/templates/${fileName}`, import.meta.url)
  );
  const template = await readFile(filePath, 'utf8');

  return ejs.render(template, data, {
    filename: filePath,
    cache: env.NODE_ENV === 'production',
  });
};

export const renderEmailTemplate = async (
  template: EmailTemplateName,
  data: Record<string, unknown>
): Promise<RenderedEmailTemplate> => {
  try {
    const files = templateFiles[template];
    const [html, text] = await Promise.all([
      renderTemplateFile(files.html, data),
      renderTemplateFile(files.text, data),
    ]);

    return { html, text };
  } catch (err) {
    logger.error(
      { template, err: sanitizeEmailError(err) },
      'Email template rendering failed'
    );
    throw AppError.internal(
      'EMAIL_TEMPLATE_RENDER_FAILED',
      'Failed to render email template'
    );
  }
};
