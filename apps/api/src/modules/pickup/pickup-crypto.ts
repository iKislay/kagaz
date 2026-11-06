import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { PICKUP_CODE_ALPHABET, PICKUP_CODE_LENGTH } from '@kagaz/shared';
import { hmacHex, normalizeCode, randomCode } from '../../common/crypto/tokens.js';

/**
 * Pickup-code crypto (PRD FR-PICK-01/02, Appendix A.5):
 * - code: 8 chars from the unambiguous alphabet via CSPRNG (~40 bits)
 * - stored as HMAC-SHA256(pepper, code) for lookup + AES-256-GCM ciphertext for display
 * - plaintext is never persisted
 */
export class PickupCrypto {
  private readonly key: Buffer;

  constructor(
    private readonly pepper: string,
    encKeyBase64: string,
  ) {
    this.key = Buffer.from(encKeyBase64, 'base64');
    if (this.key.length !== 32) throw new Error('PICKUP_CODE_ENC_KEY must decode to 32 bytes');
  }

  generate(): string {
    return randomCode(PICKUP_CODE_LENGTH);
  }

  hmac(code: string): string {
    return hmacHex(this.pepper, normalizeCode(code));
  }

  /** Returns null if the input can't possibly be a pickup code (cheap pre-check). */
  normalize(input: string): string | null {
    const code = normalizeCode(input);
    if (code.length !== PICKUP_CODE_LENGTH) return null;
    for (const ch of code) if (!PICKUP_CODE_ALPHABET.includes(ch)) return null;
    return code;
  }

  /** "v1.<iv>.<tag>.<ciphertext>" (base64url parts). */
  encrypt(code: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([cipher.update(code, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', iv, tag, ct]
      .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
      .join('.');
  }

  decrypt(value: string): string {
    const [version, iv, tag, ct] = value.split('.');
    if (version !== 'v1' || !iv || !tag || !ct) throw new Error('Unsupported pickup code format');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(ct, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}
