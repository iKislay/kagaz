import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  type CreatePaymentInput,
  type PaymentProvider,
  type PaymentSession,
  type ProviderPaymentState,
  type ProviderPaymentStatus,
  type RefundInput,
  type RefundResult,
  type VerifiedPaymentEvent,
  WebhookSignatureError,
  assertProviderPaise,
} from '../../payment-provider.js';
import { type YoupiClient, type YoupiMerchantCredentials, parsePaise } from './youpi-client.js';

/** Per-shop YouPI credentials, decrypted on demand (implemented by ShopPaymentAccountsService). */
export interface YoupiAccountResolver {
  /** Throws when the shop has not finished payment setup. */
  forShop(shopId: string): Promise<YoupiAccount>;
  /** Account of the shop that owns this YouPI payment id (= Payment.providerOrderId), or null. */
  forProviderOrder(providerOrderId: string): Promise<YoupiAccount | null>;
}

export interface YoupiAccount extends YoupiMerchantCredentials {
  webhookSecret: string;
}

/** YouPI retries failed deliveries for up to 1 h with the ORIGINAL timestamp. */
export const WEBHOOK_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const WEBHOOK_MAX_FUTURE_MS = 5 * 60 * 1000;

/** A bank UTR is 12 digits; anything else is not used as a payment reference. */
const UTR = /^\d{12}$/;

/**
 * Map a YouPI status/outcome to the provider-neutral state (ADR-003 §3).
 * PAID only for a UPI alert match (OBSERVED_SUCCESS) or a statement match (RECONCILED).
 * `SUCCESS` is YouPI's COD/counter outcome — never money received — so it stays PENDING.
 * `MANUAL_REVIEW` (ambiguous alert) stays PENDING: the customer may report, the shop decides.
 */
export function mapYoupiStatus(status: string, method: string): ProviderPaymentState {
  switch (status) {
    case 'OBSERVED_SUCCESS':
    case 'RECONCILED':
      return method === 'UPI' ? 'PAID' : 'PENDING';
    case 'FAILED':
    case 'EXPIRED':
    case 'CANCELLED':
      return 'FAILED';
    default:
      return 'PENDING';
  }
}

function hmacHex(secret: string, data: Buffer): string {
  return createHmac('sha256', secret).update(data).digest('hex');
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * ADR-003 adapter: customers pay the shop's own UPI ID; YouPI detects the credit and posts a
 * signed webhook. Kagaz never handles the money, so refunds are MANUAL (the shop sends them).
 */
export class YoupiProvider implements PaymentProvider {
  readonly name = 'youpi';
  readonly simulated = false;
  readonly refundMode = 'MANUAL' as const;

  constructor(
    private readonly client: YoupiClient,
    private readonly accounts: YoupiAccountResolver,
    private readonly now: () => number = Date.now,
  ) {}

  async createPayment(input: CreatePaymentInput): Promise<PaymentSession> {
    assertProviderPaise(input.amountPaise, 'amountPaise');
    const account = await this.accounts.forShop(input.shopId);
    const created = await this.client.createPayment(account, {
      // The receipt is unique per attempt; YouPI dedupes active sessions per orderId.
      orderId: input.receipt,
      amountPaise: input.amountPaise,
      returnUrl: input.returnUrl,
      idempotencyKey: `kagaz:${input.receipt}`,
      metadata: { kagazOrderId: input.orderId, publicRef: input.publicRef },
    });
    return {
      providerOrderId: created.paymentId,
      checkout: { kind: 'UPI_CHECKOUT', checkoutUrl: created.checkoutUrl },
    };
  }

  /**
   * Verifies `X-Gateway-Signature-V2 = sha256=HMAC(secret, "<timestamp>.<raw body>")` with the
   * shop's webhook secret (looked up from the payment id in the body — the body is only trusted
   * after the signature matches), checks freshness and the delivery id, then maps the event.
   */
  async verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string>,
  ): Promise<VerifiedPaymentEvent> {
    const signature = headers['x-gateway-signature-v2'];
    const timestamp = headers['x-gateway-timestamp'];
    const deliveryId = headers['x-gateway-delivery-id'];
    if (!signature || !timestamp || !deliveryId || !/^\d{10,16}$/.test(timestamp)) {
      throw new WebhookSignatureError('missing YouPI signature headers');
    }

    let body: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(rawBody.toString('utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      body = parsed as Record<string, unknown>;
    } catch {
      throw new WebhookSignatureError('webhook body is not a JSON object');
    }
    const paymentId = typeof body.paymentId === 'string' ? body.paymentId : null;
    if (!paymentId) throw new WebhookSignatureError('webhook has no paymentId');

    const account = await this.accounts.forProviderOrder(paymentId);
    if (!account) throw new WebhookSignatureError('no shop account for this payment');

    const signed = Buffer.concat([Buffer.from(`${timestamp}.`, 'utf8'), rawBody]);
    const expected = `sha256=${hmacHex(account.webhookSecret, signed)}`;
    if (!safeEqual(signature, expected)) throw new WebhookSignatureError('signature mismatch');

    // Authenticated from here on.
    const sentAt = Number(timestamp);
    const age = this.now() - sentAt;
    if (age > WEBHOOK_MAX_AGE_MS || age < -WEBHOOK_MAX_FUTURE_MS) {
      throw new WebhookSignatureError('webhook timestamp outside the accepted window');
    }
    if (body.deliveryId !== deliveryId) {
      throw new WebhookSignatureError('delivery id header/body mismatch');
    }

    const event = typeof body.event === 'string' ? body.event : '';
    const method = typeof body.method === 'string' ? body.method : '';
    let status = mapYoupiStatus(event, method);
    if (status === 'PAID' && body.currency !== 'INR') status = 'PENDING';
    const utr = typeof body.utr === 'string' && UTR.test(body.utr) ? body.utr : null;

    return {
      type: 'PAYMENT',
      eventId: deliveryId,
      occurredAt: new Date(sentAt),
      providerOrderId: paymentId,
      providerPaymentId: utr,
      amountPaise: parsePaise(body.amountPaise),
      status,
    };
  }

  async fetchPaymentStatus(providerOrderId: string): Promise<ProviderPaymentStatus> {
    const account = await this.accounts.forProviderOrder(providerOrderId);
    if (!account) throw new Error('no shop account for this YouPI payment');
    const view = await this.client.getPayment(account, providerOrderId);
    let state = mapYoupiStatus(view.status, view.method);
    if (state === 'PAID' && view.currency !== 'INR') state = 'PENDING';
    return {
      state,
      // The status view carries no UTR; the YouPI session id is the stable fallback reference.
      providerPaymentId: state === 'PAID' ? `youpi-${view.paymentId}` : null,
      amountPaise: view.amountPaise,
    };
  }

  /** MANUAL: nothing moves here. Deterministic id per idempotency key → idempotent. */
  async refund(input: RefundInput): Promise<RefundResult> {
    assertProviderPaise(input.amountPaise, 'amountPaise');
    return { providerRefundId: `manual:${input.idempotencyKey}`, status: 'PENDING' };
  }
}
