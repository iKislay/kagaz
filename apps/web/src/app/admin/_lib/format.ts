import { type Tone } from '@/lib/status';

const IST = 'Asia/Kolkata';

/** "7 Nov, 14:05" in Asia/Kolkata. */
export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  const otherYear = date.getUTCFullYear() !== new Date().getUTCFullYear();
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: IST,
    day: 'numeric',
    month: 'short',
    ...(otherYear ? { year: 'numeric' as const } : {}),
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

/** "7 Nov" for a YYYY-MM-DD key. */
export function fmtDay(key: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${key}T00:00:00Z`));
}

/** "3 min ago", "2 h ago". */
export function fmtAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} d ago`;
}

/** Seconds → "12 min", "1 h 05 min". */
export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—';
  if (seconds < 60) return `${seconds} s`;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

/** Today's date (Asia/Kolkata) as YYYY-MM-DD. */
export function istToday(): string {
  return new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

/** Rupees with paise from integer paise (display only; never parsed back). */
export function rupees(paise: number | null | undefined): string {
  if (paise === null || paise === undefined) return '—';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(paise / 100);
}

/** Order status → tone for admin pills. */
export function orderTone(status: string): Tone {
  switch (status) {
    case 'READY_FOR_PICKUP':
    case 'COLLECTED':
      return 'green';
    case 'NEEDS_OPERATOR_CHECK':
    case 'AWAITING_PAYMENT':
    case 'REFUND_PENDING':
      return 'orange';
    case 'REJECTED':
      return 'red';
    case 'PENDING_REVIEW':
    case 'QUEUED':
    case 'PRINTING':
      return 'accent';
    default:
      return 'neutral';
  }
}

export function healthTone(health: string): Tone {
  return health === 'ONLINE'
    ? 'green'
    : health === 'STALE'
      ? 'orange'
      : health === 'REVOKED'
        ? 'neutral'
        : 'red';
}

export function printerTone(status: string): Tone {
  return status === 'READY'
    ? 'green'
    : status === 'UNKNOWN'
      ? 'neutral'
      : status === 'PAPER_OUT'
        ? 'orange'
        : 'red';
}

export function shopStatusTone(status: string): Tone {
  return status === 'OPEN' ? 'green' : status === 'MAINTENANCE' ? 'orange' : 'neutral';
}

/** "PENDING_REVIEW" → "Pending review". */
export function humanize(code: string): string {
  const s = code.toLowerCase().replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
