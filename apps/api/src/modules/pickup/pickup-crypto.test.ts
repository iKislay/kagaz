import { describe, expect, it } from 'vitest';
import { PICKUP_CODE_ALPHABET } from '@kagaz/shared';
import { PickupCrypto } from './pickup-crypto.js';

const crypto = new PickupCrypto('p'.repeat(32), Buffer.alloc(32, 7).toString('base64'));

describe('PickupCrypto', () => {
  it('generates 8-char codes from the unambiguous alphabet', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const code = crypto.generate();
      expect(code).toHaveLength(8);
      for (const ch of code) expect(PICKUP_CODE_ALPHABET).toContain(ch);
      expect(code).not.toMatch(/[O0I1]/);
      seen.add(code);
    }
    expect(seen.size).toBe(500);
  });

  it('hmac is stable and ignores case, spaces and dashes', () => {
    expect(crypto.hmac('ABCD-EFGH')).toBe(crypto.hmac('abcd efgh'));
    expect(crypto.hmac('ABCDEFGH')).not.toBe(crypto.hmac('ABCDEFGJ'));
  });

  it('normalize rejects impossible codes', () => {
    expect(crypto.normalize('abcd-efgh')).toBe('ABCDEFGH');
    expect(crypto.normalize('ABCDEFG')).toBeNull();
    expect(crypto.normalize('ABCDEFG0')).toBeNull(); // 0 is not in the alphabet
  });

  it('encrypts and decrypts with a random IV', () => {
    const a = crypto.encrypt('ABCDEFGH');
    const b = crypto.encrypt('ABCDEFGH');
    expect(a).not.toBe(b);
    expect(a).not.toContain('ABCDEFGH');
    expect(crypto.decrypt(a)).toBe('ABCDEFGH');
  });

  it('detects tampering', () => {
    const parts = crypto.encrypt('ABCDEFGH').split('.');
    parts[3] = Buffer.from('XXXXXXXX').toString('base64url');
    expect(() => crypto.decrypt(parts.join('.'))).toThrow();
  });

  it('requires a 32-byte key', () => {
    expect(() => new PickupCrypto('p', Buffer.alloc(16).toString('base64'))).toThrow(/32 bytes/);
  });
});
