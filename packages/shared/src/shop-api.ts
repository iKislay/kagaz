/**
 * Contracts for the shop / device API used by the Windows shop app (PRD §11.2).
 * The shop is always derived from the device token — never sent by the client.
 */
import { z } from 'zod';
import { SubscriptionSummarySchema } from './billing.js';
import { PrintJobStatus, RejectReasonCode } from './enums.js';
import { CreatePricingVersionSchema, MobileSchema } from './admin-api.js';
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

/**
 * POST /api/shop/signup (public, from the Kaggaz Shop app): creates the shop (CLOSED until Kaggaz
 * activates it), the owner login (mobile + password) and enrolls this PC. Returns the same shape
 * as POST /api/devices/enroll.
 */
export const ShopSignupRequestSchema = z.strictObject({
  shopName: z.string().trim().min(2).max(120),
  ownerName: z.string().trim().min(2).max(80),
  phone: MobileSchema,
  password: z.string().min(8, 'At least 8 characters').max(200),
  deviceName: z.string().trim().min(1).max(80),
  appVersion: z.string().max(40).optional(),
});
export type ShopSignupRequest = z.infer<typeof ShopSignupRequestSchema>;

/**
 * POST /api/shop/enroll-with-login (public): the shop owner connects a new PC with their mobile
 * number + password instead of a pairing code. `shopId` picks the shop when they own several.
 */
export const EnrollWithLoginRequestSchema = z.strictObject({
  login: MobileSchema,
  password: z.string().min(1).max(200),
  deviceName: z.string().trim().min(1).max(80),
  appVersion: z.string().max(40).optional(),
  shopId: z.uuid().optional(),
});
export type EnrollWithLoginRequest = z.infer<typeof EnrollWithLoginRequestSchema>;

/** GET/POST/DELETE /api/shop/members (owner signed in on the shop PC). */
export const ShopMemberSchema = z.object({
  userId: z.uuid(),
  name: z.string().nullable(),
  phone: z.string().nullable(),
  role: z.enum(['OWNER', 'OPERATOR']),
});
export type ShopMember = z.infer<typeof ShopMemberSchema>;
export const ShopMemberListSchema = z.object({ members: z.array(ShopMemberSchema) });
export type ShopMemberList = z.infer<typeof ShopMemberListSchema>;

/** POST /api/shop/members: add an operator login, or reset an operator's password. */
export const ShopMemberRequestSchema = z.strictObject({
  phone: MobileSchema,
  name: z.string().trim().min(2).max(80),
  password: z.string().min(8, 'At least 8 characters').max(200),
});
export type ShopMemberRequest = z.infer<typeof ShopMemberRequestSchema>;

/** GET /api/shop/pricing: the shop's pricing in effect now (null before the first version). */
export const ShopPricingSchema = z.object({
  monoRatePaise: z.int(),
  colourRatePaise: z.int(),
  monoDuplexRatePaise: z.int().nullable(),
  colourDuplexRatePaise: z.int().nullable(),
  duplexRule: z.enum(['SAME_AS_SIMPLEX', 'DISCOUNTED_SIDE_RATE']),
  minimumChargePaise: z.int(),
  effectiveFrom: z.string(),
});
export type ShopPricing = z.infer<typeof ShopPricingSchema>;

/** PUT /api/shop/pricing (owner): a new pricing version effective now; same rules as admin. */
export const UpdateShopPricingSchema = CreatePricingVersionSchema;
export type UpdateShopPricing = z.infer<typeof UpdateShopPricingSchema>;

// ─── Shop profile + first-run setup (owner, from the app) ───

/**
 * GET /api/shop/profile. `location` comes from the shop PC's position or a place the owner picked
 * from search (never typed coordinates); `address` is what customers read, which the owner may edit.
 * `setupComplete` is false until the owner finishes first-run setup.
 */
export const ShopProfileSchema = z.object({
  name: z.string(),
  contactPhone: z.string().nullable(),
  address: z.string().nullable(),
  location: z.object({ lat: z.number(), lng: z.number() }).nullable(),
  setupComplete: z.boolean(),
});
export type ShopProfile = z.infer<typeof ShopProfileSchema>;

/** PATCH /api/shop/profile (owner). */
export const UpdateShopProfileSchema = z
  .strictObject({
    name: z.string().trim().min(2).max(120).optional(),
    contactPhone: MobileSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update');
export type UpdateShopProfile = z.infer<typeof UpdateShopProfileSchema>;

/** A place from address search / reverse lookup (OpenStreetMap). */
export const PlaceSchema = z.object({
  /** Short title, e.g. "KSRTC Bus Stand". */
  name: z.string(),
  /** Full one-line address, e.g. "KSRTC Bus Stand, Dr. Rajkumar Road, Mandya, 571401". */
  address: z.string(),
  lat: z.number(),
  lng: z.number(),
});
export type Place = z.infer<typeof PlaceSchema>;

/** GET /api/shop/places?q= (signed in): address suggestions near the shop. */
export const PlaceSearchQuerySchema = z.strictObject({ q: z.string().trim().min(3).max(120) });
export const PlaceSearchResponseSchema = z.object({ places: z.array(PlaceSchema) });
export type PlaceSearchResponse = z.infer<typeof PlaceSearchResponseSchema>;

/** GET /api/shop/places/reverse?lat=&lng= (signed in): a suggested address for a position. */
export const ReversePlaceQuerySchema = z.strictObject({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});
export const ReversePlaceResponseSchema = z.object({ address: z.string().nullable() });
export type ReversePlaceResponse = z.infer<typeof ReversePlaceResponseSchema>;

/** PUT /api/shop/location (owner): the pin and the address customers will read. */
export const ShopLocationRequestSchema = z.strictObject({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  address: z.string().trim().min(5, 'Enter the shop address').max(300),
});
export type ShopLocationRequest = z.infer<typeof ShopLocationRequestSchema>;

export const HeartbeatRequestSchema = z.strictObject({
  appVersion: z.string().max(40).optional(),
  /** Contract §1 / P4.4 health fields (all optional for back-compat). */
  os: z.string().max(120).optional(),
  uptimeSeconds: z.int().nonnegative().optional(),
  /** Jobs in the agent's local queue. */
  queueDepth: z.int().nonnegative().max(10_000).optional(),
  /** Print attempts the agent is printing/monitoring: their leases are renewed. */
  activePrintJobIds: z.array(z.uuid()).max(50).optional(),
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

/** POST /api/shop/heartbeat (and legacy /api/devices/heartbeat) response — contract §1. */
export const HeartbeatResponseSchema = z.object({
  serverTime: z.string(),
  leaseTtlSeconds: z.int(),
  minAgentVersion: z.string().nullable(),
  /** True when appVersion < minAgentVersion: other shop endpoints answer 426. */
  upgradeRequired: z.boolean(),
  shop: z.object({
    status: z.enum(['OPEN', 'CLOSED', 'MAINTENANCE']),
    approvalMode: z.enum(['MANUAL', 'AUTO']),
    autoPaused: z.boolean(),
  }),
  /** ADR-004: the shop's plan, for the app to show (older apps ignore it). */
  subscription: SubscriptionSummarySchema.optional(),
});
export type HeartbeatResponse = z.infer<typeof HeartbeatResponseSchema>;

/** Read model for admin health views (P4.4); online = heartbeat within the threshold. */
export const DeviceHealthSchema = z.object({
  deviceId: z.uuid(),
  shopId: z.uuid(),
  name: z.string(),
  status: z.enum(['ACTIVE', 'REVOKED']),
  connectivity: z.enum(['ONLINE', 'STALE', 'OFFLINE']),
  online: z.boolean(),
  lastHeartbeatAt: z.string().nullable(),
  appVersion: z.string().nullable(),
  upgradeRequired: z.boolean(),
  os: z.string().nullable(),
  uptimeSeconds: z.int().nullable(),
  queueDepth: z.int().nullable(),
  printers: z.array(
    z.object({
      printerId: z.uuid(),
      displayName: z.string(),
      status: z.string(),
      lastError: z.string().nullable(),
      lastStatusAt: z.string().nullable(),
      /** READY/LEASED/SUBMITTED print jobs waiting on or holding this printer. */
      queueDepth: z.int(),
    }),
  ),
});
export type DeviceHealth = z.infer<typeof DeviceHealthSchema>;

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
  /** ADR-003: the customer pays this amount at the counter on pickup. */
  payAtCounter: z.boolean().default(false),
  createdAt: z.string(),
  paidAt: z.string().nullable(),
  /** ADR-002 daily pickup code: #1, #2 … per shop per day. Null until payment is verified. */
  pickupNumber: z.int().nullable(),
  /** Business date (YYYY-MM-DD, Asia/Kolkata) the pickup number belongs to. */
  pickupDate: z.string().nullable(),
  printJob: ShopPrintJobSchema.nullable(),
  rejection: z.object({ code: z.string(), note: z.string().nullable() }).nullable(),
});
export type ShopJob = z.infer<typeof ShopJobSchema>;

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
  /** Outcome unknown (restart, vanished spooler job) → order NEEDS_OPERATOR_CHECK. */
  z.strictObject({ status: z.literal('UNCERTAIN'), reason: z.string().min(1).max(500).optional() }),
]);
export type PrintStatusReport = z.infer<typeof PrintStatusReportSchema>;

// ─── Needs-check resolution (contract §2) ───

export const ResolveAction = {
  CONFIRM_PRINTED: 'CONFIRM_PRINTED',
  REPRINT: 'REPRINT',
  MARK_FAILED: 'MARK_FAILED',
} as const;
export type ResolveAction = (typeof ResolveAction)[keyof typeof ResolveAction];

/** POST /api/shop/jobs/:orderId/resolve. REPRINT requires `confirm: true`. Response: ShopJobDetail. */
export const ResolveJobRequestSchema = z.strictObject({
  action: z.enum(enumValues(ResolveAction)),
  confirm: z.boolean().optional(),
  note: z.string().max(500).optional(),
});
export type ResolveJobRequest = z.infer<typeof ResolveJobRequestSchema>;

export const printDocumentName = (publicRef: string, attempt: number) =>
  `KAGAZ-${publicRef}-A${attempt}`;

// ─── Operator session + device token (contract §4) ───

/** Header carrying the operator session token on human actions. */
export const OPERATOR_TOKEN_HEADER = 'x-operator-token';

export const OperatorRoleSchema = z.enum(['SHOP_OWNER', 'SHOP_OPERATOR']);
export type OperatorRole = z.infer<typeof OperatorRoleSchema>;

export const OperatorLoginRequestSchema = z.strictObject({
  /** Email or phone (E.164) of a staff member of the device's shop. */
  login: z.string().trim().min(3).max(120),
  password: z.string().min(1).max(200),
});
export type OperatorLoginRequest = z.infer<typeof OperatorLoginRequestSchema>;

export const OperatorLoginResponseSchema = z.object({
  operatorToken: z.string(),
  expiresAt: z.string(),
  operator: z.object({ id: z.uuid(), name: z.string(), role: OperatorRoleSchema }),
});
export type OperatorLoginResponse = z.infer<typeof OperatorLoginResponseSchema>;

export const RotateDeviceTokenResponseSchema = z.object({ deviceToken: z.string() });
export type RotateDeviceTokenResponse = z.infer<typeof RotateDeviceTokenResponseSchema>;
// ─── Approval mode (P2.6, contract §3) and open/closed status ───

const ShopOpenStatusSchema = z.enum(['OPEN', 'CLOSED', 'MAINTENANCE']);

export const ShopModeSchema = z.object({
  approvalMode: z.enum(['MANUAL', 'AUTO']),
  /** true = auto mode paused: paid orders wait for manual review. */
  autoPaused: z.boolean(),
  /** Whether the shop takes new orders; set by the shop in its app. */
  status: ShopOpenStatusSchema,
});
export type ShopMode = z.infer<typeof ShopModeSchema>;

/** PATCH /api/shop/mode — send any of the fields. */
export const UpdateShopModeRequestSchema = z.strictObject({
  approvalMode: z.enum(['MANUAL', 'AUTO']).optional(),
  autoPaused: z.boolean().optional(),
  status: ShopOpenStatusSchema.optional(),
});
export type UpdateShopModeRequest = z.infer<typeof UpdateShopModeRequestSchema>;
