/**
 * Provider-independent payment boundary (PRD §8.7, FR-PAY-01) — FROZEN in P3.1, extended by
 * ADR-003 (P6.3): `createPayment` gets the shop + return URL (per-shop merchant accounts) and
 * providers declare whether refunds go through their API or are done by the shop by hand.
 *
 * OrderService/PaymentsService call ONLY this interface — never Razorpay/Cashfree code.
 * Every adapter (DemoMockProvider now, a live gateway after D6) must pass the reusable
 * contract suite in `payment-provider.contract.ts`.
 *
 * Rules every adapter follows:
 * - all amounts are positive integer paise (INR); never floats
 * - `verifyWebhook` checks the signature over the EXACT raw body and throws
 *   `WebhookSignatureError` on any mismatch — it never returns an unverified event
 * - `refund` is idempotent per `idempotencyKey` (same key → same refund)
 * - provider statuses are mapped to the small enums below; nothing provider-specific leaks out
 */

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

/** Provider-side state of one payment (mapped from the gateway's own vocabulary). */
export type ProviderPaymentState = 'PENDING' | 'PAID' | 'FAILED';
export const PROVIDER_PAYMENT_STATES: readonly ProviderPaymentState[] = [
  'PENDING',
  'PAID',
  'FAILED',
];

/** Provider-side state of one refund. */
export type ProviderRefundState = 'PENDING' | 'SUCCEEDED' | 'FAILED';

export interface CreatePaymentInput {
  orderId: string;
  /** Shop that receives the money (selects the shop's own merchant account, ADR-003). */
  shopId: string;
  /** Where the hosted checkout sends the customer back (the order page). Never proof of payment. */
  returnUrl: string;
  /** Human reference for the provider dashboard (e.g. KGZ-7H3K2Q). */
  publicRef: string;
  /**
   * Merchant-side receipt, unique per payment attempt (publicRef for the first attempt,
   * `<publicRef>-<n>` for retries after a failure).
   */
  receipt: string;
  amountPaise: number;
  currency: 'INR';
}

export type CheckoutInstruction =
  /** Demo only: nothing for the customer to do; the simulated gateway settles server-side. */
  | { kind: 'DEMO_AUTO_APPROVE' }
  /** ADR-003: send the browser to a hosted UPI page (QR + UPI app links for the shop's VPA). */
  | { kind: 'UPI_CHECKOUT'; checkoutUrl: string }
  /** Live (P3.9): data the browser needs to open the provider's checkout. */
  | { kind: 'PROVIDER_CHECKOUT'; data: Record<string, unknown> };

/** Result of `createPayment`. */
export interface PaymentSession {
  providerOrderId: string;
  checkout: CheckoutInstruction;
}

/** Result of the server-to-server status fetch (PRD §8.7 `PaymentStatus`). */
export interface ProviderPaymentStatus {
  state: ProviderPaymentState;
  /** Set once the provider has a payment id (always when PAID). */
  providerPaymentId: string | null;
  /** Amount the provider says was paid; verified against our snapshot when present. */
  amountPaise: number | null;
}
/** PRD name for the fetch result. */
export type PaymentStatusResult = ProviderPaymentStatus;

interface VerifiedEventBase {
  /** Provider's unique event id — deduplicated by unique (provider, provider_event_id). */
  eventId: string;
  occurredAt: Date;
}

/** A webhook event whose signature has been verified. */
export type VerifiedPaymentEvent =
  | (VerifiedEventBase & {
      type: 'PAYMENT';
      providerOrderId: string;
      providerPaymentId: string | null;
      amountPaise: number | null;
      status: ProviderPaymentState;
    })
  | (VerifiedEventBase & {
      type: 'REFUND';
      providerRefundId: string;
      providerPaymentId: string | null;
      amountPaise: number | null;
      status: ProviderRefundState;
    });

export interface RefundInput {
  providerPaymentId: string;
  amountPaise: number;
  /** `refund:<paymentId>:<n>` — the provider must treat repeats as the same refund. */
  idempotencyKey: string;
}

export interface RefundResult {
  providerRefundId: string;
  status: ProviderRefundState;
}

export class WebhookSignatureError extends Error {
  override name = 'WebhookSignatureError';
}

/** Thrown for invalid inputs (non-integer/negative paise, unknown payment, over-refund). */
export class PaymentProviderInputError extends Error {
  override name = 'PaymentProviderInputError';
}

export interface PaymentProvider {
  /** Stored on Payment.provider and used in the webhook path, e.g. "demo", "razorpay". */
  readonly name: string;
  /** True for providers that never move money (DEMO). Drives the UI labels. */
  readonly simulated: boolean;
  /**
   * `API`: `refund()` moves the money. `MANUAL` (ADR-003): the provider cannot move money;
   * `refund()` only returns a PENDING placeholder and the shop confirms it sent the money back.
   */
  readonly refundMode: 'API' | 'MANUAL';

  createPayment(input: CreatePaymentInput): Promise<PaymentSession>;
  /** Verify the signature over the exact raw body; throws WebhookSignatureError. */
  verifyWebhook(rawBody: Buffer, headers: Record<string, string>): Promise<VerifiedPaymentEvent>;
  /** Server-to-server status check — a browser redirect is never proof of payment. */
  fetchPaymentStatus(providerOrderId: string): Promise<ProviderPaymentStatus>;
  refund(input: RefundInput): Promise<RefundResult>;
}

/** Positive integer paise check shared by adapters. */
export function assertProviderPaise(value: number, field: string, allowZero = false): void {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new PaymentProviderInputError(
      `${field} must be a positive integer (paise), got ${value}`,
    );
  }
}
