/**
 * Pure subscription math for /sudoadmin. Integer paise only.
 *
 * Coverage model: `currentPeriodEnd` is the date the shop is covered ("paid through") until.
 * - New subscription with a trial: TRIALING, covered until the trial ends.
 * - New subscription without a trial: ACTIVE, covered until the start (payment due now).
 * - Recording a payment (extendPeriod) covers the next interval starting at the old coverage end,
 *   so a late payment pays for the time already used, not from today.
 */
import { type BillingInterval, type SubscriptionStatus } from '@kagaz/shared';

const DAY_MS = 86_400_000;

/** Adds one calendar month/year in UTC, clamping to the month's last day (31 Jan → 28/29 Feb). */
export function addInterval(from: Date, interval: BillingInterval, count = 1): Date {
  const months = interval === 'MONTHLY' ? count : 12 * count;
  const y = from.getUTCFullYear();
  const m = from.getUTCMonth() + months;
  const targetYear = y + Math.floor(m / 12);
  const targetMonth = ((m % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const out = new Date(from);
  out.setUTCFullYear(targetYear, targetMonth, Math.min(from.getUTCDate(), lastDay));
  return out;
}

export function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * DAY_MS);
}

export interface NewSubscriptionTerms {
  status: SubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  trialEndsAt: Date | null;
}

export function newSubscriptionTerms(start: Date, trialDays: number): NewSubscriptionTerms {
  if (trialDays > 0) {
    const end = addDays(start, trialDays);
    return {
      status: 'TRIALING',
      currentPeriodStart: start,
      currentPeriodEnd: end,
      trialEndsAt: end,
    };
  }
  return {
    status: 'ACTIVE',
    currentPeriodStart: start,
    currentPeriodEnd: start,
    trialEndsAt: null,
  };
}

/** The period a renewal payment covers: one interval from the current coverage end. */
export function nextPeriod(
  currentPeriodEnd: Date,
  interval: BillingInterval,
): { periodStart: Date; periodEnd: Date } {
  return { periodStart: currentPeriodEnd, periodEnd: addInterval(currentPeriodEnd, interval) };
}

export function isOpen(status: SubscriptionStatus): boolean {
  return status === 'TRIALING' || status === 'ACTIVE' || status === 'PAST_DUE';
}

/** Open but no longer covered (trial ended / payment due). */
export function isOverdue(
  sub: { status: SubscriptionStatus; currentPeriodEnd: Date },
  now: Date,
): boolean {
  return isOpen(sub.status) && sub.currentPeriodEnd.getTime() <= now.getTime();
}

/** Whole days from now until `end`: positive ahead, 0 today, negative once past. */
export function daysLeft(end: Date, now: Date): number {
  const diff = (end.getTime() - now.getTime()) / DAY_MS;
  return diff >= 0 ? Math.ceil(diff) : Math.floor(diff);
}

/** Monthly-equivalent revenue in paise; only ACTIVE / PAST_DUE subscriptions count. */
export function monthlyRecurringPaise(
  subs: { status: SubscriptionStatus; pricePaise: number; interval: BillingInterval }[],
): number {
  let total = 0;
  for (const s of subs) {
    if (s.status !== 'ACTIVE' && s.status !== 'PAST_DUE') continue;
    total += s.interval === 'MONTHLY' ? s.pricePaise : Math.floor(s.pricePaise / 12);
  }
  return total;
}

/** [start, end) of the calendar month containing `now`, offset by `offset` months, in IST. */
export function istMonthBounds(now: Date, offset = 0): { start: Date; end: Date } {
  const IST_MS = 5.5 * 3600_000;
  const ist = new Date(now.getTime() + IST_MS);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth() + offset;
  const start = new Date(Date.UTC(y, m, 1) - IST_MS);
  const end = new Date(Date.UTC(y, m + 1, 1) - IST_MS);
  return { start, end };
}

/** Readable temporary password, e.g. "kf7Q-m2Xp-9hTa" (14 chars, ~70 bits). */
export const TEMP_PASSWORD_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
