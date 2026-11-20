import type {
  EmailDeliveryMetadata,
  EmailMessage,
  EmailProvider,
} from './types.js';

export interface BrevoEmailProviderConfig {
  apiKey: string;
  fromEmail: string;
  fromName?: string;
  timeoutMs?: number;
}

const BREVO_API_BASE = 'https://api.brevo.com/v3';
export const BREVO_REQUEST_TIMEOUT_MS = 10_000;

interface ProviderError extends Error {
  code?: string;
}

const parseFromAddress = (from: string): { email: string; name?: string } => {
  const match = /^\s*(?:"([^"]*)"|([^<]*?))?\s*<([^>]+)>\s*$/.exec(from);
  if (match) {
    const name = (match[1] ?? match[2])?.trim();
    return { email: match[3], name: name || undefined };
  }
  return { email: from.trim() };
};

const requestError = (
  status: number,
  message: string
): ProviderError => {
  const err = new Error(message) as ProviderError;
  if (status === 401 || status === 403) {
    err.code = 'EAUTH';
  } else if (status === 429 || status >= 500) {
    err.code = 'ETIMEDOUT';
  }
  return err;
};

const fetchBrevo = async (
  config: Required<Pick<BrevoEmailProviderConfig, 'timeoutMs'>> &
    BrevoEmailProviderConfig,
  path: string,
  init: RequestInit
): Promise<Response> => {
  try {
    return await fetch(`${BREVO_API_BASE}${path}`, {
      ...init,
      headers: {
        'api-key': config.apiKey,
        accept: 'application/json',
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (err) {
    // Always wrap: AbortSignal.timeout rejects with a DOMException whose
    // legacy `code` property is read-only, so it cannot carry our SMTP-style
    // error code. Preserve the original as `cause`.
    const providerErr = new Error(
      err instanceof Error ? err.message : String(err),
      { cause: err }
    ) as ProviderError;
    providerErr.code =
      err instanceof Error && err.name === 'TimeoutError'
        ? 'ETIMEDOUT'
        : 'ECONNRESET';
    throw providerErr;
  }
};

const readErrorMessage = async (response: Response): Promise<string> => {
  try {
    const body: unknown = await response.json();
    if (
      typeof body === 'object' &&
      body !== null &&
      'message' in body &&
      typeof body.message === 'string'
    ) {
      return body.message;
    }
  } catch {
    // fall through to status text
  }
  return response.statusText || `HTTP ${response.status}`;
};

export const createBrevoEmailProvider = (
  config: BrevoEmailProviderConfig
): EmailProvider => {
  const timeoutMs = config.timeoutMs ?? BREVO_REQUEST_TIMEOUT_MS;
  const defaultSender = {
    email: config.fromEmail,
    ...(config.fromName ? { name: config.fromName } : {}),
  };

  return {
    sendEmail: async (message: EmailMessage): Promise<EmailDeliveryMetadata> => {
      const to = Array.isArray(message.to) ? message.to : [message.to];
      const sender = message.from
        ? parseFromAddress(message.from)
        : { email: defaultSender.email, name: defaultSender.name };

      const response = await fetchBrevo(
        { ...config, timeoutMs },
        '/smtp/email',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            sender,
            to: to.map((email) => ({ email })),
            subject: message.subject,
            ...(message.html ? { htmlContent: message.html } : {}),
            ...(message.text ? { textContent: message.text } : {}),
            ...(message.attachments?.length
              ? {
                  attachment: message.attachments.map((a) => ({
                    name: a.filename,
                    content: a.content.toString('base64'),
                  })),
                }
              : {}),
          }),
        }
      );

      if (!response.ok) {
        throw requestError(response.status, await readErrorMessage(response));
      }

      const body: unknown = await response.json().catch(() => ({}));
      const messageId =
        typeof body === 'object' &&
        body !== null &&
        'messageId' in body &&
        typeof body.messageId === 'string'
          ? body.messageId
          : '';

      return {
        messageId,
        acceptedCount: to.length,
        rejectedCount: 0,
      };
    },

    verifyConnection: async (): Promise<void> => {
      const response = await fetchBrevo(
        { ...config, timeoutMs },
        '/account',
        { method: 'GET' }
      );

      if (!response.ok) {
        throw requestError(response.status, await readErrorMessage(response));
      }
    },
  };
};
