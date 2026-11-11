/**
 * Realtime contract (PRD §12, Phase 2–5 contracts §5). Socket.IO on the API origin, path
 * `/socket.io`. Events are HINTS only: payloads carry ids + status, never PII or URLs, and every
 * client must be able to recover the same state over REST (CLAUDE.md invariant 13).
 */
import { type OrderStatus } from './enums.js';

export const REALTIME_PATH = '/socket.io';

export const RealtimeNamespace = {
  SHOP: '/shop',
  CUSTOMER: '/customer',
  ADMIN: '/admin',
} as const;
export type RealtimeNamespace = (typeof RealtimeNamespace)[keyof typeof RealtimeNamespace];

export const RealtimeEvent = {
  JOB_CREATED: 'job.created',
  JOB_UPDATED: 'job.updated',
  SHOP_MODE_CHANGED: 'shop.mode_changed',
  DEVICE_REVOKED: 'device.revoked',
  ORDER_UPDATED: 'order.updated',
  DEVICE_STATUS: 'device.status',
  PRINTER_STATUS: 'printer.status',
  /** ADR-003: a customer payment report was opened/decided (room `shop:{shopId}`). */
  PAYMENT_REPORT: 'payment_report.changed',
} as const;
export type RealtimeEvent = (typeof RealtimeEvent)[keyof typeof RealtimeEvent];

/** Handshake `auth` for `/shop`. */
export interface ShopSocketAuth {
  token: string;
}
/** Handshake `auth` for `/customer` (the tracking token may also come from the order cookie). */
export interface CustomerSocketAuth {
  orderId: string;
  trackingToken?: string;
}

/** `job.created` / `job.updated` (room `shop:{shopId}`) and `order.updated` (customer + admin). */
export interface OrderStatusHint {
  orderId: string;
  status: OrderStatus;
  /** ISO-8601 UTC time of the transition. */
  at: string;
}
export interface ShopModeChangedHint {
  approvalMode: 'MANUAL' | 'AUTO';
  autoPaused: boolean;
}
export interface DeviceRevokedHint {
  deviceId: string;
}
export interface DeviceStatusHint {
  deviceId: string;
  shopId: string;
  online: boolean;
}
export interface PrinterStatusHint {
  printerId: string;
  shopId: string;
  status: string;
}

export interface PaymentReportHint {
  reportId: string;
  orderId: string;
  status: 'OPEN' | 'APPROVED' | 'DECLINED' | 'SUPERSEDED';
}

/** `connect_error` messages for refused handshakes (the error also carries `data.code`). */
export const RealtimeErrorCode = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  DEVICE_REVOKED: 'DEVICE_REVOKED',
  ORDER_NOT_FOUND: 'ORDER_NOT_FOUND',
  ADMIN_UNAUTHENTICATED: 'ADMIN_UNAUTHENTICATED',
} as const;
export type RealtimeErrorCode = (typeof RealtimeErrorCode)[keyof typeof RealtimeErrorCode];
