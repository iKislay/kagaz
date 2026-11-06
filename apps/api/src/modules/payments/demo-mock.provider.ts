import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  type CreatePaymentInput,
  type PaymentProvider,
  type PaymentSession,
  type ProviderPaymentStatus,
  type RefundInput,
  type RefundResult,
  type VerifiedPaymentEvent,
  WebhookSignatureError,
} from './payment-provider.js';

export const DEMO_SIGNATURE_HEADER = 'x-demo-signature';

/**
 * DEMO ONLY (FR-PAY-02): auto-approves every payment without moving money.
 * - references look like DEMO-ORD-<ref> / DEMO-PAY-<ref> / DEMO-RFD-<ref>
 * - no UPI intent, card fields, QR code or real charge is ever created
 * - the API refuses to start with this provider when APP_ENV=production (FR-PAY-03)
 * Failure/pending/duplicate-webhook simulation modes arrive in P3.5.
 */
export class DemoMockProvider implements PaymentProvider {
  readonly name = 'demo';
  readonly simulated = true;

  /** Amounts of payments created by this process (best effort; demo only). */
  private readonly amounts = new Map<string, number>();

  constructor(private readonly webhookSecret: string) {}

  async createPayment(input: CreatePaymentInput): Promise<PaymentSession> {
    const providerOrderId = `DEMO-ORD-${input.publicRef}`;
    this.amounts.set(providerOrderId, input.amountPaise);
    return { providerOrderId, checkout: { kind: 'DEMO_AUTO_APPROVE' } };
  }

  async fetchPaymentStatus(providerOrderId: string): Promise<ProviderPaymentStatus> {
    return {
      state: 'PAID',
      providerPaymentId: providerOrderId.replace(/^DEMO-ORD-/, 'DEMO-PAY-'),
      amountPaise: this.amounts.get(providerOrderId) ?? null,
    };
  }

  async verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string>,
  ): Promise<VerifiedPaymentEvent> {
    const given = headers[DEMO_SIGNATURE_HEADER] ?? '';
    const expected = this.sign(rawBody);
    const a = Buffer.from(given, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new WebhookSignatureError('Invalid demo webhook signature');
    }
    const body = JSON.parse(rawBody.toString('utf8')) as {
      eventId: string;
      providerOrderId: string;
      providerPaymentId?: string | null;
      state: 'PENDING' | 'PAID' | 'FAILED';
      amountPaise?: number | null;
      occurredAt?: string;
    };
    return {
      eventId: body.eventId,
      providerOrderId: body.providerOrderId,
      providerPaymentId: body.providerPaymentId ?? null,
      state: body.state,
      amountPaise: body.amountPaise ?? null,
      occurredAt: body.occurredAt ? new Date(body.occurredAt) : new Date(),
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    return {
      providerRefundId: `${input.providerPaymentId.replace(/^DEMO-PAY-/, 'DEMO-RFD-')}`,
      state: 'SUCCEEDED',
    };
  }

  /** Signs a webhook body exactly as the demo "gateway" would (used by demo controls/tests). */
  sign(rawBody: Buffer | string): string {
    return createHmac('sha256', this.webhookSecret).update(rawBody).digest('hex');
  }
}
