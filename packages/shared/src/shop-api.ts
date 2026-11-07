/**
 * Contracts for the shop / device API used by the Windows shop app (PRD §11.2).
 * The shop is always derived from the device token — never sent by the client.
 */
import { z } from 'zod';
import { PrintJobStatus, RejectReasonCode } from './enums.js';
import { OrderStatusSchema, PrintOptionsSchema } from './schemas.js';

const enumValues = <T extends Record<string, string>>(obj: T) =>
  Object.values(obj) as [T[keyof T], ...T[keyof T][]];

export const PrintJobStatusSchema = z.enum(enumValues(PrintJobStatus));

// ─── Devices ───

export const EnrollDeviceRequestSchema = z.strictObject({
  /** One-time code from the admin dashboard / seed, e.g. "ABCD-EFGH". */
  code: z.string().min(8).max(16),
  name: z.string().min(1).max(80),
  appVersion: z.string().max(40).optional(),
});
export type EnrollDeviceRequest = z.infer<typeof EnrollDeviceRequestSchema>;

export const EnrollDeviceResponseSchema = z.object({
  /** Bearer token for all shop API calls. Shown once; store with DPAPI. */
  deviceToken: z.string(),
  device: z.object({ id: z.uuid(), name: z.string() }),
  shop: z.object({ id: z.uuid(), name: z.string(), isDemo: z.boolean() }),
});
export type EnrollDeviceResponse = z.infer<typeof EnrollDeviceResponseSchema>;

export const HeartbeatRequestSchema = z.strictObject({
  appVersion: z.string().max(40).optional(),
  printers: z
    .array(
      z.strictObject({
        printerId: z.uuid(),
        status: z.enum(['READY', 'OFFLINE', 'PAPER_OUT', 'ERROR', 'UNKNOWN']),
        lastError: z.string().max(500).optional(),
      }),
    )
    .max(20)
    .optional(),
});
export type HeartbeatRequest = z.infer<typeof HeartbeatRequestSchema>;

// ─── Printers ───

export const RegisterPrintersRequestSchema = z.strictObject({
  printers: z
    .array(
      z.strictObject({
        /** Exact Windows printer name. */
        printerName: z.string().min(1).max(200),
        displayName: z.string().min(1).max(80).optional(),
        colourCapable: z.boolean(),
        duplexCapable: z.boolean(),
        /** Operator confirmed colour/duplex/A4 behave as declared (required for auto mode). */
        capabilitiesConfirmed: z.boolean(),
        isDefault: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(20),
});
export type RegisterPrintersRequest = z.infer<typeof RegisterPrintersRequestSchema>;

export const ShopPrinterSchema = z.object({
  id: z.uuid(),
  printerName: z.string(),
  displayName: z.string(),
  colourCapable: z.boolean(),
  duplexCapable: z.boolean(),
  capabilitiesConfirmed: z.boolean(),
  enabled: z.boolean(),
  isDefault: z.boolean(),
  status: z.string(),
});
export type ShopPrinter = z.infer<typeof ShopPrinterSchema>;

// ─── Jobs ───

export const ShopPrintJobSchema = z.object({
  id: z.uuid(),
  attempt: z.int(),
  status: PrintJobStatusSchema,
  printerId: z.uuid(),
  spoolerJobId: z.int().nullable(),
  error: z.string().nullable(),
});

/** What an operator sees for an order — no customer phone number. */
export const ShopJobSchema = z.object({
  orderId: z.uuid(),
  publicRef: z.string(),
  status: OrderStatusSchema,
  options: PrintOptionsSchema,
  pageCount: z.int().nullable(),
  printedSides: z.int().nullable(),
  amountPaise: z.int().nullable(),
  simulatedPayment: z.boolean(),
  createdAt: z.string(),
  paidAt: z.string().nullable(),
  printJob: ShopPrintJobSchema.nullable(),
  rejection: z.object({ code: z.string(), note: z.string().nullable() }).nullable(),
});
export type ShopJob = z.infer<typeof ShopJobSchema>;

export const ShopJobListSchema = z.object({ jobs: z.array(ShopJobSchema) });

export const ShopJobDetailSchema = ShopJobSchema.extend({
  /** Short-lived signed URL of the customer's original PDF (for preview). */
  previewUrl: z.string().nullable(),
});
export type ShopJobDetail = z.infer<typeof ShopJobDetailSchema>;

export const AcceptJobRequestSchema = z.strictObject({ printerId: z.uuid().optional() });
export type AcceptJobRequest = z.infer<typeof AcceptJobRequestSchema>;

export const RejectJobRequestSchema = z.strictObject({
  reasonCode: z.enum(enumValues(RejectReasonCode)),
  note: z.string().max(500).optional(),
});
export type RejectJobRequest = z.infer<typeof RejectJobRequestSchema>;

/** Mark Ready requires an explicit operator confirmation (FR-SHOP-12). */
export const MarkReadyRequestSchema = z.strictObject({ confirmed: z.literal(true) });
export type MarkReadyRequest = z.infer<typeof MarkReadyRequestSchema>;

/** POST /api/shop/print-jobs/:id/lease — everything the agent needs to print one attempt. */
export const LeaseResponseSchema = z.object({
  printJobId: z.uuid(),
  orderId: z.uuid(),
  publicRef: z.string(),
  attempt: z.int(),
  /** Use as the Windows print document name: KAGAZ-<publicRef>-A<attempt>. */
  documentName: z.string(),
  printerName: z.string(),
  settings: z.object({ colour: z.boolean(), duplex: z.boolean(), paperSize: z.literal('A4') }),
  downloadUrl: z.string(),
  downloadExpiresAt: z.string(),
  /** SHA-256 of the packet; refuse to print on mismatch. */
  sha256: z.string(),
  pageCount: z.int(),
  leaseUntil: z.string(),
});
export type LeaseResponse = z.infer<typeof LeaseResponseSchema>;

export const PrintStatusReportSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('SUBMITTED'),
    spoolerJobId: z.int().nonnegative().optional(),
  }),
  z.strictObject({ status: z.literal('SPOOLER_COMPLETE') }),
  z.strictObject({ status: z.literal('FAILED'), error: z.string().min(1).max(500) }),
]);
export type PrintStatusReport = z.infer<typeof PrintStatusReportSchema>;

// ─── Pickup ───

export const VerifyPickupRequestSchema = z.strictObject({ code: z.string().min(1).max(20) });
export type VerifyPickupRequest = z.infer<typeof VerifyPickupRequestSchema>;

export const VerifyPickupResponseSchema = z.object({
  orderId: z.uuid(),
  publicRef: z.string(),
  status: OrderStatusSchema,
  options: PrintOptionsSchema,
  pageCount: z.int().nullable(),
  collectedAt: z.string(),
});
export type VerifyPickupResponse = z.infer<typeof VerifyPickupResponseSchema>;

export const printDocumentName = (publicRef: string, attempt: number) =>
  `KAGAZ-${publicRef}-A${attempt}`;

// ─── Approval mode (P2.6, contract §3) ───

export const ShopModeSchema = z.object({
  approvalMode: z.enum(['MANUAL', 'AUTO']),
  /** true = auto mode paused: paid orders wait for manual review. */
  autoPaused: z.boolean(),
});
export type ShopMode = z.infer<typeof ShopModeSchema>;

/** PATCH /api/shop/mode — send one or both fields. */
export const UpdateShopModeRequestSchema = z.strictObject({
  approvalMode: z.enum(['MANUAL', 'AUTO']).optional(),
  autoPaused: z.boolean().optional(),
});
export type UpdateShopModeRequest = z.infer<typeof UpdateShopModeRequestSchema>;
