import { describe, expect, it } from 'vitest';
import { distanceKm, formatDistance } from './geo.js';

describe('distanceKm', () => {
  it('is zero for the same point', () => {
    expect(distanceKm({ lat: 12.52, lng: 76.89 }, { lat: 12.52, lng: 76.89 })).toBe(0);
  });

  it('matches a known distance (Mandya → Mysuru ≈ 38 km straight line)', () => {
    const km = distanceKm({ lat: 12.5223, lng: 76.8975 }, { lat: 12.2958, lng: 76.6394 });
    expect(km).toBeGreaterThan(36);
    expect(km).toBeLessThan(40);
  });
});

describe('formatDistance', () => {
  it('uses metres under 1 km and km above', () => {
    expect(formatDistance(0.347)).toBe('350 m');
    expect(formatDistance(0.001)).toBe('10 m');
    expect(formatDistance(2.44)).toBe('2.4 km');
  });
});
