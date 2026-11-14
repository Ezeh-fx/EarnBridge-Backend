export interface SanitizedEmailError {
  name?: string;
  code?: string;
  responseCode?: number;
  message?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export const sanitizeEmailError = (err: unknown): SanitizedEmailError => {
  if (err instanceof Error) {
    const record = err as Error & {
      code?: unknown;
      responseCode?: unknown;
    };

    return {
      name: err.name,
      message: err.message.slice(0, 500),
      code: typeof record.code === 'string' ? record.code : undefined,
      responseCode:
        typeof record.responseCode === 'number'
          ? record.responseCode
          : undefined,
    };
  }

  return {
    message: String(err).slice(0, 500),
  };
};

export const getEmailErrorCode = (err: unknown): string | undefined => {
  if (!isRecord(err)) {
    return undefined;
  }

  return typeof err.code === 'string' ? err.code : undefined;
};

export const getEmailErrorResponseCode = (err: unknown): number | undefined => {
  if (!isRecord(err)) {
    return undefined;
  }

  return typeof err.responseCode === 'number' ? err.responseCode : undefined;
};
