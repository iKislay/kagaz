import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM sealing for secrets stored at rest (ADR-003: per-shop provider API keys and
 * webhook secrets). Format: `v1.<iv b64url>.<tag b64url>.<ciphertext b64url>`.
 * The `aad` binds a sealed value to its owner (e.g. the shop id), so a sealed blob copied to
 * another row does not decrypt.
 */
export class SealedBox {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    this.key = Buffer.from(base64Key, 'base64');
    if (this.key.length !== 32) throw new Error('SealedBox key must be 32 bytes (base64)');
  }

  seal(plaintext: string, aad: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      'v1',
      iv.toString('base64url'),
      tag.toString('base64url'),
      ct.toString('base64url'),
    ].join('.');
  }

  /** Throws if the value was tampered with, sealed for another `aad`, or with another key. */
  open(sealed: string, aad: string): string {
    const [version, iv, tag, ct] = sealed.split('.');
    if (version !== 'v1' || !iv || !tag || ct === undefined) {
      throw new Error('SealedBox: unsupported format');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ct, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}
