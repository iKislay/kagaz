import { z } from 'zod';
import { AppEnv, OrderStatus, PaymentMode } from './enums.js';
import { PAPER_SIZES } from './constants.js';

const enumValues = <T extends Record<string, string>>(obj: T) =>
  Object.values(obj) as [T[keyof T], ...T[keyof T][]];

export const OrderStatusSchema = z.enum(enumValues(OrderStatus));
export const AppEnvSchema = z.enum(enumValues(AppEnv));
export const PaymentModeSchema = z.enum(enumValues(PaymentMode));

/** Customer-selected print options (PRD FR-CUST-06). Limits are enforced again server-side. */
export const PrintOptionsSchema = z.strictObject({
  pageRange: z.string().max(200).optional(),
  copies: z.int().min(1).max(1000),
  colour: z.boolean(),
  duplex: z.boolean(),
  paperSize: z.enum(PAPER_SIZES).default('A4'),
});
export type PrintOptions = z.infer<typeof PrintOptionsSchema>;

/** Server-calculated quote; all money in integer paise (PRD §8.2). */
export const QuoteSchema = z.object({
  selectedPages: z.int().nonnegative(),
  copies: z.int().positive(),
  printedSides: z.int().nonnegative(),
  sheets: z.int().nonnegative(),
  ratePaise: z.int().nonnegative(),
  subtotalPaise: z.int().nonnegative(),
  minimumChargeApplied: z.boolean(),
  totalPaise: z.int().nonnegative(),
  pricingId: z.string(),
});
export type Quote = z.infer<typeof QuoteSchema>;

export const LimitsSchema = z.object({
  maxUploadBytes: z.int().positive(),
  maxPages: z.int().positive(),
  maxCopies: z.int().positive(),
  maxSides: z.int().positive(),
});
export type Limits = z.infer<typeof LimitsSchema>;

/** GET /api/config — public runtime configuration. */
export const PublicConfigSchema = z.object({
  appEnv: AppEnvSchema,
  paymentMode: PaymentModeSchema,
  /** DEMO: sign-in codes go to the demo OTP inbox instead of SMS (P2.2). OFF: no customer sign-in. */
  otpMode: z.enum(['DEMO', 'LIVE', 'OFF']),
  /** True when admin demo controls (OTP inbox, payment outcomes) are available (P3.2/P3.5). */
  demoControls: z.boolean(),
  limits: LimitsSchema,
  /** Kaggaz support contact (SUPPORT_* env); each null when not configured — never invented. */
  support: z
    .object({
      phone: z.string().nullable(),
      whatsapp: z.string().nullable(),
      email: z.string().nullable(),
    })
    .default({ phone: null, whatsapp: null, email: null }),
});
export type PublicConfig = z.infer<typeof PublicConfigSchema>;

export const HealthStatusSchema = z.enum(['ok', 'error']);
/** GET /api/health */
export const HealthSchema = z.object({
  status: HealthStatusSchema,
  db: HealthStatusSchema,
  storage: HealthStatusSchema,
  version: z.string(),
  time: z.string(),
});
export type Health = z.infer<typeof HealthSchema>;

/** Error envelope returned by every API error: { error: { code, message, details? } }. */
export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;
