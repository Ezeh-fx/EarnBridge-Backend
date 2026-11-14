import { Request, Response, NextFunction } from 'express';

const escapeHtml = (unsafe: string): string => {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

// Fields that carry credentials, tokens, or URLs must not be mutated:
// escaping would corrupt passwords, OTPs, reset links, and signatures.
const SKIP_KEY = /pass|token|secret|otp|code|email|url|uri|hash/i;

const sanitizeValue = (value: unknown, key?: string): unknown => {
  if (typeof value === 'string') {
    return key && SKIP_KEY.test(key) ? value : escapeHtml(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, key));
  }
  if (value !== null && typeof value === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      sanitized[childKey] = sanitizeValue(childValue, childKey);
    }
    return sanitized;
  }
  return value;
};

export const xssSanitizer = (req: Request, _res: Response, next: NextFunction) => {
  // ayeT server-to-server callbacks must arrive byte-for-byte intact.
  if (req.path.startsWith('/v1/callbacks')) {
    next();
    return;
  }

  if (req.body) {
    req.body = sanitizeValue(req.body);
  }
  if (req.query) {
    req.query = sanitizeValue(req.query) as Request['query'];
  }
  if (req.params) {
    req.params = sanitizeValue(req.params) as Request['params'];
  }
  next();
};
