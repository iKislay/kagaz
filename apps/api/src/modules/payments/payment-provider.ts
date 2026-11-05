/**
 * Provider-independent payment boundary (PRD §8.7, FR-PAY-01).
 * OrderService/PaymentsService call ONLY this interface — never Razorpay/Cashfree code.
 * The contract is frozen and covered by a reusable contract test suite in P3.1.
 */

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export type ProviderPaymentState = 'PENDING' | 'PAID' | 'FAILED';

export interface CreatePaymentInput {
  orderId: string;
  /** Human reference for the provider dashboard (e.g. KGZ-7H3K2Q). */
  publicRef: string;
  amountPaise: number;
  currency: 'INR';
}

export type CheckoutInstruction =
  /** Demo only: the provider has already approved; nothing for the customer to do. */
  | { kind: 'DEMO_AUTO_APPROVE' }
  /** Live (P3.9): data the browser needs to open the provider's checkout. */
  | { kind: 'PROVIDER_CHECKOUT'; data: Record<string, unknown> };

export interface PaymentSession {
  providerOrderId: string;
  checkout: CheckoutInstruction;
}

export interface ProviderPaymentStatus {
  state: ProviderPaymentState;
  providerPaymentId: string | null;
  /** Amount the provider says was paid; verified against our snapshot when present. */
  amountPaise: number | null;
}

export interface VerifiedPaymentEvent {
  /** Provider's unique event id — deduplicated in webhook_events (P3.3). */
  eventId: string;
  providerOrderId: string;
  providerPaymentId: string | null;
  state: ProviderPaymentState;
  amountPaise: number | null;
  occurredAt: Date;
}

export interface RefundInput {
  providerPaymentId: string;
  amountPaise: number;
  idempotencyKey: string;
}

export interface RefundResult {
  providerRefundId: string;
  state: 'PENDING' | 'SUCCEEDED' | 'FAILED';
}

export class WebhookSignatureError extends Error {
  override name = 'WebhookSignatureError';
}

export interface PaymentProvider {
  /** Stored on Payment.provider, e.g. "demo", "razorpay". */
  readonly name: string;
  /** True for providers that never move money (DEMO). Drives the UI labels. */
  readonly simulated: boolean;

  createPayment(input: CreatePaymentInput): Promise<PaymentSession>;
  /** Verify the signature over the exact raw body; throws WebhookSignatureError. */
  verifyWebhook(rawBody: Buffer, headers: Record<string, string>): Promise<VerifiedPaymentEvent>;
  /** Server-to-server status check — a browser redirect is never proof of payment. */
  fetchPaymentStatus(providerOrderId: string): Promise<ProviderPaymentStatus>;
  refund(input: RefundInput): Promise<RefundResult>;
}
