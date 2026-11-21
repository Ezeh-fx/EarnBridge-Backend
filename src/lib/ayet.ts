import { Buffer } from 'node:buffer';
import { createHmac, timingSafeEqual } from 'node:crypto';

// Verification of ayeT server-to-server callback signatures.
// Implements the algorithm from the official docs:
// https://docs.ayet.io/publishers/callbacks/hmac-verification
// The callback URL's raw query string is parsed like PHP's parse_str(),
// parameter names are sorted by byte order, rebuilt with PHP urlencode()
// rules, and HMAC-SHA256'd with the publisher API key.

const SIGNATURE = /^[0-9a-f]{64}$/;
const SUPPORTED_KEY = /^[A-Za-z0-9_-]+$/;
const PRINTABLE_ASCII = /^[\x21-\x7E]*$/;
const UNRESERVED = /^[A-Za-z0-9._-]$/;
const HEX_PAIR = /^[0-9A-Fa-f]{2}$/;

const decode = (text: string): Buffer => {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const pair = text.slice(i + 1, i + 3);
    if (text[i] === '%' && HEX_PAIR.test(pair)) {
      bytes.push(Number.parseInt(pair, 16));
      i += 2;
    } else {
      bytes.push(text[i] === '+' ? 0x20 : text.charCodeAt(i));
    }
  }
  return Buffer.from(bytes);
};

const encode = (bytes: Buffer): string => {
  let text = '';
  for (const byte of bytes) {
    const char = String.fromCharCode(byte);
    if (UNRESERVED.test(char)) {
      text += char;
    } else if (byte === 0x20) {
      text += '+';
    } else {
      text += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    }
  }
  return text;
};

export interface CanonicalQuery {
  canonical: string;
  values: Map<string, string>;
}

export const canonicalAyetQuery = (
  rawQuery: string
): CanonicalQuery | null => {
  if (typeof rawQuery !== 'string' || !PRINTABLE_ASCII.test(rawQuery)) {
    return null;
  }

  const pairs = new Map<string, string>();
  const values = new Map<string, string>();

  for (const part of rawQuery.split('&')) {
    if (part === '') {
      continue;
    }
    const separator = part.indexOf('=');
    const key = decode(
      separator === -1 ? part : part.slice(0, separator)
    ).toString('latin1');
    const value = decode(separator === -1 ? '' : part.slice(separator + 1));

    if (!SUPPORTED_KEY.test(key) || pairs.has(key)) {
      return null;
    }

    pairs.set(key, `${key}=${encode(value)}`);
    values.set(key, value.toString('utf8'));
  }

  const sorted: string[] = [];
  for (const key of [...pairs.keys()].sort()) {
    sorted.push(pairs.get(key) as string);
  }

  return { canonical: sorted.join('&'), values };
};

export const verifyAyetCallback = (
  rawQuery: string,
  signature: string | undefined,
  apiKey: string
): Map<string, string> | null => {
  if (
    !apiKey ||
    typeof signature !== 'string' ||
    !SIGNATURE.test(signature)
  ) {
    return null;
  }

  const parsed = canonicalAyetQuery(rawQuery);
  if (parsed === null) {
    return null;
  }

  const expected = createHmac('sha256', apiKey)
    .update(parsed.canonical)
    .digest();

  return timingSafeEqual(expected, Buffer.from(signature, 'hex'))
    ? parsed.values
    : null;
};
