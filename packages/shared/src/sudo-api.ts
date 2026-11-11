/**
 * Request/response contracts for the platform-owner console (/sudoadmin, API `/api/sudo/*`).
 * Only Kagaz platform admins (role ADMIN) can call these endpoints.
 *
 * Covers tenant lifecycle (onboard, suspend, archive, delete), shop team accounts, the
 * subscription plan catalogue, shop subscriptions + manually recorded subscription payments,
 * and platform admin accounts.
 *
 * Money is integer paise. Subscription payments are bookkeeping of money Kagaz received from a
 * shop (cash/UPI/bank transfer); they never go through PaymentProvider and have nothing to do
 * with customer order payments.
 */
import { z } from 'zod';

const ShopStatusSchema = z.enum(['OPEN', 'CLOSED', 'MAINTENANCE']);

export const SubscriptionStatusSchema = z.enum(['TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED']);
export type SubscriptionStatus = z.infer<typeof SubscriptionStatusSchema>;
/** Statuses of a subscription that is still running (at most one per shop). */
export const OPEN_SUBSCRIPTION_STATUSES = ['TRIALING', 'ACTIVE', 'PAST_DUE'] as const;

export const BillingIntervalSchema = z.enum(['MONTHLY', 'YEARLY']);
export type BillingInterval = z.infer<typeof BillingIntervalSchema>;

export const SubscriptionPaymentMethodSchema = z.enum(['CASH', 'UPI', 'BANK_TRANSFER', 'OTHER']);
export type SubscriptionPaymentMethod = z.infer<typeof SubscriptionPaymentMethodSchema>;

/** LIVE: normal. SUSPENDED: no new orders, hidden from customers. ARCHIVED: offboarded. */
export const ShopLifecycleSchema = z.enum(['LIVE', 'SUSPENDED', 'ARCHIVED']);
export type ShopLifecycle = z.infer<typeof ShopLifecycleSchema>;

export const ShopMemberRoleSchema = z.enum(['OWNER', 'OPERATOR']);
export type ShopMemberRole = z.infer<typeof ShopMemberRoleSchema>;

const E164 = z.string().regex(/^\+[1-9]\d{7,14}$/, 'Use E.164, e.g. +919876543210');
/** Up to ₹10,00,000 — guards against typos in paise. */
const Paise = z.int().min(0).max(100_000_000);
const Password = z.string().min(10, 'Use at least 10 characters').max(200);
const Slug = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/, 'lowercase letters, digits and dashes');
const Name = z.string().trim().min(1).max(120);
const Note = z.string().trim().max(1000);
const IsoDate = z.iso.datetime({ offset: true });

// ─── Plans ───

export const SudoPlanSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  pricePaise: z.int(),
  interval: BillingIntervalSchema,
  trialDays: z.int(),
  maxPrinters: z.int().nullable(),
  maxMonthlyOrders: z.int().nullable(),
  active: z.boolean(),
  /** Shops currently on this plan (open subscriptions). */
  subscriberCount: z.int(),
  createdAt: z.string(),
});
export type SudoPlan = z.infer<typeof SudoPlanSchema>;
export const SudoPlanListSchema = z.object({ plans: z.array(SudoPlanSchema) });
export type SudoPlanList = z.infer<typeof SudoPlanListSchema>;

export const SudoPlanCreateRequestSchema = z.strictObject({
  code: Slug,
  name: Name,
  description: Note.optional(),
  pricePaise: Paise,
  interval: BillingIntervalSchema,
  trialDays: z.int().min(0).max(365).optional(),
  maxPrinters: z.int().min(1).max(100).nullable().optional(),
  maxMonthlyOrders: z.int().min(1).max(1_000_000).nullable().optional(),
});
export type SudoPlanCreateRequest = z.infer<typeof SudoPlanCreateRequestSchema>;

/** `code` and `interval` are fixed once a plan exists. */
export const SudoPlanUpdateRequestSchema = z.strictObject({
  name: Name.optional(),
  description: Note.nullable().optional(),
  pricePaise: Paise.optional(),
  trialDays: z.int().min(0).max(365).optional(),
  maxPrinters: z.int().min(1).max(100).nullable().optional(),
  maxMonthlyOrders: z.int().min(1).max(1_000_000).nullable().optional(),
  active: z.boolean().optional(),
});
export type SudoPlanUpdateRequest = z.infer<typeof SudoPlanUpdateRequestSchema>;

// ─── Subscriptions ───

export const SudoSubscriptionSchema = z.object({
  id: z.uuid(),
  shopId: z.uuid(),
  plan: z.object({ id: z.uuid(), code: z.string(), name: z.string() }),
  status: SubscriptionStatusSchema,
  pricePaise: z.int(),
  interval: BillingIntervalSchema,
  currentPeriodStart: z.string(),
  currentPeriodEnd: z.string(),
  trialEndsAt: z.string().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  cancelledAt: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
  /** Still open but the current period has ended without a renewal payment. */
  overdue: z.boolean(),
  /** Whole days until currentPeriodEnd (negative once past). */
  daysLeft: z.int(),
  paymentCount: z.int(),
});
export type SudoSubscription = z.infer<typeof SudoSubscriptionSchema>;

export const SudoSubscriptionCreateRequestSchema = z.strictObject({
  planId: z.uuid(),
  /** Agreed price; defaults to the plan's price. */
  pricePaise: Paise.optional(),
  /** Defaults to the plan's trial days. 0 starts ACTIVE immediately. */
  trialDays: z.int().min(0).max(365).optional(),
  /** Defaults to now. */
  startsAt: IsoDate.optional(),
  notes: Note.optional(),
});
export type SudoSubscriptionCreateRequest = z.infer<typeof SudoSubscriptionCreateRequestSchema>;

/** Change plan/price/period/status of an open subscription. */
export const SudoSubscriptionUpdateRequestSchema = z.strictObject({
  planId: z.uuid().optional(),
  pricePaise: Paise.optional(),
  status: z.enum(OPEN_SUBSCRIPTION_STATUSES).optional(),
  currentPeriodEnd: IsoDate.optional(),
  cancelAtPeriodEnd: z.boolean().optional(),
  notes: Note.nullable().optional(),
});
export type SudoSubscriptionUpdateRequest = z.infer<typeof SudoSubscriptionUpdateRequestSchema>;

export const SudoSubscriptionCancelRequestSchema = z.strictObject({
  /** true: keep running until currentPeriodEnd; false: end now. */
  atPeriodEnd: z.boolean(),
  reason: Note.optional(),
});
export type SudoSubscriptionCancelRequest = z.infer<typeof SudoSubscriptionCancelRequestSchema>;

export const SudoSubscriptionPaymentSchema = z.object({
  id: z.uuid(),
  subscriptionId: z.uuid(),
  amountPaise: z.int(),
  method: SubscriptionPaymentMethodSchema,
  reference: z.string().nullable(),
  note: z.string().nullable(),
  periodStart: z.string(),
  periodEnd: z.string(),
  paidAt: z.string(),
  recordedBy: z.object({ id: z.uuid(), name: z.string().nullable() }).nullable(),
  createdAt: z.string(),
});
export type SudoSubscriptionPayment = z.infer<typeof SudoSubscriptionPaymentSchema>;

export const SudoSubscriptionPaymentCreateRequestSchema = z.strictObject({
  amountPaise: z.int().min(1).max(100_000_000),
  method: SubscriptionPaymentMethodSchema,
  reference: z.string().trim().max(120).optional(),
  note: Note.optional(),
  /** Defaults to now. */
  paidAt: IsoDate.optional(),
  /**
   * Default true: the payment covers the next period — the subscription becomes ACTIVE and its
   * period moves forward by one interval. false: just record the money.
   */
  extendPeriod: z.boolean().optional(),
});
export type SudoSubscriptionPaymentCreateRequest = z.infer<
  typeof SudoSubscriptionPaymentCreateRequestSchema
>;

// ─── Shop team accounts ───

export const SudoMemberSchema = z.object({
  userId: z.uuid(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  role: ShopMemberRoleSchema,
  hasPassword: z.boolean(),
  joinedAt: z.string(),
});
export type SudoMember = z.infer<typeof SudoMemberSchema>;

const AccountFields = {
  name: Name,
  email: z.email().max(200).optional(),
  phone: E164.optional(),
  /** Omit to generate a temporary password (shown once). */
  password: Password.optional(),
};
const needsLogin = (v: { email?: string; phone?: string }) => !!(v.email ?? v.phone);

export const SudoAccountRequestSchema = z
  .strictObject(AccountFields)
  .refine(needsLogin, { message: 'Give an email or a phone number', path: ['email'] });
export type SudoAccountRequest = z.infer<typeof SudoAccountRequestSchema>;

export const SudoMemberCreateRequestSchema = z
  .strictObject({ ...AccountFields, role: ShopMemberRoleSchema })
  .refine(needsLogin, { message: 'Give an email or a phone number', path: ['email'] });
export type SudoMemberCreateRequest = z.infer<typeof SudoMemberCreateRequestSchema>;

export const SudoMemberUpdateRequestSchema = z.strictObject({ role: ShopMemberRoleSchema });
export type SudoMemberUpdateRequest = z.infer<typeof SudoMemberUpdateRequestSchema>;

export const SudoPasswordResetRequestSchema = z.strictObject({ password: Password.optional() });
export type SudoPasswordResetRequest = z.infer<typeof SudoPasswordResetRequestSchema>;

/** A generated password is returned exactly once, never stored in plaintext or audited. */
export const SudoMemberCreatedSchema = z.object({
  member: SudoMemberSchema,
  /** The login already existed and was added to this shop (its password is unchanged). */
  existingUser: z.boolean(),
  temporaryPassword: z.string().nullable(),
});
export type SudoMemberCreated = z.infer<typeof SudoMemberCreatedSchema>;

export const SudoPasswordResetSchema = z.object({ temporaryPassword: z.string().nullable() });
export type SudoPasswordReset = z.infer<typeof SudoPasswordResetSchema>;

// ─── Shops (tenants) ───

export const SudoShopRowSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  address: z.string(),
  contactPhone: z.string().nullable(),
  status: ShopStatusSchema,
  lifecycle: ShopLifecycleSchema,
  isDemo: z.boolean(),
  suspendedReason: z.string().nullable(),
  createdAt: z.string(),
  owners: z.array(z.object({ name: z.string().nullable(), login: z.string().nullable() })),
  memberCount: z.int(),
  devicesOnline: z.int(),
  devicesTotal: z.int(),
  printers: z.int(),
  /** Paid orders in the last 30 days and their value (includes demo payments). */
  orders30d: z.int(),
  gmv30dPaise: z.int(),
  subscription: SudoSubscriptionSchema.nullable(),
});
export type SudoShopRow = z.infer<typeof SudoShopRowSchema>;
export const SudoShopListSchema = z.object({ shops: z.array(SudoShopRowSchema) });
export type SudoShopList = z.infer<typeof SudoShopListSchema>;

export const SudoShopDetailSchema = SudoShopRowSchema.extend({
  suspendedAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
  updatedAt: z.string(),
  ordersTotal: z.int(),
  /** Only shops that never had an order can be deleted; others are archived. */
  canDelete: z.boolean(),
  members: z.array(SudoMemberSchema),
  subscriptionHistory: z.array(SudoSubscriptionSchema),
  payments: z.array(SudoSubscriptionPaymentSchema),
});
export type SudoShopDetail = z.infer<typeof SudoShopDetailSchema>;

/** One-step onboarding: the shop, optionally its owner account and first subscription. */
export const SudoShopCreateRequestSchema = z.strictObject({
  slug: Slug,
  name: z.string().trim().min(2).max(120),
  address: z.string().trim().min(2).max(300),
  contactPhone: E164.optional(),
  isDemo: z.boolean().optional(),
  owner: SudoAccountRequestSchema.optional(),
  subscription: z
    .strictObject({
      planId: z.uuid(),
      pricePaise: Paise.optional(),
      trialDays: z.int().min(0).max(365).optional(),
    })
    .optional(),
});
export type SudoShopCreateRequest = z.infer<typeof SudoShopCreateRequestSchema>;

export const SudoShopCreatedSchema = z.object({
  shop: SudoShopDetailSchema,
  ownerTemporaryPassword: z.string().nullable(),
  ownerExistingUser: z.boolean(),
});
export type SudoShopCreated = z.infer<typeof SudoShopCreatedSchema>;

export const SudoShopReasonRequestSchema = z.strictObject({
  reason: z.string().trim().min(3).max(300),
});
export type SudoShopReasonRequest = z.infer<typeof SudoShopReasonRequestSchema>;

/** Deleting needs the shop's slug typed back. */
export const SudoShopDeleteRequestSchema = z.strictObject({ confirmSlug: z.string() });
export type SudoShopDeleteRequest = z.infer<typeof SudoShopDeleteRequestSchema>;

// ─── Platform admins ───

export const SudoAdminSchema = z.object({
  id: z.uuid(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  createdAt: z.string(),
  isSelf: z.boolean(),
});
export type SudoAdmin = z.infer<typeof SudoAdminSchema>;
export const SudoAdminListSchema = z.object({ admins: z.array(SudoAdminSchema) });
export type SudoAdminList = z.infer<typeof SudoAdminListSchema>;

export const SudoAdminCreateRequestSchema = z.strictObject({
  name: Name,
  email: z.email().max(200),
  password: Password.optional(),
});
export type SudoAdminCreateRequest = z.infer<typeof SudoAdminCreateRequestSchema>;

export const SudoAdminCreatedSchema = z.object({
  admin: SudoAdminSchema,
  temporaryPassword: z.string().nullable(),
});
export type SudoAdminCreated = z.infer<typeof SudoAdminCreatedSchema>;

// ─── Overview ───

export const SudoAttentionKindSchema = z.enum([
  'OVERDUE',
  'PAST_DUE',
  'TRIAL_ENDING',
  'RENEWAL_DUE',
  'NO_SUBSCRIPTION',
  'SUSPENDED',
  'NOT_PAIRED',
]);
export type SudoAttentionKind = z.infer<typeof SudoAttentionKindSchema>;

export const SudoOverviewSchema = z.object({
  shops: z.object({
    total: z.int(),
    live: z.int(),
    suspended: z.int(),
    archived: z.int(),
    demo: z.int(),
  }),
  subscriptions: z.object({
    trialing: z.int(),
    active: z.int(),
    pastDue: z.int(),
    overdue: z.int(),
    /** Live shops without an open subscription. */
    none: z.int(),
  }),
  /** Monthly-equivalent of ACTIVE + PAST_DUE subscriptions (yearly ÷ 12, rounded down). */
  mrrPaise: z.int(),
  collectedThisMonthPaise: z.int(),
  collectedLastMonthPaise: z.int(),
  orders30d: z.int(),
  gmv30dPaise: z.int(),
  attention: z.array(
    z.object({
      shopId: z.uuid(),
      shopName: z.string(),
      kind: SudoAttentionKindSchema,
      detail: z.string(),
    }),
  ),
  recentPayments: z.array(
    z.object({
      id: z.uuid(),
      shopId: z.uuid(),
      shopName: z.string(),
      amountPaise: z.int(),
      method: SubscriptionPaymentMethodSchema,
      paidAt: z.string(),
    }),
  ),
});
export type SudoOverview = z.infer<typeof SudoOverviewSchema>;
