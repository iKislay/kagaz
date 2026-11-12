import { describe, expect, it } from 'vitest';
import { shopPathFromQr } from './qr.js';

const here = 'https://kaggaz.in';

describe('shopPathFromQr', () => {
  it('accepts Kaggaz shop codes', () => {
    expect(shopPathFromQr('https://kaggaz.in/s/demo-shop-a', here)).toBe('/s/demo-shop-a');
    expect(shopPathFromQr(' https://www.kaggaz.in/s/raju-xerox/ ', here)).toBe('/s/raju-xerox');
    expect(shopPathFromQr('http://localhost:3000/s/abc', 'http://localhost:3000')).toBe('/s/abc');
  });

  it('rejects other sites, schemes and paths', () => {
    expect(shopPathFromQr('https://evil.example/s/demo-shop-a', here)).toBeNull();
    expect(shopPathFromQr('https://kaggaz.in.evil.example/s/abc', here)).toBeNull();
    expect(shopPathFromQr('http://kaggaz.in/s/abc', here)).toBeNull();
    expect(shopPathFromQr('javascript:alert(1)', here)).toBeNull();
    expect(shopPathFromQr('https://kaggaz.in/order/123', here)).toBeNull();
    expect(shopPathFromQr('https://kaggaz.in/s/../admin', here)).toBeNull();
    expect(shopPathFromQr('not a url', here)).toBeNull();
  });
});
