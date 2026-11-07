import { describe, expect, it } from 'vitest';
import { istDayBounds, maskPhone } from '@kagaz/shared';

describe('istDayBounds', () => {
  it('returns midnight-to-end-of-day in Asia/Kolkata (UTC+5:30)', () => {
    // 2026-01-15 10:00 UTC = 2026-01-15 15:30 IST
    const { start, end } = istDayBounds(new Date('2026-01-15T10:00:00Z'));
    expect(start.getTime()).toBe(new Date('2026-01-14T18:30:00Z').getTime());
    expect(end.getTime()).toBe(new Date('2026-01-15T18:29:59.999Z').getTime());
  });

  it('rolls to the next IST day after 18:30 UTC', () => {
    // 2026-01-15 18:40 UTC = 2026-01-16 00:10 IST
    const { start } = istDayBounds(new Date('2026-01-15T18:40:00Z'));
    expect(start.getTime()).toBe(new Date('2026-01-15T18:30:00Z').getTime());
  });

  it('now falls within the returned bounds', () => {
    const now = new Date();
    const { start, end } = istDayBounds(now);
    expect(now.getTime()).toBeGreaterThanOrEqual(start.getTime());
    expect(now.getTime()).toBeLessThanOrEqual(end.getTime());
  });
});

describe('maskPhone', () => {
  it('masks all digits except the last two', () => {
    expect(maskPhone('+919876543210')).toBe('+**********10');
  });

  it('returns null for null', () => {
    expect(maskPhone(null)).toBeNull();
  });

  it('leaves short numbers untouched', () => {
    expect(maskPhone('12')).toBe('12');
    expect(maskPhone('')).toBe('');
  });

  it('preserves non-digit characters', () => {
    expect(maskPhone('+91 98765 43210')).toBe('+** ***** ***10');
  });
});
