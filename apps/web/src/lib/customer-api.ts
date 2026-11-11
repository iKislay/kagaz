import {
  type Customer,
  type MeResponse,
  MeResponseSchema,
  type MyOrder,
  MyOrdersResponseSchema,
  type OtpRequestResponse,
  OtpRequestResponseSchema,
  type PayResponse,
  PayResponseSchema,
  type PublicOrder,
  PublicOrderSchema,
  type ReportPaymentRequest,
} from '@kagaz/shared';
import { apiFetch } from './api';

// ─── Customer identity (P2.2) — the session is an httpOnly cookie set by the API ───

export const requestOtp = (phone: string): Promise<OtpRequestResponse> =>
  apiFetch('/auth/otp/request', OtpRequestResponseSchema, { method: 'POST', body: { phone } });

export const verifyOtp = async (phone: string, code: string): Promise<Customer | null> =>
  (
    await apiFetch('/auth/otp/verify', MeResponseSchema, {
      method: 'POST',
      body: { phone, code },
    })
  ).customer;

export const signOut = (): Promise<MeResponse> =>
  apiFetch('/auth/logout', MeResponseSchema, { method: 'POST' });

export const getMe = async (): Promise<Customer | null> =>
  (await apiFetch('/me', MeResponseSchema)).customer;

export const listMyOrders = async (): Promise<MyOrder[]> =>
  (await apiFetch('/me/orders', MyOrdersResponseSchema)).orders;

// ─── Payment states (P3.5) and cancellation (P3.6) ───

/** Pay again: retries after a failure, or re-checks a pending payment. Never sends an amount. */
export const retryPayment = (id: string, token: string | null): Promise<PayResponse> =>
  apiFetch(`/orders/${id}/pay`, PayResponseSchema, { method: 'POST', token });

export const cancelOrder = (id: string, token: string | null): Promise<PublicOrder> =>
  apiFetch(`/orders/${id}/cancel`, PublicOrderSchema, { method: 'POST', token });

// ─── Direct-to-shop UPI (ADR-003) ───

/**
 * "I paid but it isn't confirmed": send the 12-digit UPI reference (UTR) to the shop, who checks
 * their account and approves or declines. Returns the updated order.
 */
export const reportPayment = (
  id: string,
  utr: string,
  token: string | null,
): Promise<PublicOrder> =>
  apiFetch(`/orders/${id}/payment-report`, PublicOrderSchema, {
    method: 'POST',
    body: { utr } satisfies ReportPaymentRequest,
    token,
  });

/** Only ever navigate to an http(s) checkout URL from the API (never `javascript:` and the like). */
export function safeCheckoutUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

/** Send the browser to the hosted UPI checkout; YouPI returns it to /order/:id. */
export function openCheckout(url: string | null | undefined): boolean {
  const safe = safeCheckoutUrl(url);
  if (!safe) return false;
  window.location.assign(safe);
  return true;
}

/** "+91 98765 43210" /"9876543210" → "+919876543210" (server validates again). */
export function normalizeIndianPhone(input: string): string {
  const digits = input.replace(/\D/g, '');
  const local = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  return `+91${local.slice(-10)}`;
}
