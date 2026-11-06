/**
 * Request/response contracts for the customer-facing API (PRD §11.1).
 * Shared by apps/api (validation) and apps/web (typed client).
 */
import { z } from 'zod';
import { PaymentStatus, ShopStatus } from './enums.js';
import { OrderStatusSchema, PrintOptionsSchema, QuoteSchema } from './schemas.js';

const enumValues = <T extends Record<string, string>>(obj: T) =>
  Object.values(obj) as [T[keyof T], ...T[keyof T][]];

/** Indian mobile in E.164, e.g. +919876543210. */
export const PhoneSchema = z
  .string()
  .regex(/^\+91[6-9]\d{9}$/, 'Enter a valid Indian mobile number');

// ─── Shops ───

export const ShopSummarySchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  address: z.string(),
  status: z.enum(enumValues(ShopStatus)),
  /** True when new orders can be placed right now. */
  acceptingOrders: z.boolean(),
  isDemo: z.boolean(),
  capabilities: z.object({ colour: z.boolean(), duplex: z.boolean() }),
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
});
export type ShopSummary = z.infer<typeof ShopSummarySchema>;
export const ShopListSchema = z.object({ shops: z.array(ShopSummarySchema) });

// ─── Orders ───

export const CreateOrderRequestSchema = z.strictObject({
  shopId: z.uuid(),
  options: PrintOptionsSchema,
  customerPhone: PhoneSchema.optional(),
});
export type CreateOrderRequest = z.infer<typeof CreateOrderRequestSchema>;

export const UpdateOptionsRequestSchema = z.strictObject({ options: PrintOptionsSchema });
export type UpdateOptionsRequest = z.infer<typeof UpdateOptionsRequestSchema>;

export const UploadUrlRequestSchema = z.strictObject({
  /** Exact byte size of the file the browser will PUT; it is signed into the URL. */
  bytes: z.int().positive(),
});
export type UploadUrlRequest = z.infer<typeof UploadUrlRequestSchema>;

export const UploadUrlResponseSchema = z.object({
  fileId: z.uuid(),
  uploadUrl: z.url(),
  method: z.literal('PUT'),
  headers: z.record(z.string(), z.string()),
  expiresAt: z.string(),
});
export type UploadUrlResponse = z.infer<typeof UploadUrlResponseSchema>;

export const UploadCompleteRequestSchema = z.strictObject({ fileId: z.uuid() });
export type UploadCompleteRequest = z.infer<typeof UploadCompleteRequestSchema>;

export const OrderEventViewSchema = z.object({
  status: OrderStatusSchema,
  at: z.string(),
});

/** Customer-safe order view (GET /api/orders/:id). Never includes staff/shop internals. */
export const PublicOrderSchema = z.object({
  id: z.uuid(),
  publicRef: z.string(),
  status: OrderStatusSchema,
  shop: z.object({ id: z.uuid(), name: z.string(), address: z.string(), isDemo: z.boolean() }),
  options: PrintOptionsSchema,
  file: z.object({ pageCount: z.int(), bytes: z.int() }).nullable(),
  quote: QuoteSchema.nullable(),
  amountPaise: z.int().nullable(),
  payment: z
    .object({
      status: z.enum(enumValues(PaymentStatus)),
      isSimulated: z.boolean(),
      reference: z.string().nullable(),
    })
    .nullable(),
  /** Only present while READY_FOR_PICKUP (PRD FR-CUST-11). */
  pickupCode: z.string().nullable(),
  rejection: z.object({ code: z.string(), note: z.string().nullable() }).nullable(),
  timeline: z.array(OrderEventViewSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PublicOrder = z.infer<typeof PublicOrderSchema>;

export const CreateOrderResponseSchema = z.object({
  order: PublicOrderSchema,
  /** Bearer secret for this order; returned once. Also set as an httpOnly cookie. */
  trackingToken: z.string(),
});
export type CreateOrderResponse = z.infer<typeof CreateOrderResponseSchema>;

export const PayResponseSchema = z.object({
  order: PublicOrderSchema,
  /** DEMO: payment already verified server-side. LIVE (later): checkout data for the provider. */
  mode: z.enum(['DEMO_AUTO_APPROVED', 'PROVIDER_CHECKOUT']),
});
export type PayResponse = z.infer<typeof PayResponseSchema>;

/** Header carrying the order tracking token when a cookie isn't available. */
export const TRACKING_TOKEN_HEADER = 'x-tracking-token';
export const trackingCookieName = (orderId: string) => `kgz_t_${orderId}`;
