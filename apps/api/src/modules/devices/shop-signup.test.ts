import { describe, expect, it } from 'vitest';
import { signupSlug } from './shop-signup.js';

const SLUG = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/; // AdminShopCreateRequestSchema + /s/<slug> QR route

describe('signupSlug', () => {
  it('builds a URL-safe slug from the shop name plus a suffix', () => {
    expect(signupSlug('Raju Xerox & Prints!', 'k7m2')).toBe('raju-xerox-prints-k7m2');
    expect(signupSlug('  ಕನ್ನಡ ಪ್ರಿಂಟ್ಸ್ ', 'ab12')).toBe('shop-ab12');
    expect(signupSlug('A'.repeat(80), 'zz99')).toBe(`${'a'.repeat(40)}-zz99`);
    expect(signupSlug('Shop ---- 1 -', 'x1y2')).toBe('shop-1-x1y2');
  });

  it('always matches the slug format used by admin create and QR codes', () => {
    for (const name of ['Raju Xerox', '!!!', 'é Print', 'x'.repeat(200), 'Shop-'.repeat(20)]) {
      expect(signupSlug(name)).toMatch(SLUG);
    }
  });
});
