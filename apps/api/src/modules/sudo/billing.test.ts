import { describe, expect, it } from 'vitest';
import {
  addInterval,
  daysLeft,
  istMonthBounds,
  isOverdue,
  monthlyRecurringPaise,
  newSubscriptionTerms,
  nextPeriod,
} from './billing.js';

const d = (iso: string) => new Date(iso);

describe('subscription billing math (/sudoadmin)', () => {
  it('adds calendar months and years, clamping to the last day of the month', () => {
    expect(addInterval(d('2026-01-31T10:00:00Z'), 'MONTHLY').toISOString()).toBe(
      '2026-02-28T10:00:00.000Z',
    );
    expect(addInterval(d('2028-01-31T00:00:00Z'), 'MONTHLY').toISOString()).toBe(
      '2028-02-29T00:00:00.000Z',
    );
    expect(addInterval(d('2026-12-15T00:00:00Z'), 'MONTHLY').toISOString()).toBe(
      '2027-01-15T00:00:00.000Z',
    );
    expect(addInterval(d('2028-02-29T00:00:00Z'), 'YEARLY').toISOString()).toBe(
      '2029-02-28T00:00:00.000Z',
    );
  });

  it('starts a trial covered until the trial ends, or ACTIVE with payment due now', () => {
    const start = d('2026-11-01T00:00:00Z');
    expect(newSubscriptionTerms(start, 14)).toEqual({
      status: 'TRIALING',
      currentPeriodStart: start,
      currentPeriodEnd: d('2026-11-15T00:00:00Z'),
      trialEndsAt: d('2026-11-15T00:00:00Z'),
    });
    const paid = newSubscriptionTerms(start, 0);
    expect(paid.status).toBe('ACTIVE');
    expect(paid.currentPeriodEnd).toEqual(start);
    expect(isOverdue(paid, start)).toBe(true);
  });

  it('a renewal covers one interval from the old coverage end (late payments backfill)', () => {
    expect(nextPeriod(d('2026-10-05T00:00:00Z'), 'MONTHLY')).toEqual({
      periodStart: d('2026-10-05T00:00:00Z'),
      periodEnd: d('2026-11-05T00:00:00Z'),
    });
  });

  it('overdue only for open subscriptions past their coverage', () => {
    const now = d('2026-11-12T00:00:00Z');
    const past = d('2026-11-01T00:00:00Z');
    expect(isOverdue({ status: 'ACTIVE', currentPeriodEnd: past }, now)).toBe(true);
    expect(isOverdue({ status: 'PAST_DUE', currentPeriodEnd: past }, now)).toBe(true);
    expect(isOverdue({ status: 'CANCELLED', currentPeriodEnd: past }, now)).toBe(false);
    expect(isOverdue({ status: 'ACTIVE', currentPeriodEnd: d('2026-12-01T00:00:00Z') }, now)).toBe(
      false,
    );
  });

  it('counts days left in whole days', () => {
    const now = d('2026-11-12T12:00:00Z');
    expect(daysLeft(d('2026-11-13T00:00:00Z'), now)).toBe(1);
    expect(daysLeft(d('2026-11-19T12:00:00Z'), now)).toBe(7);
    expect(daysLeft(d('2026-11-11T12:00:00Z'), now)).toBe(-1);
  });

  it('MRR counts ACTIVE and PAST_DUE only; yearly is ÷12 rounded down (integer paise)', () => {
    expect(
      monthlyRecurringPaise([
        { status: 'ACTIVE', pricePaise: 49_900, interval: 'MONTHLY' },
        { status: 'PAST_DUE', pricePaise: 99_900, interval: 'YEARLY' }, // 8325
        { status: 'TRIALING', pricePaise: 49_900, interval: 'MONTHLY' },
        { status: 'CANCELLED', pricePaise: 49_900, interval: 'MONTHLY' },
      ]),
    ).toBe(49_900 + 8_325);
  });

  it('month bounds follow Asia/Kolkata', () => {
    // 1 Nov 02:00 IST is still November in India even though it is 31 Oct in UTC.
    const now = d('2026-10-31T20:30:00Z');
    const { start, end } = istMonthBounds(now);
    expect(start.toISOString()).toBe('2026-10-31T18:30:00.000Z');
    expect(end.toISOString()).toBe('2026-11-30T18:30:00.000Z');
    expect(istMonthBounds(now, -1).start.toISOString()).toBe('2026-09-30T18:30:00.000Z');
  });
});
