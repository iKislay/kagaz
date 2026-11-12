import { describe, expect, it } from 'vitest';
import { distanceKm, formatDistance, shopFromScannedText, shopOrderPath } from './geo.js';

describe('distanceKm', () => {
  it('is zero for the same point and symmetric', () => {
    const a = { latitude: 12.5223, longitude: 76.897 };
    const b = { latitude: 12.5303, longitude: 76.8889 };
    expect(distanceKm(a, a)).toBe(0);
    expect(distanceKm(a, b)).toBeCloseTo(distanceKm(b, a), 10);
  });

  it('matches a known distance (Mandya → Mysuru ≈ 41 km)', () => {
    const mandya = { latitude: 12.5218, longitude: 76.8951 };
    const mysuru = { latitude: 12.2958, longitude: 76.6394 };
    expect(distanceKm(mandya, mysuru)).toBeGreaterThan(36);
    expect(distanceKm(mandya, mysuru)).toBeLessThan(40);
  });
});

describe('formatDistance', () => {
  it.each([
    [0.004, '10 m'],
    [0.347, '350 m'],
    [1.44, '1.4 km'],
    [12.6, '13 km'],
  ])('%s km → %s', (km, text) => expect(formatDistance(km)).toBe(text));
});

describe('shopFromScannedText', () => {
  it('reads the short shop link on any host', () => {
    expect(shopFromScannedText('https://kagaz.in/s/demo-shop-a')).toBe('demo-shop-a');
    expect(shopFromScannedText('http://localhost:3000/s/Demo-Shop-B/')).toBe('demo-shop-b');
    expect(shopOrderPath('demo-shop-a')).toBe('/s/demo-shop-a');
  });

  it('reads the order link with a shop slug or id', () => {
    expect(shopFromScannedText('https://kagaz.in/order/new?shop=demo-shop-c')).toBe('demo-shop-c');
    expect(
      shopFromScannedText('https://kagaz.in/order/new?shop=01a1ac06-5dfd-75b8-bb53-07989a4cc631'),
    ).toBe('01a1ac06-5dfd-75b8-bb53-07989a4cc631');
  });

  it('rejects anything that is not a Kagaz shop link', () => {
    expect(shopFromScannedText('hello')).toBeNull();
    expect(shopFromScannedText('upi://pay?pa=x@upi')).toBeNull();
    expect(shopFromScannedText('javascript:alert(1)')).toBeNull();
    expect(shopFromScannedText('https://evil.example/login')).toBeNull();
    expect(shopFromScannedText('https://kagaz.in/s/../admin')).toBeNull();
  });
});
