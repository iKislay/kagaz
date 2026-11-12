import { describe, expect, it } from 'vitest';
import {
  type Period,
  addMonths,
  balance,
  currentPeriod,
  istDay,
  istMidnight,
  overlaps,
  monthsAndDays,
  periodTotal,
  shopBalance,
  summarize,
} from './billing-math.js';

const period = (start: string, months: number, extra: Partial<Period> = {}): Period => ({
  status: 'ACTIVE',
  printerSeats: 2,
  periodStart: istMidnight(start),
  periodEnd: addMonths(start, months),
  ...extra,
});

describe('billing math (ADR-004)', () => {
  it('IST midnight and calendar months, clamped at month end', () => {
    expect(istMidnight('2026-11-12').toISOString()).toBe('2026-11-11T18:30:00.000Z');
    expect(istDay(istMidnight('2026-11-12'))).toBe('2026-11-12');
    expect(istDay(addMonths('2026-11-12', 1))).toBe('2026-12-12');
    expect(istDay(addMonths('2026-01-31', 1))).toBe('2026-02-28');
    expect(istDay(addMonths('2026-11-30', 3))).toBe('2027-02-28');
    expect(istDay(addMonths('2026-05-15', 12))).toBe('2027-05-15');
  });

  it('total = seats × price × months; leftover days at 1/30 of a month', () => {
    const start = istMidnight('2026-11-12');
    expect(periodTotal(3, 49_900, start, addMonths('2026-11-12', 12))).toBe(1_796_400);
    expect(monthsAndDays(start, istMidnight('2027-01-27'))).toEqual({ months: 2, days: 15 });
    // 2 seats × ₹500: 2 months = ₹2000, + 15 days = ₹500.
    expect(periodTotal(2, 50_000, start, istMidnight('2027-01-27'))).toBe(250_000);
    expect(periodTotal(1, 49_900, start, istMidnight('2026-11-13'))).toBe(1_663); // 1 day, rounded
    expect(() => periodTotal(3, 0.5, start, addMonths('2026-11-12', 1))).toThrow();
  });

  it('shop balance nets credit across non-cancelled subscriptions', () => {
    expect(
      shopBalance([
        { status: 'ACTIVE', totalPaise: 50_000, payments: [{ amountPaise: 100_000 }] },
        { status: 'ACTIVE', totalPaise: 80_000, payments: [] },
        { status: 'CANCELLED', totalPaise: 99_000, payments: [] },
      ]),
    ).toBe(30_000);
  });

  it('entitlement is the active period containing now; cancelled and future ones do not count', () => {
    const p = period('2026-11-01', 1);
    expect(currentPeriod([p], istMidnight('2026-11-15'))).toBe(p);
    expect(currentPeriod([p], istMidnight('2026-12-01'))).toBeNull(); // end is exclusive
    expect(currentPeriod([{ ...p, status: 'CANCELLED' }], istMidnight('2026-11-15'))).toBeNull();
    expect(currentPeriod([period('2026-12-01', 1)], istMidnight('2026-11-15'))).toBeNull();
  });

  it('back-to-back renewals do not overlap; overlapping ones do', () => {
    const a = period('2026-11-01', 1);
    expect(overlaps(a, period('2026-12-01', 1))).toBe(false);
    expect(overlaps(a, period('2026-11-20', 1))).toBe(true);
    expect(overlaps(a, period('2026-10-01', 3))).toBe(true);
  });

  it('summary: ACTIVE with days left, EXPIRED after the end, NONE without a plan', () => {
    const p = period('2026-11-01', 1);
    expect(summarize([p], istMidnight('2026-11-28'))).toMatchObject({
      status: 'ACTIVE',
      printerSeats: 2,
      daysLeft: 3,
    });
    expect(summarize([p], istMidnight('2026-12-05'))).toMatchObject({
      status: 'EXPIRED',
      printerSeats: 0,
    });
    expect(summarize([], new Date())).toMatchObject({ status: 'NONE', printerSeats: 0 });
  });

  it('balance includes negative corrections', () => {
    expect(
      balance(100_000, [
        { amountPaise: 60_000 },
        { amountPaise: 50_000 },
        { amountPaise: -10_000 },
      ]),
    ).toBe(0);
  });
});
