import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { PICKUP_CODE_ALPHABET } from '@kagaz/shared';

/** Opaque bearer secret (tracking tokens, device tokens). 32 random bytes, base64url. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Hash for storing bearer tokens server-side. High-entropy input, so plain SHA-256 is fine. */
export function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Keyed hash for low-entropy secrets (pickup/enrollment codes): resists offline guessing. */
export function hmacHex(key: string, value: string): string {
  return createHmac('sha256', key).update(value).digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** CSPRNG string over an alphabet (default: the unambiguous pickup alphabet). */
export function randomCode(length: number, alphabet = PICKUP_CODE_ALPHABET): string {
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}

/** Uppercase and strip spaces/dashes so "abcd-efgh" and "ABCD EFGH" match "ABCDEFGH". */
export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '');
}

/** Split an 8-char code for display: ABCDEFGH → ABCD-EFGH. */
export function formatCode(code: string, separator = '-'): string {
  return code.length === 8 ? `${code.slice(0, 4)}${separator}${code.slice(4)}` : code;
}
