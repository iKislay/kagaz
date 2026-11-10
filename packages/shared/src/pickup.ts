/**
 * ADR-002 daily pickup code: a small number per shop per business day (#1, #2 …), restarting
 * at midnight Asia/Kolkata. Always shown with its date so yesterday's #7 isn't today's.
 */

/** Asia/Kolkata is UTC+05:30 all year (no DST). */
const IST_OFFSET_MS = 330 * 60_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The Asia/Kolkata business date of an instant, as `YYYY-MM-DD`. */
export function kolkataBusinessDate(now: Date): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** `2026-11-07` → `7 Nov`. Returns the input unchanged if it isn't a `YYYY-MM-DD` date. */
export function formatPickupDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined;
  return m && month ? `${Number(m[3])} ${month}` : date;
}

/** `#7 · 7 Nov` — the pickup code as the customer and the slip show it. */
export function formatPickupCode(pickupNumber: number, pickupDate: string): string {
  return `#${pickupNumber} · ${formatPickupDate(pickupDate)}`;
}
