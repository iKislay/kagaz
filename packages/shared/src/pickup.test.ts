import { describe, expect, it } from 'vitest';
import { formatPickupCode, formatPickupDate, kolkataBusinessDate } from './pickup.js';

describe('ADR-002: business date (Asia/Kolkata)', () => {
  it('ADR-002: the business day changes at midnight IST, not UTC', () => {
    // 18:29:59Z = 23:59:59 IST on the 7th; 18:30Z = 00:00 IST on the 8th.
    expect(kolkataBusinessDate(new Date('2026-11-07T18:29:59.999Z'))).toBe('2026-11-07');
    expect(kolkataBusinessDate(new Date('2026-11-07T18:30:00.000Z'))).toBe('2026-11-08');
    // Early UTC morning is already the same IST day.
    expect(kolkataBusinessDate(new Date('2026-11-07T00:00:00Z'))).toBe('2026-11-07');
  });

  it('ADR-002: crosses month and year ends', () => {
    expect(kolkataBusinessDate(new Date('2026-12-31T18:30:00Z'))).toBe('2027-01-01');
    expect(kolkataBusinessDate(new Date('2026-11-30T18:30:00Z'))).toBe('2026-12-01');
  });

  it('ADR-002: formats the pickup code with its date', () => {
    expect(formatPickupDate('2026-11-07')).toBe('7 Nov');
    expect(formatPickupDate('2027-01-21')).toBe('21 Jan');
    expect(formatPickupCode(7, '2026-11-07')).toBe('#7 · 7 Nov');
    expect(formatPickupDate('bad')).toBe('bad');
  });
});
