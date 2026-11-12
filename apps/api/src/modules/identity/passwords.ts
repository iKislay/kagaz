import { hash, verify } from '@node-rs/argon2';
import { normalizePhone } from '@kagaz/shared';

/**
 * Staff passwords (P2.3): Argon2id — @node-rs/argon2's default algorithm — with its
 * OWASP-aligned default cost parameters.
 * A fixed dummy hash is verified when the account doesn't exist, so an unknown login
 * takes as long as a wrong password (no timing-based enumeration).
 */
export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

let dummyHash: Promise<string> | null = null;

export async function verifyPassword(
  passwordHash: string | null | undefined,
  password: string,
): Promise<boolean> {
  if (!passwordHash) {
    dummyHash ??= hashPassword('kagaz-timing-equaliser');
    await verify(await dummyHash, password).catch(() => false);
    return false;
  }
  return verify(passwordHash, password).catch(() => false);
}

/**
 * Login identifiers: anything with an @ is an email (compared lowercased); everything else is a
 * phone number, normalized to E.164 so "98765 43210" finds +919876543210 (shop logins).
 */
export function loginWhere(login: string): { email: string } | { phone: string } {
  const trimmed = login.trim();
  return trimmed.includes('@')
    ? { email: trimmed.toLowerCase() }
    : { phone: normalizePhone(trimmed) };
}
