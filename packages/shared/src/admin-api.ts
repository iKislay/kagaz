/**
 * Request/response contracts for the Kagaz admin API (PRD §11.3).
 * Shared by apps/api (validation) and apps/web (typed client).
 *
 * All money amounts are integer paise. Responses never include token hashes,
 * pickup code values, signed URLs, storage object keys, or the full customer
 * phone number (masked to the last 2 digits).
 */
import { z } from 'zod';
import { ApprovalMode, OrderStatus, PaymentStatus, PrintJobStatus, ShopStatus } from './enums.js';
import { OrderStatusSchema, PrintOptionsSchema, QuoteSchema } from './schemas.js';

const enumValues = <T extends Record<string, string>>(obj: T) =>
  Object.values(obj) as [T[keyof T], ...T[keyof T][]];

/** Runtime mirror of the ActorType enum (enums.ts only declares the type). */
const ActorTypeValues = {
  CUSTOMER: 'CUSTOMER',
  STAFF: 'STAFF',
  DEVICE: 'DEVICE',
  ADMIN: 'ADMIN',
  SYSTEM: 'SYSTEM',
} as const;

const PaymentStatusSchema = z.enum(enumValues(PaymentStatus));
const PrintJobStatusSchema = z.enum(enumValues(PrintJobStatus));
const ShopStatusSchema = z.enum(enumValues(ShopStatus));
const ApprovalModeSchema = z.enum(enumValues(ApprovalMode));
const ActorTypeSchema = z.enum(enumValues(ActorTypeValues));

const IST_OFFSET_MS = 5 * 60 * 60 * 1000 + 30 * 60 * 1000; // Asia/Kolkata = UTC+5:30 (no DST)
const DAY_MS = 24 * 60 * 60 * 1000;

/** Start and end (inclusive) of "today" in Asia/Kolkata, as UTC instants. */
export function istDayBounds(now: Date = new Date()): { start: Date; end: Date } {
  const localNow = now.getTime() + IST_OFFSET_MS;
  const localStart = Math.floor(localNow / DAY_MS) * DAY_MS; // Kolkata midnight as epoch-like ms
  return {
    start: new Date(localStart - IST_OFFSET_MS),
    end: new Date(localStart + DAY_MS - 1 - IST_OFFSET_MS),
  };
}

/** Mask every digit except the last two (e.g. "+919876543210" → "+**********10"). */
export function maskPhone(phone: string | null): string | null {
  if (phone == null) return null;
  const digits = phone.match(/\d/g) ?? [];
  if (digits.length <= 2) return phone;
  const bodyLen = digits.length - 2;
  const tail = digits.slice(-2).join('');
  let seen = 0;
  return phone.replace(/\d/g, () => {
    if (seen < bodyLen) {
      seen += 1;
      return '*';
    }
    return tail[seen++ - bodyLen] ?? '';
  });
}

// ─── Shops ───

export const AdminDeviceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  appVersion: z.string().nullable(),
  /** True when lastHeartbeatAt is within DEVICE_ONLINE_THRESHOLD_SECONDS. */
  online: z.boolean(),
  lastHeartbeatAt: z.string().nullable(),
});
export type AdminDevice = z.infer<typeof AdminDeviceSchema>;

export const AdminPrinterSchema = z.object({
  id: z.uuid(),
  printerName: z.string(),
  displayName: z.string(),
  status: z.string(),
  colourCapable: z.boolean(),
  duplexCapable: z.boolean(),
  enabled: z.boolean(),
  /** The printer's currently active print job, if any. */
  activeJob: z
    .object({
      orderId: z.uuid(),
      publicRef: z.string(),
      attempt: z.int(),
      status: PrintJobStatusSchema,
    })
    .nullable(),
});
export type AdminPrinter = z.infer<typeof AdminPrinterSchema>;

export const AdminShopSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  address: z.string(),
  status: ShopStatusSchema,
  approvalMode: ApprovalModeSchema,
  autoPaused: z.boolean(),
  isDemo: z.boolean(),
  /** Current (latest effective) pricing. */
  pricing: z
    .object({
      monoRatePaise: z.int(),
      colourRatePaise: z.int(),
      monoDuplexRatePaise: z.int().nullable(),
      colourDuplexRatePaise: z.int().nullable(),
      duplexRule: z.string(),
      minimumChargePaise: z.int(),
    })
    .nullable(),
  devices: z.array(AdminDeviceSchema),
  printers: z.array(AdminPrinterSchema),
  /** Order counts keyed by status (non-terminal / active statuses only). */
  orderCounts: z.record(z.string(), z.int()),
  todayOrders: z.int(),
  /** Sum of paid order amounts today (IST day). */
  todayRevenuePaise: z.int(),
  /** Of todayRevenuePaise, the portion from simulated/demo payments. */
  todaySimulatedRevenuePaise: z.int(),
});
export type AdminShop = z.infer<typeof AdminShopSchema>;

export const AdminShopsSchema = z.object({ shops: z.array(AdminShopSchema) });
export type AdminShops = z.infer<typeof AdminShopsSchema>;

// ─── Orders ───

export const AdminOrderListItemSchema = z.object({
  id: z.uuid(),
  publicRef: z.string(),
  shopId: z.uuid(),
  shopName: z.string(),
  status: OrderStatusSchema,
  amountPaise: z.int().nullable(),
  paymentStatus: PaymentStatusSchema.nullable(),
  simulatedPayment: z.boolean(),
  createdAt: z.string(),
});
export type AdminOrderListItem = z.infer<typeof AdminOrderListItemSchema>;

export const AdminOrderListSchema = z.object({
  items: z.array(AdminOrderListItemSchema),
  page: z.int(),
  pageSize: z.int(),
  total: z.int(),
});
export type AdminOrderList = z.infer<typeof AdminOrderListSchema>;

// ─── Order detail ───

export const AdminFileSchema = z.object({
  id: z.uuid(),
  kind: z.string(),
  status: z.string(),
  bytes: z.int().nullable(),
  pageCount: z.int().nullable(),
  sha256: z.string().nullable(),
  createdAt: z.string(),
});
export type AdminFile = z.infer<typeof AdminFileSchema>;

export const AdminPaymentSchema = z.object({
  id: z.uuid(),
  provider: z.string(),
  providerOrderId: z.string().nullable(),
  amountPaise: z.int(),
  status: PaymentStatusSchema,
  isSimulated: z.boolean(),
  verifiedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type AdminPayment = z.infer<typeof AdminPaymentSchema>;

export const AdminRefundSchema = z.object({
  id: z.uuid(),
  paymentId: z.uuid(),
  amountPaise: z.int(),
  status: z.enum(['PENDING', 'SUCCEEDED', 'FAILED']),
  isSimulated: z.boolean(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});
export type AdminRefund = z.infer<typeof AdminRefundSchema>;

export const AdminPrintJobSchema = z.object({
  id: z.uuid(),
  attempt: z.int(),
  status: PrintJobStatusSchema,
  printerId: z.uuid(),
  printerName: z.string(),
  spoolerJobId: z.int().nullable(),
  error: z.string().nullable(),
  createdAt: z.string(),
});
export type AdminPrintJob = z.infer<typeof AdminPrintJobSchema>;

export const AdminOrderEventSchema = z.object({
  id: z.uuid(),
  fromStatus: OrderStatusSchema.nullable(),
  toStatus: OrderStatusSchema,
  actorType: ActorTypeSchema,
  actorId: z.string().nullable(),
  reason: z.string().nullable(),
  createdAt: z.string(),
});
export type AdminOrderEvent = z.infer<typeof AdminOrderEventSchema>;

export const AdminAuditEntrySchema = z.object({
  id: z.uuid(),
  actorType: ActorTypeSchema,
  actorId: z.string().nullable(),
  shopId: z.string().nullable(),
  orderId: z.string().nullable(),
  action: z.string(),
  metadata: z.unknown().nullable(),
  ip: z.string().nullable(),
  createdAt: z.string(),
});
export type AdminAuditEntry = z.infer<typeof AdminAuditEntrySchema>;

export const AdminOrderDetailSchema = z.object({
  id: z.uuid(),
  publicRef: z.string(),
  shop: z.object({
    id: z.uuid(),
    name: z.string(),
    slug: z.string(),
    isDemo: z.boolean(),
  }),
  customerPhoneMasked: z.string().nullable(),
  options: PrintOptionsSchema,
  quote: QuoteSchema.nullable(),
  /** Immutable price snapshot taken when payment was created. */
  priceSnapshot: z.unknown().nullable(),
  amountPaise: z.int().nullable(),
  files: z.array(AdminFileSchema),
  payments: z.array(AdminPaymentSchema),
  refunds: z.array(AdminRefundSchema),
  printJobs: z.array(AdminPrintJobSchema),
  events: z.array(AdminOrderEventSchema),
  audit: z.array(AdminAuditEntrySchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AdminOrderDetail = z.infer<typeof AdminOrderDetailSchema>;

// ─── Audit log ───

export const AdminAuditListSchema = z.object({
  items: z.array(AdminAuditEntrySchema),
  page: z.int(),
  pageSize: z.int(),
  total: z.int(),
});
export type AdminAuditList = z.infer<typeof AdminAuditListSchema>;

// ─── Query validation ───

export const AdminOrdersQuerySchema = z.strictObject({
  q: z.string().optional(),
  shopId: z.uuid().optional(),
  status: z.enum(enumValues(OrderStatus)).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type AdminOrdersQuery = z.infer<typeof AdminOrdersQuerySchema>;

export const AdminAuditQuerySchema = z.strictObject({
  shopId: z.uuid().optional(),
  orderId: z.uuid().optional(),
  action: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type AdminAuditQuery = z.infer<typeof AdminAuditQuerySchema>;

// ─── Auth ───

export const AdminLoginRequestSchema = z.strictObject({
  email: z.string().email().min(1),
  password: z.string().min(1),
});
export type AdminLoginRequest = z.infer<typeof AdminLoginRequestSchema>;

export const AdminLoginResponseSchema = z.object({
  admin: z.object({ id: z.uuid(), email: z.string() }),
});
export type AdminLoginResponse = z.infer<typeof AdminLoginResponseSchema>;

// ─── Pricing versions (P2.5) ───

const MAX_RATE_PAISE = 100_000; // ₹1,000 per side: a typo guard, not a business rule

export const AdminPricingVersionSchema = z.object({
  id: z.uuid(),
  monoRatePaise: z.int(),
  colourRatePaise: z.int(),
  monoDuplexRatePaise: z.int().nullable(),
  colourDuplexRatePaise: z.int().nullable(),
  duplexRule: z.enum(['SAME_AS_SIMPLEX', 'DISCOUNTED_SIDE_RATE']),
  minimumChargePaise: z.int(),
  effectiveFrom: z.string(),
  createdAt: z.string(),
  /** The row quotes use right now (latest effective_from ≤ now). */
  current: z.boolean(),
});
export type AdminPricingVersion = z.infer<typeof AdminPricingVersionSchema>;

/** GET /api/admin/shops/:id/pricing — newest effective_from first. */
export const AdminPricingListSchema = z.object({ versions: z.array(AdminPricingVersionSchema) });
export type AdminPricingList = z.infer<typeof AdminPricingListSchema>;

const ratePaise = z.int().min(1).max(MAX_RATE_PAISE);

/** POST /api/admin/shops/:id/pricing — creates a new version; rows are never edited. */
export const CreatePricingVersionSchema = z
  .strictObject({
    monoRatePaise: ratePaise,
    colourRatePaise: ratePaise,
    monoDuplexRatePaise: ratePaise.nullable().optional(),
    colourDuplexRatePaise: ratePaise.nullable().optional(),
    duplexRule: z.enum(['SAME_AS_SIMPLEX', 'DISCOUNTED_SIDE_RATE']).default('SAME_AS_SIMPLEX'),
    minimumChargePaise: z.int().min(0).max(MAX_RATE_PAISE).default(0),
    /** Defaults to now; a future time schedules the change. */
    effectiveFrom: z.iso.datetime().optional(),
  })
  .refine(
    (v) =>
      v.duplexRule === 'SAME_AS_SIMPLEX' ||
      (v.monoDuplexRatePaise != null && v.colourDuplexRatePaise != null),
    { message: 'Duplex rates are required for DISCOUNTED_SIDE_RATE', path: ['duplexRule'] },
  );
export type CreatePricingVersion = z.infer<typeof CreatePricingVersionSchema>;

// ─── Demo controls (P2.2 / P3.5) — non-production only ───

export const DemoOtpInboxItemSchema = z.object({
  /** Masked to the last 4 digits. */
  phone: z.string(),
  code: z.string(),
  sentAt: z.string(),
  expiresAt: z.string(),
});
export type DemoOtpInboxItem = z.infer<typeof DemoOtpInboxItemSchema>;

/** GET /api/admin/demo/otp-inbox */
export const DemoOtpInboxSchema = z.object({ items: z.array(DemoOtpInboxItemSchema) });
export type DemoOtpInbox = z.infer<typeof DemoOtpInboxSchema>;
