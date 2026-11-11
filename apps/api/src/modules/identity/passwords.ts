import { hash, verify } from '@node-rs/argon2';

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

/** Login identifiers: emails are compared lowercased; anything starting with + is a phone. */
export function loginWhere(login: string): { email: string } | { phone: string } {
  const trimmed = login.trim();
  return trimmed.startsWith('+') ? { phone: trimmed } : { email: trimmed.toLowerCase() };
}
