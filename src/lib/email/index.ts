export * from './types.js';
export {
  getEmailErrorCode,
  getEmailErrorResponseCode,
  sanitizeEmailError,
} from './errors.js';
export type { SanitizedEmailError } from './errors.js';
export { getEmailProvider } from './provider.js';
export {
  createBrevoEmailProvider,
  BREVO_REQUEST_TIMEOUT_MS,
} from './brevoProvider.js';
export type { BrevoEmailProviderConfig } from './brevoProvider.js';
export {
  buildSmtpTransportOptions,
  createNodemailerEmailProvider,
  createSmtpTransporter,
  SMTP_CONNECTION_TIMEOUT_MS,
  SMTP_GREETING_TIMEOUT_MS,
  SMTP_SOCKET_TIMEOUT_MS,
} from './nodemailerProvider.js';
export type {
  EmailTransport,
  EmailTransportSendInfo,
  SmtpEmailProviderConfig,
} from './nodemailerProvider.js';
