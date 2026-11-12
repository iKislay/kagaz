/**
 * Request/response contracts for the Kagaz admin API (PRD §11.3).
 * Shared by apps/api (validation) and apps/web (typed client).
 *
 * All money amounts are integer paise. Responses never include token hashes,
 * pickup code values, signed URLs, storage object keys, or the full customer
 * phone number (masked to the last 2 digits).
 */
import { z } from 'zod';
import {
  ApprovalMode,
  DemoPaymentOutcome,
  OrderStatus,
  PaymentStatus,
  PrintJobStatus,
  RejectReasonCode,
  ShopStatus,
} from './enums.js';
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

/** Calendar day in Asia/Kolkata for an instant, as YYYY-MM-DD. */
export function istDateKey(at: Date): string {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** UTC instant of Kolkata midnight starting the given YYYY-MM-DD day. */
export function istDayStart(dateKey: string): Date {
  return new Date(Date.parse(`${dateKey}T00:00:00.000Z`) - IST_OFFSET_MS);
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
  /** ADR-002 daily pickup code: #1, #2 … per shop per day. Null until payment is verified. */
  pickupNumber: z.int().nullable(),
  /** Business date (YYYY-MM-DD, Asia/Kolkata) the pickup number belongs to. */
  pickupDate: z.string().nullable(),
  createdAt: z.string(),
});

export const AdminOrderListSchema = z.object({
  items: z.array(AdminOrderListItemSchema),
  page: z.int(),
  pageSize: z.int(),
  total: z.int(),
});

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

export const AdminRefundSchema = z.object({
  id: z.uuid(),
  paymentId: z.uuid(),
  amountPaise: z.int(),
  status: z.enum(['PENDING', 'SUCCEEDED', 'FAILED']),
  isSimulated: z.boolean(),
  createdAt: z.string(),
  completedAt: z.string().nullable(),
});

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

export const AdminOrderEventSchema = z.object({
  id: z.uuid(),
  fromStatus: OrderStatusSchema.nullable(),
  toStatus: OrderStatusSchema,
  actorType: ActorTypeSchema,
  actorId: z.string().nullable(),
  /** Display name of the operator/admin/device that made the transition. */
  actorName: z.string().nullable().optional(),
  reason: z.string().nullable(),
  createdAt: z.string(),
});

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
  /** Display name of a STAFF/ADMIN actor (or a device's name), resolved server-side. */
  actorName: z.string().nullable().optional(),
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
  /** ADR-002 daily pickup code: #1, #2 … per shop per day. Null until payment is verified. */
  pickupNumber: z.int().nullable(),
  /** Business date (YYYY-MM-DD, Asia/Kolkata) the pickup number belongs to. */
  pickupDate: z.string().nullable(),
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
  actorType: ActorTypeSchema.optional(),
  actorId: z.string().max(64).optional(),
  /** Inclusive IST calendar days (YYYY-MM-DD). */
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type AdminAuditQuery = z.infer<typeof AdminAuditQuerySchema>;

// ─── Auth ───

/** Staff roles that can hold a web session (PRD §4.1). */
export const StaffRoleSchema = z.enum(['ADMIN', 'SHOP_OWNER', 'SHOP_OPERATOR']);
export type StaffRole = z.infer<typeof StaffRoleSchema>;

/**
 * Staff sign-in (P2.3): `login` is an email or E.164 phone. `email` is accepted for
 * backwards compatibility with the Phase 1 admin login.
 */
export const AdminLoginRequestSchema = z
  .strictObject({
    login: z.string().trim().min(3).max(120).optional(),
    email: z.string().trim().min(3).max(120).optional(),
    password: z.string().min(1).max(200),
  })
  .refine((v) => !!(v.login ?? v.email), { message: 'login is required', path: ['login'] });
export type AdminLoginRequest = z.infer<typeof AdminLoginRequestSchema>;

export const AdminLoginResponseSchema = z.object({
  admin: z.object({ id: z.uuid(), email: z.string().nullable(), role: StaffRoleSchema }),
});
export type AdminLoginResponse = z.infer<typeof AdminLoginResponseSchema>;

export const AdminMeSchema = z.object({
  id: z.uuid(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  name: z.string().nullable(),
  role: StaffRoleSchema,
  /** Shops this staff member belongs to (empty for platform admins). */
  shops: z.array(
    z.object({ id: z.uuid(), name: z.string(), role: z.enum(['SHOP_OWNER', 'SHOP_OPERATOR']) }),
  ),
});
export type AdminMe = z.infer<typeof AdminMeSchema>;

// ─── Shop management (P4.3, FR-ADMIN-03…06) ───

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, 'Use HH:MM (24 h)');
export const OPENING_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type OpeningDay = (typeof OPENING_DAYS)[number];

/** Opening hours in Asia/Kolkata: per weekday, up to 4 [open, close] intervals. */
const DayIntervals = z
  .array(z.tuple([HHMM, HHMM]).refine(([a, b]) => a < b, 'Opening time must be before closing'))
  .max(4);
export const OpeningHoursSchema = z.strictObject({
  mon: DayIntervals.optional(),
  tue: DayIntervals.optional(),
  wed: DayIntervals.optional(),
  thu: DayIntervals.optional(),
  fri: DayIntervals.optional(),
  sat: DayIntervals.optional(),
  sun: DayIntervals.optional(),
});
export type OpeningHours = z.infer<typeof OpeningHoursSchema>;

export const AutoLimitsSchema = z.strictObject({
  maxPages: z.int().min(1).max(1000),
  maxCopies: z.int().min(1).max(100),
  maxSides: z.int().min(1).max(10000),
  maxQueueDepth: z.int().min(1).max(500),
});
export type AutoLimits = z.infer<typeof AutoLimitsSchema>;

export const AdminShopDetailSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  address: z.string(),
  contactPhone: z.string().nullable(),
  status: ShopStatusSchema,
  approvalMode: ApprovalModeSchema,
  autoPaused: z.boolean(),
  autoLimits: AutoLimitsSchema.partial(),
  openingHours: OpeningHoursSchema,
  isDemo: z.boolean(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  members: z.array(
    z.object({
      userId: z.uuid(),
      name: z.string().nullable(),
      email: z.string().nullable(),
      phone: z.string().nullable(),
      role: z.enum(['SHOP_OWNER', 'SHOP_OPERATOR']),
    }),
  ),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AdminShopDetail = z.infer<typeof AdminShopDetailSchema>;

/** PATCH /api/admin/shops/:id — owners may only change the OWNER_EDITABLE fields. */
export const AdminShopUpdateRequestSchema = z.strictObject({
  name: z.string().trim().min(2).max(120).optional(),
  address: z.string().trim().min(2).max(300).optional(),
  contactPhone: z
    .string()
    .regex(/^\+[1-9]\d{7,14}$/, 'Use E.164, e.g. +919876543210')
    .nullable()
    .optional(),
  status: ShopStatusSchema.optional(),
  approvalMode: ApprovalModeSchema.optional(),
  autoPaused: z.boolean().optional(),
  autoLimits: AutoLimitsSchema.optional(),
  openingHours: OpeningHoursSchema.optional(),
  isDemo: z.boolean().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
});
export type AdminShopUpdateRequest = z.infer<typeof AdminShopUpdateRequestSchema>;
export const OWNER_EDITABLE_SHOP_FIELDS = [
  'contactPhone',
  'approvalMode',
  'autoPaused',
  'openingHours',
] as const;

export const AdminShopCreateRequestSchema = z.strictObject({
  slug: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/, 'lowercase letters, digits and dashes'),
  name: z.string().trim().min(2).max(120),
  address: z.string().trim().min(2).max(300),
  contactPhone: z
    .string()
    .regex(/^\+[1-9]\d{7,14}$/)
    .optional(),
  isDemo: z.boolean().optional(),
});
export type AdminShopCreateRequest = z.infer<typeof AdminShopCreateRequestSchema>;

// ─── Devices + enrollment codes (P2.4, FR-ADMIN-04) ───

/** ONLINE: heartbeat ≤ DEVICE_ONLINE_THRESHOLD_SECONDS; STALE: ≤ 5 min; else OFFLINE. */
export const AdminDeviceHealthSchema = z.enum(['ONLINE', 'STALE', 'OFFLINE', 'REVOKED']);
export type AdminDeviceHealth = z.infer<typeof AdminDeviceHealthSchema>;

export const AdminDeviceDetailSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  status: z.enum(['ACTIVE', 'REVOKED']),
  health: AdminDeviceHealthSchema,
  appVersion: z.string().nullable(),
  lastHeartbeatAt: z.string().nullable(),
  createdAt: z.string(),
  revokedAt: z.string().nullable(),
  /** Operator currently signed in on this device, if any. */
  activeOperator: z.object({ id: z.uuid(), name: z.string() }).nullable(),
});
export type AdminDeviceDetail = z.infer<typeof AdminDeviceDetailSchema>;

export const AdminDeviceListSchema = z.object({ devices: z.array(AdminDeviceDetailSchema) });

export const AdminDeviceUpdateRequestSchema = z.strictObject({
  /** Only revocation is supported; a revoked device must be re-paired with a new code. */
  status: z.literal('REVOKED').optional(),
  name: z.string().trim().min(1).max(80).optional(),
});
export type AdminDeviceUpdateRequest = z.infer<typeof AdminDeviceUpdateRequestSchema>;

export const AdminEnrollmentCodeSchema = z.object({
  id: z.uuid(),
  state: z.enum(['ACTIVE', 'USED', 'EXPIRED']),
  createdAt: z.string(),
  expiresAt: z.string(),
  usedAt: z.string().nullable(),
  usedByDeviceId: z.string().nullable(),
});
export type AdminEnrollmentCode = z.infer<typeof AdminEnrollmentCodeSchema>;

export const AdminEnrollmentCodeListSchema = z.object({
  codes: z.array(AdminEnrollmentCodeSchema),
});

/** The plaintext code is returned exactly once, here; only its hash is stored. */
export const AdminEnrollmentCodeCreatedSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  expiresAt: z.string(),
});
export type AdminEnrollmentCodeCreated = z.infer<typeof AdminEnrollmentCodeCreatedSchema>;

// ─── Printers (FR-ADMIN-05) ───

export const AdminPrinterDetailSchema = z.object({
  id: z.uuid(),
  deviceId: z.string().nullable(),
  printerName: z.string(),
  displayName: z.string(),
  colourCapable: z.boolean(),
  duplexCapable: z.boolean(),
  capabilitiesConfirmed: z.boolean(),
  enabled: z.boolean(),
  isDefault: z.boolean(),
  status: z.string(),
  lastStatusAt: z.string().nullable(),
  lastError: z.string().nullable(),
  /** Print jobs waiting or in flight on this printer (READY, LEASED, SUBMITTED). */
  queueDepth: z.int(),
});
export type AdminPrinterDetail = z.infer<typeof AdminPrinterDetailSchema>;

export const AdminPrinterListSchema = z.object({ printers: z.array(AdminPrinterDetailSchema) });

export const AdminPrinterUpdateRequestSchema = z.strictObject({
  enabled: z.boolean().optional(),
  /** Only `true` is meaningful: it clears the default flag on the shop's other printers. */
  isDefault: z.literal(true).optional(),
  displayName: z.string().trim().min(1).max(80).optional(),
});
export type AdminPrinterUpdateRequest = z.infer<typeof AdminPrinterUpdateRequestSchema>;

// ─── Pricing versions (FR-ADMIN-06) ───
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
  /** The version quotes use right now. */
  current: z.boolean(),
});
export type AdminPricingVersion = z.infer<typeof AdminPricingVersionSchema>;

export const AdminPricingListSchema = z.object({ versions: z.array(AdminPricingVersionSchema) });
export type AdminPricingList = z.infer<typeof AdminPricingListSchema>;

const Paise = z.int().min(0).max(1_000_000);
export const AdminCreatePricingRequestSchema = z
  .strictObject({
    monoRatePaise: Paise,
    colourRatePaise: Paise,
    monoDuplexRatePaise: Paise.nullable().optional(),
    colourDuplexRatePaise: Paise.nullable().optional(),
    duplexRule: z.enum(['SAME_AS_SIMPLEX', 'DISCOUNTED_SIDE_RATE']),
    minimumChargePaise: Paise,
    /** ISO-8601; defaults to now. Past values are refused (existing orders keep snapshots). */
    effectiveFrom: z.iso.datetime({ offset: true }).optional(),
  })
  .refine(
    (v) =>
      v.duplexRule !== 'DISCOUNTED_SIDE_RATE' ||
      (v.monoDuplexRatePaise != null && v.colourDuplexRatePaise != null),
    {
      message: 'Discounted duplex needs both duplex side rates',
      path: ['monoDuplexRatePaise'],
    },
  );
export type AdminCreatePricingRequest = z.infer<typeof AdminCreatePricingRequestSchema>;

// ─── Health (P4.4) ───

export const AdminHealthSchema = z.object({
  generatedAt: z.string(),
  onlineThresholdSeconds: z.int(),
  staleThresholdSeconds: z.int(),
  minAgentVersion: z.string().nullable(),
  shops: z.array(
    z.object({
      shopId: z.uuid(),
      shopName: z.string(),
      status: ShopStatusSchema,
      approvalMode: ApprovalModeSchema,
      autoPaused: z.boolean(),
      /** At least one active device is ONLINE. */
      online: z.boolean(),
      devices: z.array(
        z.object({
          id: z.uuid(),
          name: z.string(),
          health: AdminDeviceHealthSchema,
          appVersion: z.string().nullable(),
          /** appVersion is missing or below MIN_AGENT_VERSION. */
          versionDrift: z.boolean(),
          os: z.string().nullable(),
          uptimeSeconds: z.int().nullable(),
          /** Jobs in the agent's local queue, as last reported. */
          queueDepth: z.int().nullable(),
          lastHeartbeatAt: z.string().nullable(),
          secondsSinceHeartbeat: z.int().nullable(),
        }),
      ),
      printers: z.array(
        z.object({
          id: z.uuid(),
          displayName: z.string(),
          printerName: z.string(),
          status: z.string(),
          enabled: z.boolean(),
          isDefault: z.boolean(),
          lastStatusAt: z.string().nullable(),
          lastError: z.string().nullable(),
          queueDepth: z.int(),
        }),
      ),
    }),
  ),
});
export type AdminHealth = z.infer<typeof AdminHealthSchema>;

// ─── Reconciliation (P3.7, FR-ADMIN-10) ───

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const AdminReconciliationQuerySchema = z.strictObject({
  /** Inclusive IST calendar days; default: the last 7 days. */
  from: IsoDate.optional(),
  to: IsoDate.optional(),
  shopId: z.uuid().optional(),
  /** "Paid without progress" threshold in hours. */
  stuckHours: z.coerce.number().int().min(1).max(168).default(2),
});
export type AdminReconciliationQuery = z.infer<typeof AdminReconciliationQuerySchema>;

export const MismatchTypeSchema = z.enum([
  'PAID_NO_PROGRESS',
  'REJECTED_WITHOUT_REFUND',
  'REFUND_WITHOUT_REJECTION',
  'REFUND_STATUS_MISMATCH',
  'WEBHOOK_UNPROCESSED',
]);
export type MismatchType = z.infer<typeof MismatchTypeSchema>;

export const AdminReconciliationSchema = z.object({
  from: z.string(),
  to: z.string(),
  stuckHours: z.int(),
  rows: z.array(
    z.object({
      date: z.string(),
      shopId: z.uuid(),
      shopName: z.string(),
      paidCount: z.int(),
      paidPaise: z.int(),
      simulatedPaidPaise: z.int(),
      refundCount: z.int(),
      refundedPaise: z.int(),
      /** Orders created that day, by current status. */
      ordersByStatus: z.record(z.string(), z.int()),
    }),
  ),
  totals: z.object({
    paidPaise: z.int(),
    refundedPaise: z.int(),
    netPaise: z.int(),
    mismatches: z.int(),
  }),
  mismatches: z.array(
    z.object({
      type: MismatchTypeSchema,
      orderId: z.string().nullable(),
      publicRef: z.string().nullable(),
      shopId: z.string().nullable(),
      shopName: z.string().nullable(),
      detail: z.string(),
      at: z.string(),
    }),
  ),
});
export type AdminReconciliation = z.infer<typeof AdminReconciliationSchema>;

// ─── Overview dashboard (P4.8, FR-ADMIN-11) ───

export const AdminOverviewQuerySchema = z.strictObject({
  days: z.coerce.number().int().min(1).max(90).default(14),
  shopId: z.uuid().optional(),
});
export type AdminOverviewQuery = z.infer<typeof AdminOverviewQuerySchema>;

const Turnaround = z.object({
  paidToReadyMedianSeconds: z.int().nullable(),
  readyToCollectedMedianSeconds: z.int().nullable(),
  paidToReadySamples: z.int(),
  readyToCollectedSamples: z.int(),
});

export const AdminOverviewSchema = z.object({
  from: z.string(),
  to: z.string(),
  totals: z.object({
    orders: z.int(),
    paidOrders: z.int(),
    collected: z.int(),
    rejected: z.int(),
    paidPaise: z.int(),
  }),
  byDay: z.array(
    z.object({ date: z.string(), total: z.int(), byStatus: z.record(z.string(), z.int()) }),
  ),
  byShop: z.array(
    z.object({
      shopId: z.uuid(),
      shopName: z.string(),
      total: z.int(),
      byStatus: z.record(z.string(), z.int()),
      turnaround: Turnaround,
    }),
  ),
  byStatus: z.record(z.string(), z.int()),
  turnaround: Turnaround,
  printerUptime: z.array(
    z.object({
      printerId: z.uuid(),
      shopId: z.uuid(),
      shopName: z.string(),
      displayName: z.string(),
      /** up samples / observed samples over the window; null when never sampled. */
      uptimeRatio: z.number().nullable(),
      observedSamples: z.int(),
    }),
  ),
});
export type AdminOverview = z.infer<typeof AdminOverviewSchema>;

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

/** GET /api/admin/demo/otp-inbox */
export const DemoOtpInboxSchema = z.object({ items: z.array(DemoOtpInboxItemSchema) });
export type DemoOtpInbox = z.infer<typeof DemoOtpInboxSchema>;

const DemoPaymentOutcomeSchema = z.enum(enumValues(DemoPaymentOutcome));

export const DemoPaymentOrderSchema = z.object({
  id: z.uuid(),
  publicRef: z.string(),
  shopName: z.string(),
  status: OrderStatusSchema,
  amountPaise: z.int().nullable(),
  paymentStatus: PaymentStatusSchema.nullable(),
  /** Outcome the simulated gateway will use for this order's next payment (null = SUCCESS). */
  nextOutcome: DemoPaymentOutcomeSchema.nullable(),
  createdAt: z.string(),
});

/** GET /api/admin/demo/payments — recent orders with their simulated payment outcome. */
export const DemoPaymentsSchema = z.object({
  outcomes: z.array(DemoPaymentOutcomeSchema),
  orders: z.array(DemoPaymentOrderSchema),
});
export type DemoPayments = z.infer<typeof DemoPaymentsSchema>;

/** PUT /api/admin/demo/payments/:orderId/outcome — null clears (back to SUCCESS). */
export const SetDemoOutcomeRequestSchema = z.strictObject({
  outcome: DemoPaymentOutcomeSchema.nullable(),
});
export type SetDemoOutcomeRequest = z.infer<typeof SetDemoOutcomeRequestSchema>;

// ─── Business rules (P3.4 / P3.6) ───

/** POST /api/admin/orders/:id/reject — admin reject after payment (→ refund). */
export const AdminRejectOrderRequestSchema = z.strictObject({
  reasonCode: z.enum(enumValues(RejectReasonCode)),
  note: z.string().max(500).optional(),
});
export type AdminRejectOrderRequest = z.infer<typeof AdminRejectOrderRequestSchema>;

/** Result of an admin reject / refund retry. */
export const AdminOrderActionResultSchema = z.object({
  orderId: z.uuid(),
  status: OrderStatusSchema,
  refund: z
    .object({
      id: z.uuid(),
      status: z.enum(['PENDING', 'SUCCEEDED', 'FAILED']),
      amountPaise: z.int(),
      isSimulated: z.boolean(),
    })
    .nullable(),
});
export type AdminOrderActionResult = z.infer<typeof AdminOrderActionResultSchema>;

/** Paid orders waiting while their shop can't take work (T19). */
export const HeldOrderSchema = z.object({
  orderId: z.uuid(),
  publicRef: z.string(),
  shopId: z.uuid(),
  shopName: z.string(),
  shopStatus: ShopStatusSchema,
  /** SHOP_NOT_OPEN | SHOP_MAINTENANCE | OUTSIDE_OPENING_HOURS */
  reason: z.string(),
  amountPaise: z.int().nullable(),
  paidAt: z.string().nullable(),
});
export type HeldOrder = z.infer<typeof HeldOrderSchema>;

/**
 * PATCH /api/admin/shops/:id/settlement — merchant-of-record readiness (P3.8, D6). Stored only;
 * nothing uses these values until a live gateway is approved.
 */
export const UpdateShopSettlementRequestSchema = z.strictObject({
  gatewayAccountId: z.string().trim().min(1).max(100).nullable().optional(),
  settlementConfig: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type UpdateShopSettlementRequest = z.infer<typeof UpdateShopSettlementRequestSchema>;

export const ShopSettlementSchema = z.object({
  shopId: z.uuid(),
  gatewayAccountId: z.string().nullable(),
  settlementConfig: z.record(z.string(), z.unknown()).nullable(),
  /** Always false until ADR-001 (D6) is decided. */
  active: z.literal(false),
});
export type ShopSettlement = z.infer<typeof ShopSettlementSchema>;

/** GET /api/admin/held-orders */
export const HeldOrdersSchema = z.object({ items: z.array(HeldOrderSchema) });
export type HeldOrders = z.infer<typeof HeldOrdersSchema>;
