/**
 * Domain enums shared by the API and the web app.
 * Declared as const objects (not TS enums) so they work at runtime, in zod schemas and in JSON.
 * Source of truth: docs/PRD.md §9.
 */

export const AppEnv = {
  LOCAL: 'local',
  DEMO: 'demo',
  STAGING: 'staging',
  PRODUCTION: 'production',
} as const;
export type AppEnv = (typeof AppEnv)[keyof typeof AppEnv];

/** How payments are processed in the running environment. */
export const PaymentMode = {
  DEMO: 'DEMO',
  LIVE: 'LIVE',
} as const;
export type PaymentMode = (typeof PaymentMode)[keyof typeof PaymentMode];

export const OrderStatus = {
  DRAFT: 'DRAFT',
  AWAITING_PAYMENT: 'AWAITING_PAYMENT',
  PENDING_REVIEW: 'PENDING_REVIEW',
  QUEUED: 'QUEUED',
  PRINTING: 'PRINTING',
  NEEDS_OPERATOR_CHECK: 'NEEDS_OPERATOR_CHECK',
  READY_FOR_PICKUP: 'READY_FOR_PICKUP',
  COLLECTED: 'COLLECTED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
  REFUND_PENDING: 'REFUND_PENDING',
  REFUNDED: 'REFUNDED',
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

/** Stored separately from OrderStatus: "paid" never means "printed". */
export const PaymentStatus = {
  CREATED: 'CREATED',
  PENDING: 'PENDING',
  PAID: 'PAID',
  FAILED: 'FAILED',
  REFUND_PENDING: 'REFUND_PENDING',
  REFUNDED: 'REFUNDED',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const PrintJobStatus = {
  PREPARING: 'PREPARING',
  READY: 'READY',
  LEASED: 'LEASED',
  SUBMITTED: 'SUBMITTED',
  SPOOLER_COMPLETE: 'SPOOLER_COMPLETE',
  FAILED: 'FAILED',
  UNCERTAIN: 'UNCERTAIN',
  CANCELLED: 'CANCELLED',
  SUPERSEDED: 'SUPERSEDED',
} as const;
export type PrintJobStatus = (typeof PrintJobStatus)[keyof typeof PrintJobStatus];

export const ApprovalMode = {
  MANUAL: 'MANUAL',
  AUTO: 'AUTO',
} as const;
export type ApprovalMode = (typeof ApprovalMode)[keyof typeof ApprovalMode];

export const ShopStatus = {
  OPEN: 'OPEN',
  CLOSED: 'CLOSED',
  MAINTENANCE: 'MAINTENANCE',
} as const;
export type ShopStatus = (typeof ShopStatus)[keyof typeof ShopStatus];

export const DuplexRule = {
  SAME_AS_SIMPLEX: 'SAME_AS_SIMPLEX',
  DISCOUNTED_SIDE_RATE: 'DISCOUNTED_SIDE_RATE',
} as const;
export type DuplexRule = (typeof DuplexRule)[keyof typeof DuplexRule];

export const RejectReasonCode = {
  FILE_UNREADABLE: 'FILE_UNREADABLE',
  CONTENT_NOT_ALLOWED: 'CONTENT_NOT_ALLOWED',
  PRINTER_UNAVAILABLE: 'PRINTER_UNAVAILABLE',
  OPTION_UNSUPPORTED: 'OPTION_UNSUPPORTED',
  SHOP_CLOSING: 'SHOP_CLOSING',
  OUT_OF_SUPPLIES: 'OUT_OF_SUPPLIES',
  PRINT_FAILED: 'PRINT_FAILED',
  OTHER: 'OTHER',
} as const;
export type RejectReasonCode = (typeof RejectReasonCode)[keyof typeof RejectReasonCode];

export const UserRole = {
  CUSTOMER: 'CUSTOMER',
  SHOP_OPERATOR: 'SHOP_OPERATOR',
  SHOP_OWNER: 'SHOP_OWNER',
  ADMIN: 'ADMIN',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];
