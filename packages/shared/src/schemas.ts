import { z } from 'zod';
import { AppEnv, OrderStatus, PaymentMode } from './enums.js';
import { PAPER_SIZES } from './constants.js';

const enumValues = <T extends Record<string, string>>(obj: T) =>
  Object.values(obj) as [T[keyof T], ...T[keyof T][]];

export const OrderStatusSchema = z.enum(enumValues(OrderStatus));
export const AppEnvSchema = z.enum(enumValues(AppEnv));
export const PaymentModeSchema = z.enum(enumValues(PaymentMode));

/** Customer-selected print options (PRD FR-CUST-06). Limits are enforced again server-side. */
export const PrintOptionsSchema = z
  .strictObject({
    pageRange: z.string().max(200).optional(),
    copies: z.int().min(1).max(1000),
    colour: z.boolean(),
    /** Colour orders only: the selected pages to print in colour, the rest print B/W. Absent = all colour. */
    colourPages: z.string().max(200).optional(),
    duplex: z.boolean(),
    paperSize: z.enum(PAPER_SIZES).default('A4'),
  })
  .refine((o) => o.colour || !o.colourPages, {
    message: 'colourPages needs colour: true',
    path: ['colourPages'],
  });
export type PrintOptions = z.infer<typeof PrintOptionsSchema>;

/** The colour mode in words: "B/W", "Colour", or "Colour p. 2, 5-6, rest B/W" for a mixed order. */
export function colourModeLabel(options: Pick<PrintOptions, 'colour' | 'colourPages'>): string {
  if (!options.colour) return 'B/W';
  const pages = options.colourPages?.trim();
  return pages ? `Colour p. ${pages}, rest B/W` : 'Colour';
}

/** Server-calculated quote; all money in integer paise (PRD §8.2). */
export const QuoteSchema = z.object({
  selectedPages: z.int().nonnegative(),
  copies: z.int().positive(),
  printedSides: z.int().nonnegative(),
  sheets: z.int().nonnegative(),
  /** Per-side rate; for a mixed-colour order, the B/W rate (colour sides are in `mixedColour`). */
  ratePaise: z.int().nonnegative(),
  /** Present only when some pages print in colour and others B/W. */
  mixedColour: z
    .object({
      colourSides: z.int().nonnegative(),
      colourRatePaise: z.int().nonnegative(),
    })
    .optional(),
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
