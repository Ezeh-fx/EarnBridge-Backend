export * from './types';
export {
  getEmailErrorCode,
  getEmailErrorResponseCode,
  sanitizeEmailError,
} from './errors';
export type { SanitizedEmailError } from './errors';
export { getEmailProvider } from './provider';
export {
  buildSmtpTransportOptions,
  createNodemailerEmailProvider,
  createSmtpTransporter,
  SMTP_CONNECTION_TIMEOUT_MS,
  SMTP_GREETING_TIMEOUT_MS,
  SMTP_SOCKET_TIMEOUT_MS,
} from './nodemailerProvider';
export type {
  EmailTransport,
  EmailTransportSendInfo,
  SmtpEmailProviderConfig,
} from './nodemailerProvider';
