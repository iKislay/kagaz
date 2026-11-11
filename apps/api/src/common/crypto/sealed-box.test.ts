import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SealedBox } from './sealed-box.js';

const key = () => randomBytes(32).toString('base64');

describe('SealedBox (ADR-003 credentials at rest)', () => {
  it('round-trips and never contains the plaintext', () => {
    const box = new SealedBox(key());
    const sealed = box.seal('yp_live_secret', 'shop-1');
    expect(sealed).not.toContain('yp_live_secret');
    expect(box.open(sealed, 'shop-1')).toBe('yp_live_secret');
  });

  it('uses a fresh IV each time', () => {
    const box = new SealedBox(key());
    expect(box.seal('x', 'a')).not.toBe(box.seal('x', 'a'));
  });

  it('refuses another owner, another key and tampering', () => {
    const box = new SealedBox(key());
    const sealed = box.seal('secret', 'shop-1');
    expect(() => box.open(sealed, 'shop-2')).toThrow();
    expect(() => new SealedBox(key()).open(sealed, 'shop-1')).toThrow();
    const parts = sealed.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => box.open(parts.join('.'), 'shop-1')).toThrow();
  });

  it('rejects keys that are not 32 bytes', () => {
    expect(() => new SealedBox(Buffer.from('short').toString('base64'))).toThrow();
  });
});
