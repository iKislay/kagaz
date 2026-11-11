import {
  type BillingInterval,
  type ShopLifecycle,
  type SubscriptionPaymentMethod,
  type SudoAttentionKind,
  type SudoSubscription,
} from '@kagaz/shared';
import { type Tone } from '@/lib/status';
import { rupees } from '../../admin/_lib/format';

/**
 * "499" / "499.5" / "1,499.50" → integer paise without floating point (CLAUDE.md invariant 1).
 * Returns null when the text isn't a plain rupee amount with at most 2 decimals.
 */
export function parseRupees(input: string): number | null {
  const s = input.replace(/[₹,\s]/g, '');
  const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

/** Integer paise → editable rupee text ("499" or "499.50"). */
export function paiseToInput(paise: number): string {
  const r = Math.floor(paise / 100);
  const p = paise % 100;
  return p === 0 ? String(r) : `${r}.${String(p).padStart(2, '0')}`;
}

export function price(paise: number, interval: BillingInterval): string {
  return `${rupees(paise)} / ${interval === 'MONTHLY' ? 'month' : 'year'}`;
}

/** "7 Nov 2026" in Asia/Kolkata. */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso));
}

/** ISO → value for <input type="date"> (IST calendar day). */
export function toDateInput(iso: string): string {
  return new Date(Date.parse(iso) + 5.5 * 3600_000).toISOString().slice(0, 10);
}
/** <input type="date"> value → ISO at IST midnight. */
export function fromDateInput(value: string): string {
  return new Date(`${value}T00:00:00+05:30`).toISOString();
}

export function lifecycleTone(l: ShopLifecycle): Tone {
  return l === 'LIVE' ? 'green' : l === 'SUSPENDED' ? 'orange' : 'neutral';
}
export const LIFECYCLE_LABEL: Record<ShopLifecycle, string> = {
  LIVE: 'Live',
  SUSPENDED: 'Suspended',
  ARCHIVED: 'Archived',
};

/** Status pill for a subscription, taking "overdue" into account. */
export function subscriptionBadge(sub: SudoSubscription | null): { label: string; tone: Tone } {
  if (!sub) return { label: 'No plan', tone: 'neutral' };
  if (sub.status === 'CANCELLED') return { label: 'Cancelled', tone: 'neutral' };
  if (sub.overdue) {
    return { label: sub.status === 'TRIALING' ? 'Trial ended' : 'Payment due', tone: 'red' };
  }
  if (sub.status === 'PAST_DUE') return { label: 'Past due', tone: 'orange' };
  if (sub.status === 'TRIALING') return { label: 'Trial', tone: 'accent' };
  if (sub.cancelAtPeriodEnd) return { label: 'Ends at period end', tone: 'orange' };
  return { label: 'Active', tone: 'green' };
}

export function coverageText(sub: SudoSubscription): string {
  if (sub.status === 'CANCELLED') return `Cancelled ${fmtDate(sub.cancelledAt)}`;
  const d = sub.daysLeft;
  const when = fmtDate(sub.currentPeriodEnd);
  if (sub.status === 'TRIALING') {
    return d > 0 ? `Trial until ${when} · ${d} d left` : `Trial ended ${when}`;
  }
  if (d > 0) return `Paid through ${when} · ${d} d left`;
  if (d === 0) return `Payment due today`;
  return `Paid through ${when} · ${-d} d overdue`;
}

export const METHOD_LABEL: Record<SubscriptionPaymentMethod, string> = {
  CASH: 'Cash',
  UPI: 'UPI',
  BANK_TRANSFER: 'Bank transfer',
  OTHER: 'Other',
};

export const ATTENTION: Record<SudoAttentionKind, { label: string; tone: Tone }> = {
  OVERDUE: { label: 'Payment due', tone: 'red' },
  PAST_DUE: { label: 'Past due', tone: 'orange' },
  TRIAL_ENDING: { label: 'Trial ending', tone: 'accent' },
  RENEWAL_DUE: { label: 'Renewal soon', tone: 'accent' },
  NO_SUBSCRIPTION: { label: 'No plan', tone: 'orange' },
  SUSPENDED: { label: 'Suspended', tone: 'orange' },
  NOT_PAIRED: { label: 'Not paired', tone: 'neutral' },
};

/** A slug suggestion from a shop name: "Sri Ganesh Xerox" → "sri-ganesh-xerox". */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}
