import { z } from 'zod';

/** Subscriptions (ADR-004): per connected-printer seats, manual payment ledger now, Razorpay later. */

// ── Period + price math (shared so the /superadmin preview matches the server exactly) ──
const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

/** "2026-11-12" (IST calendar day) → the UTC instant of that day's IST midnight. */
export function istMidnight(date: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d) - IST_OFFSET_MS);
}

/** IST calendar day ("YYYY-MM-DD") of an instant. */
export function istDay(at: Date): string {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Same day-of-month `months` later (clamped: 31 Jan + 1 month = 28/29 Feb), at IST midnight. */
export function addMonths(startDate: string, months: number): Date {
  const [y, m, d] = startDate.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d, lastDay)) - IST_OFFSET_MS,
  );
}

/** Whole calendar months from `start` that fit before `end`, and the leftover days. */
export function monthsAndDays(start: Date, end: Date): { months: number; days: number } {
  const day = istDay(start);
  let months = 0;
  while (addMonths(day, months + 1) <= end) months++;
  return { months, days: Math.round((end.getTime() - addMonths(day, months).getTime()) / DAY_MS) };
}

/**
 * Price of [start, end) for `seats` printers at `pricePerPrinterPaise` a month: whole months at
 * the monthly price, leftover days at 1/30 of it, rounded to the paisa. Integer paise only.
 */
export function periodTotal(seats: number, pricePerPrinterPaise: number, start: Date, end: Date) {
  const { months, days } = monthsAndDays(start, end);
  const monthly = seats * pricePerPrinterPaise;
  const total = monthly * months + Math.round((monthly * days) / 30);
  if (!Number.isSafeInteger(total) || total < 0) throw new RangeError('Invalid subscription total');
  return total;
}

/** Methods an admin can record by hand (RAZORPAY rows are written by the gateway integration). */
export const MANUAL_PAYMENT_METHODS = ['CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE', 'OTHER'] as const;
export const SubscriptionPaymentMethodSchema = z.enum([...MANUAL_PAYMENT_METHODS, 'RAZORPAY']);

/** What a shop is entitled to right now. */
export const SubscriptionSummarySchema = z.object({
  status: z.enum(['ACTIVE', 'EXPIRED', 'NONE']),
  printerSeats: z.int(),
  periodEnd: z.string().nullable(),
  daysLeft: z.int().nullable(),
});
export type SubscriptionSummary = z.infer<typeof SubscriptionSummarySchema>;

/** POST /api/admin/shops/:id/subscriptions — a new plan or a renewal (starts on an IST day). */
export const CreateSubscriptionRequestSchema = z.strictObject({
  printerSeats: z.int().min(1).max(100),
  pricePerPrinterPaise: z.int().min(0).max(10_000_000),
  startDate: z.iso.date(),
  months: z.int().min(1).max(36),
  notes: z.string().trim().max(500).optional(),
});
export type CreateSubscriptionRequest = z.infer<typeof CreateSubscriptionRequestSchema>;

/** POST …/subscriptions/:subId/payments — append to the ledger; negative = refund/correction. */
export const RecordSubscriptionPaymentRequestSchema = z.strictObject({
  amountPaise: z
    .int()
    .min(-100_000_000)
    .max(100_000_000)
    .refine((v) => v !== 0, 'Amount can’t be zero'),
  method: z.enum(MANUAL_PAYMENT_METHODS),
  reference: z.string().trim().max(120).optional(),
  receivedDate: z.iso.date(),
  note: z.string().trim().max(500).optional(),
});
export type RecordSubscriptionPaymentRequest = z.infer<
  typeof RecordSubscriptionPaymentRequestSchema
>;

const Reason = z.string().trim().min(3, 'Give a reason').max(500);

export const CancelSubscriptionRequestSchema = z.strictObject({ reason: Reason });
export type CancelSubscriptionRequest = z.infer<typeof CancelSubscriptionRequestSchema>;

/**
 * POST …/subscriptions/:subId/change-plan — new seats and/or price from `effectiveDate`: the
 * current period ends that day and a successor covers the rest of it.
 */
export const ChangePlanRequestSchema = z.strictObject({
  printerSeats: z.int().min(1).max(100),
  pricePerPrinterPaise: z.int().min(0).max(10_000_000),
  effectiveDate: z.iso.date(),
  reason: Reason,
});
export type ChangePlanRequest = z.infer<typeof ChangePlanRequestSchema>;

/** POST …/subscriptions/:subId/end-date — extend or shorten a period; the total is recomputed. */
export const ChangeEndDateRequestSchema = z.strictObject({
  endDate: z.iso.date(),
  reason: Reason,
});
export type ChangeEndDateRequest = z.infer<typeof ChangeEndDateRequestSchema>;

/** A subscription's terms at one point in time (revision history). */
export const SubscriptionSnapshotSchema = z.object({
  printerSeats: z.int(),
  pricePerPrinterPaise: z.int(),
  periodStart: z.string(),
  periodEnd: z.string(),
  totalPaise: z.int(),
  status: z.enum(['ACTIVE', 'CANCELLED']),
  /** Change plan: the subscription that took over from the effective date. */
  successorId: z.uuid().optional(),
});
export type SubscriptionSnapshot = z.infer<typeof SubscriptionSnapshotSchema>;

export const AdminSubscriptionPaymentSchema = z.object({
  id: z.uuid(),
  amountPaise: z.int(),
  method: SubscriptionPaymentMethodSchema,
  reference: z.string().nullable(),
  receivedAt: z.string(),
  note: z.string().nullable(),
  recordedBy: z.string().nullable(),
  createdAt: z.string(),
});

export const AdminSubscriptionSchema = z.object({
  id: z.uuid(),
  printerSeats: z.int(),
  pricePerPrinterPaise: z.int(),
  months: z.int(),
  totalPaise: z.int(),
  paidPaise: z.int(),
  balancePaise: z.int(),
  periodStart: z.string(),
  periodEnd: z.string(),
  status: z.enum(['ACTIVE', 'CANCELLED']),
  /** ACTIVE subscriptions by time: current, upcoming (renewal) or ended. */
  phase: z.enum(['CURRENT', 'UPCOMING', 'ENDED', 'CANCELLED']),
  source: z.enum(['MANUAL', 'RAZORPAY']),
  notes: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
  cancelledAt: z.string().nullable(),
  cancelReason: z.string().nullable(),
  payments: z.array(AdminSubscriptionPaymentSchema),
  /** Revisions (change plan / end date / cancel), newest first. */
  changes: z.array(
    z.object({
      id: z.uuid(),
      kind: z.enum(['CHANGE_PLAN', 'EXTEND', 'CANCEL']),
      reason: z.string(),
      before: SubscriptionSnapshotSchema,
      after: SubscriptionSnapshotSchema,
      changedBy: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
});
export type AdminSubscription = z.infer<typeof AdminSubscriptionSchema>;

/** GET /api/admin/shops/:id/billing */
export const AdminShopBillingSchema = z.object({
  summary: SubscriptionSummarySchema,
  connectedPrinters: z.int(),
  enforced: z.boolean(),
  /** Σ (total − paid) over non-cancelled subscriptions; negative = the shop is in credit. */
  balancePaise: z.int(),
  subscriptions: z.array(AdminSubscriptionSchema),
});
export type AdminShopBilling = z.infer<typeof AdminShopBillingSchema>;

/** GET /api/admin/billing — every shop's plan at a glance. */
export const AdminBillingOverviewSchema = z.object({
  enforced: z.boolean(),
  collectedThisMonthPaise: z.int(),
  shops: z.array(
    z.object({
      shopId: z.uuid(),
      shopName: z.string(),
      status: z.enum(['ACTIVE', 'EXPIRING', 'EXPIRED', 'NONE']),
      printerSeats: z.int(),
      connectedPrinters: z.int(),
      periodEnd: z.string().nullable(),
      daysLeft: z.int().nullable(),
      balanceDuePaise: z.int(),
    }),
  ),
});
export type AdminBillingOverview = z.infer<typeof AdminBillingOverviewSchema>;
