/**
 * Direct-to-shop UPI payments (ADR-003): shop payment setup, customer payment reports
 * ("I paid but it isn't confirmed") and manual refunds. Shared by api, web and (as JSON) the
 * Windows shop app. The shop is always derived from the device token — never sent by the client.
 */
import { z } from 'zod';

// ─── Validation primitives ───

/** UPI ID / VPA, e.g. `xeroxshop@okicici`, `9876543210@ybl`. */
export const UpiIdSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9._-]{1,255}@[a-z][a-z0-9.-]{1,63}$/, 'Enter a UPI ID like name@bank');

/** 12-digit UPI transaction reference (UTR / "UPI Ref No."), as shown in every UPI app. */
export const UtrSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/\s+/g, ''))
  .pipe(z.string().regex(/^\d{12}$/, 'Enter the 12-digit UPI reference number'));

/** Name customers see on the UPI screen, e.g. "Sri Ganesh Xerox". */
export const PayeeNameSchema = z.string().trim().min(2).max(60);

/** Show only the last 4 digits of a UTR outside the owning shop. */
export const maskUtr = (utr: string) => `••••••••${utr.slice(-4)}`;

// ─── Shop payment setup (Settings → Payments in the shop app) ───

export const PaymentProviderNameSchema = z.enum(['youpi', 'demo', 'razorpay', 'cashfree']);
export type PaymentProviderName = z.infer<typeof PaymentProviderNameSchema>;

/** Overall readiness shown as one status line + dot in the shop app and admin. */
export const ShopPaymentReadiness = {
  /** Nothing to set up (demo payments). */
  NOT_REQUIRED: 'NOT_REQUIRED',
  /** Step 1 missing: no UPI ID saved yet. Customers cannot pay this shop. */
  NEEDS_UPI_ID: 'NEEDS_UPI_ID',
  /** Step 2 missing: no phone paired, payments can only be confirmed by hand. */
  NEEDS_PHONE: 'NEEDS_PHONE',
  /** A phone is paired but has not been seen recently (off, no internet, battery saver). */
  PHONE_OFFLINE: 'PHONE_OFFLINE',
  READY: 'READY',
} as const;
export type ShopPaymentReadiness = (typeof ShopPaymentReadiness)[keyof typeof ShopPaymentReadiness];

export const ObserverPhoneSchema = z.object({
  id: z.string(),
  name: z.string(),
  online: z.boolean(),
  lastSeenAt: z.string().nullable(),
  lastPaymentSeenAt: z.string().nullable(),
});
export type ObserverPhone = z.infer<typeof ObserverPhoneSchema>;

/** GET /api/shop/payments/setup */
export const ShopPaymentSetupSchema = z.object({
  provider: PaymentProviderNameSchema,
  readiness: z.enum(
    Object.values(ShopPaymentReadiness) as [ShopPaymentReadiness, ...ShopPaymentReadiness[]],
  ),
  upiId: z.string().nullable(),
  payeeName: z.string().nullable(),
  phones: z.array(ObserverPhoneSchema),
  /** Link the phone opens to install the detector app (encode as a QR). Null when not needed. */
  appDownloadUrl: z.string().nullable(),
  updatedAt: z.string().nullable(),
});
export type ShopPaymentSetup = z.infer<typeof ShopPaymentSetupSchema>;

/** PUT /api/shop/payments/setup (operator) — step 1. Idempotent. */
export const UpdateShopPaymentSetupRequestSchema = z.strictObject({
  upiId: UpiIdSchema,
  payeeName: PayeeNameSchema,
});
export type UpdateShopPaymentSetupRequest = z.infer<typeof UpdateShopPaymentSetupRequestSchema>;

/** POST /api/shop/payments/pairing (operator) — step 2: text to show as a QR for the phone app. */
export const ShopPhonePairingSchema = z.object({
  /** Opaque text; render it as a QR code. Contains a short-lived enrollment secret. */
  qrText: z.string(),
  expiresAt: z.string(),
});
export type ShopPhonePairing = z.infer<typeof ShopPhonePairingSchema>;

// ─── Customer payment reports (fallback) ───

export const PaymentReportStatus = {
  OPEN: 'OPEN',
  APPROVED: 'APPROVED',
  DECLINED: 'DECLINED',
  /** Closed by the system: the automatic check confirmed the payment first. */
  SUPERSEDED: 'SUPERSEDED',
} as const;
export type PaymentReportStatus = (typeof PaymentReportStatus)[keyof typeof PaymentReportStatus];
export const PaymentReportStatusSchema = z.enum(
  Object.values(PaymentReportStatus) as [PaymentReportStatus, ...PaymentReportStatus[]],
);

export const DeclineReason = {
  NOT_RECEIVED: 'NOT_RECEIVED',
  WRONG_AMOUNT: 'WRONG_AMOUNT',
  WRONG_REFERENCE: 'WRONG_REFERENCE',
  OTHER: 'OTHER',
} as const;
export type DeclineReason = (typeof DeclineReason)[keyof typeof DeclineReason];
export const DeclineReasonSchema = z.enum(
  Object.values(DeclineReason) as [DeclineReason, ...DeclineReason[]],
);

/** Customer-facing text for a declined report. */
export const DECLINE_REASON_TEXT: Record<DeclineReason, string> = {
  NOT_RECEIVED: 'The shop could not find this payment in their account.',
  WRONG_AMOUNT: 'The amount received was different from the order total.',
  WRONG_REFERENCE: 'The UPI reference number did not match a payment.',
  OTHER: 'The shop could not confirm this payment.',
};

/** POST /api/orders/:id/payment-report (customer, tracking token). */
export const ReportPaymentRequestSchema = z.strictObject({ utr: UtrSchema });
export type ReportPaymentRequest = z.infer<typeof ReportPaymentRequestSchema>;

/** Part of the customer order view. */
export const PublicPaymentReportSchema = z.object({
  status: PaymentReportStatusSchema,
  /** Masked (last 4 digits). */
  utr: z.string(),
  createdAt: z.string(),
  declineReason: DeclineReasonSchema.nullable(),
});
export type PublicPaymentReport = z.infer<typeof PublicPaymentReportSchema>;

/** One report as the shop sees it (GET /api/shop/payment-reports). */
export const ShopPaymentReportSchema = z.object({
  id: z.uuid(),
  orderId: z.uuid(),
  publicRef: z.string(),
  amountPaise: z.int(),
  /** Full UTR: the shop needs it to find the credit in their UPI app. */
  utr: z.string(),
  status: PaymentReportStatusSchema,
  createdAt: z.string(),
  decidedAt: z.string().nullable(),
  declineReason: DeclineReasonSchema.nullable(),
  /** Last 4 digits of the customer's phone, when known (never the full number). */
  customerPhoneLast4: z.string().nullable(),
});
export type ShopPaymentReport = z.infer<typeof ShopPaymentReportSchema>;

export const ShopPaymentReportListSchema = z.object({ reports: z.array(ShopPaymentReportSchema) });
export type ShopPaymentReportList = z.infer<typeof ShopPaymentReportListSchema>;

export const DeclinePaymentReportRequestSchema = z.strictObject({
  reason: DeclineReasonSchema,
  note: z.string().trim().max(200).optional(),
});
export type DeclinePaymentReportRequest = z.infer<typeof DeclinePaymentReportRequestSchema>;

// ─── Manual refunds (provider cannot move money) ───

/** A refund the shop must send from their own UPI app (GET /api/shop/refunds). */
export const ShopManualRefundSchema = z.object({
  refundId: z.uuid(),
  orderId: z.uuid(),
  publicRef: z.string(),
  amountPaise: z.int(),
  /** Where to send the money: the customer's UPI reference of the original payment. */
  paymentReference: z.string().nullable(),
  customerPhoneLast4: z.string().nullable(),
  reason: z.string().nullable(),
  createdAt: z.string(),
});
export type ShopManualRefund = z.infer<typeof ShopManualRefundSchema>;
export const ShopManualRefundListSchema = z.object({ refunds: z.array(ShopManualRefundSchema) });
export type ShopManualRefundList = z.infer<typeof ShopManualRefundListSchema>;

/** POST /api/shop/refunds/:id/confirm (operator): "I sent the money back". */
export const ConfirmManualRefundRequestSchema = z.strictObject({
  /** UTR of the refund transfer, if the shopkeeper has it. */
  utr: UtrSchema.optional(),
});
export type ConfirmManualRefundRequest = z.infer<typeof ConfirmManualRefundRequestSchema>;

/** Customer-facing text for manual refunds. */
export const MANUAL_REFUND_NOTICE = 'The shop will send this money back to your UPI account.';
