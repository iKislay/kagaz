/**
 * Subscription math (ADR-004). Pure and unit tested. Money is integer paise; dates are calendar
 * days in Asia/Kolkata stored as the UTC instant of IST midnight. Period/price helpers live in
 * @kagaz/shared so the /superadmin preview and the server agree to the paisa.
 */
export { addMonths, istDay, istMidnight, monthsAndDays, periodTotal } from '@kagaz/shared';

const DAY_MS = 86_400_000;

export interface Period {
  status: 'ACTIVE' | 'CANCELLED';
  printerSeats: number;
  periodStart: Date;
  periodEnd: Date;
}

export const overlaps = (a: Pick<Period, 'periodStart' | 'periodEnd'>, b: typeof a) =>
  a.periodStart < b.periodEnd && b.periodStart < a.periodEnd;

/** The non-cancelled period containing `at`, if any. */
export function currentPeriod<T extends Period>(periods: readonly T[], at: Date): T | null {
  return (
    periods.find((p) => p.status === 'ACTIVE' && p.periodStart <= at && at < p.periodEnd) ?? null
  );
}

export interface Summary {
  status: 'ACTIVE' | 'EXPIRED' | 'NONE';
  printerSeats: number;
  periodEnd: string | null;
  daysLeft: number | null;
}

/** What the shop is entitled to now. EXPIRED = it had a plan that has ended. */
export function summarize(periods: readonly Period[], at: Date): Summary {
  const current = currentPeriod(periods, at);
  if (current) {
    return {
      status: 'ACTIVE',
      printerSeats: current.printerSeats,
      periodEnd: current.periodEnd.toISOString(),
      daysLeft: Math.ceil((current.periodEnd.getTime() - at.getTime()) / DAY_MS),
    };
  }
  const past = periods
    .filter((p) => p.status === 'ACTIVE' && p.periodEnd <= at)
    .sort((a, b) => b.periodEnd.getTime() - a.periodEnd.getTime())[0];
  return past
    ? { status: 'EXPIRED', printerSeats: 0, periodEnd: past.periodEnd.toISOString(), daysLeft: 0 }
    : { status: 'NONE', printerSeats: 0, periodEnd: null, daysLeft: null };
}

/** total − payments (payments may include negative corrections). */
export const balance = (totalPaise: number, payments: readonly { amountPaise: number }[]) =>
  totalPaise - payments.reduce((sum, p) => sum + p.amountPaise, 0);

/** The shop's balance: Σ over non-cancelled subscriptions, so credit on one offsets another. */
export const shopBalance = (
  subs: readonly {
    status: string;
    totalPaise: number;
    payments: readonly { amountPaise: number }[];
  }[],
) =>
  subs
    .filter((s) => s.status === 'ACTIVE')
    .reduce((sum, s) => sum + balance(s.totalPaise, s.payments), 0);
