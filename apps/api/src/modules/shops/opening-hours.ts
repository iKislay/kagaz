import { z } from 'zod';

/**
 * Shop opening hours, evaluated in Asia/Kolkata (UTC+05:30, no DST) — P3.6.
 *
 * Format (Shop.opening_hours): `{ mon: [["09:00","20:00"]], …, sun: [] }`.
 * - `{}` (nothing configured) → always open
 * - a day that is missing or `[]` → closed that day (once any day is configured)
 * - "24:00" may end a window; a window whose end ≤ start runs past midnight
 * - malformed config → closed (fail safe: never auto-print or sell on a broken schedule)
 */
const IST_OFFSET_MS = 330 * 60_000;
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;
type Day = (typeof DAYS)[number];

const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/);
const Window = z.tuple([Time, Time]);
export const OpeningHoursSchema = z.partialRecord(z.enum(DAYS), z.array(Window));
export type OpeningHours = z.infer<typeof OpeningHoursSchema>;

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Local Asia/Kolkata weekday + minute-of-day for an instant. */
export function kolkataClock(now: Date): { day: Day; minute: number } {
  const local = new Date(now.getTime() + IST_OFFSET_MS);
  return {
    day: DAYS[local.getUTCDay()]!,
    minute: local.getUTCHours() * 60 + local.getUTCMinutes(),
  };
}

export function isWithinOpeningHours(raw: unknown, now: Date = new Date()): boolean {
  if (raw === null || raw === undefined) return true;
  const parsed = OpeningHoursSchema.safeParse(raw);
  if (!parsed.success) return false;
  const hours = parsed.data;
  if (Object.keys(hours).length === 0) return true;

  const { day, minute } = kolkataClock(now);
  const prevDay = DAYS[(DAYS.indexOf(day) + 6) % 7]!;
  const open = (hours[day] ?? []).some(([start, end]) => {
    const s = minutes(start);
    const e = minutes(end);
    return e > s ? minute >= s && minute < e : minute >= s; // overnight: today's part
  });
  if (open) return true;
  // Overnight window that started yesterday.
  return (hours[prevDay] ?? []).some(([start, end]) => {
    const s = minutes(start);
    const e = minutes(end);
    return e <= s && minute < e;
  });
}
