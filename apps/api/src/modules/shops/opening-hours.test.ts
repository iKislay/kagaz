import { describe, expect, it } from 'vitest';
import { isWithinOpeningHours, kolkataClock } from './opening-hours.js';

// 2026-11-07 is a Saturday. 03:30Z = 09:00 IST.
const ist = (isoLocal: string) => new Date(`${isoLocal}+05:30`);
const DAILY = [['08:00', '21:00']];
const WEEK = { mon: DAILY, tue: DAILY, wed: DAILY, thu: DAILY, fri: DAILY, sat: DAILY, sun: [] };

describe('opening hours (Asia/Kolkata)', () => {
  it('converts to Kolkata local time', () => {
    expect(kolkataClock(new Date('2026-11-07T03:30:00Z'))).toEqual({ day: 'sat', minute: 540 });
    // 20:00Z Saturday = 01:30 IST Sunday
    expect(kolkataClock(new Date('2026-11-07T20:00:00Z'))).toEqual({ day: 'sun', minute: 90 });
  });

  it('open inside a window, closed outside, start inclusive, end exclusive', () => {
    expect(isWithinOpeningHours(WEEK, ist('2026-11-07T08:00:00'))).toBe(true);
    expect(isWithinOpeningHours(WEEK, ist('2026-11-07T20:59:00'))).toBe(true);
    expect(isWithinOpeningHours(WEEK, ist('2026-11-07T21:00:00'))).toBe(false);
    expect(isWithinOpeningHours(WEEK, ist('2026-11-07T07:59:00'))).toBe(false);
  });

  it('a day with no windows is closed; nothing configured means always open', () => {
    expect(isWithinOpeningHours(WEEK, ist('2026-11-08T12:00:00'))).toBe(false); // Sunday
    expect(isWithinOpeningHours({}, ist('2026-11-08T03:00:00'))).toBe(true);
    expect(isWithinOpeningHours(null)).toBe(true);
  });

  it('supports 24:00, split shifts and windows past midnight', () => {
    expect(isWithinOpeningHours({ sat: [['00:00', '24:00']] }, ist('2026-11-07T23:59:00'))).toBe(
      true,
    );
    const split = {
      sat: [
        ['09:00', '13:00'],
        ['15:00', '19:00'],
      ],
    };
    expect(isWithinOpeningHours(split, ist('2026-11-07T14:00:00'))).toBe(false);
    expect(isWithinOpeningHours(split, ist('2026-11-07T15:00:00'))).toBe(true);
    const night = { sat: [['20:00', '02:00']] };
    expect(isWithinOpeningHours(night, ist('2026-11-07T23:00:00'))).toBe(true);
    expect(isWithinOpeningHours(night, ist('2026-11-08T01:00:00'))).toBe(true); // Sunday 01:00
    expect(isWithinOpeningHours(night, ist('2026-11-08T03:00:00'))).toBe(false);
  });

  it('malformed config fails safe (closed)', () => {
    expect(isWithinOpeningHours({ sat: [['9am', '5pm']] }, ist('2026-11-07T12:00:00'))).toBe(false);
    expect(isWithinOpeningHours('always', ist('2026-11-07T12:00:00'))).toBe(false);
  });
});
