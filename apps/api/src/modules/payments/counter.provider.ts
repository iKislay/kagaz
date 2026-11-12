import { COUNTER_PAYMENT_PROVIDER } from '@kagaz/shared';
import {
  type CreatePaymentInput,
  type PaymentProvider,
  type PaymentSession,
  type ProviderPaymentStatus,
  type RefundInput,
  type RefundResult,
  type VerifiedPaymentEvent,
  WebhookSignatureError,
  assertProviderPaise,
} from './payment-provider.js';

/**
 * Pay at the counter (ADR-003): no gateway. Placing the order confirms it right away (pickup code,
 * shop queue) and the shop collects the amount in person at pickup. Orders paid this way always
 * wait for the shop's manual approval (approval.service) — nothing prints unseen.
 *
 * Not simulated: it never claims money moved online, so no DEMO labels; the UI says "pay at the
 * counter" instead. There are no webhooks, and a refund means nothing was collected online.
 */
export class CounterPaymentProvider implements PaymentProvider {
  readonly name = COUNTER_PAYMENT_PROVIDER;
  readonly simulated = false;

  createPayment(input: CreatePaymentInput): Promise<PaymentSession> {
    return Promise.resolve().then(() => {
      assertProviderPaise(input.amountPaise, 'amountPaise');
      return { providerOrderId: `counter_${input.receipt}`, checkout: { kind: 'PAY_AT_COUNTER' } };
    });
  }

  verifyWebhook(): Promise<VerifiedPaymentEvent> {
    return Promise.reject(new WebhookSignatureError('Pay-at-counter has no webhooks'));
  }

  /** The order is confirmed as soon as it is placed; the amount is settled at the counter. */
  fetchPaymentStatus(providerOrderId: string): Promise<ProviderPaymentStatus> {
    return Promise.resolve({
      state: 'PAID',
      providerPaymentId: providerOrderId,
      amountPaise: null,
    });
  }

  refund(input: RefundInput): Promise<RefundResult> {
    return Promise.resolve().then(() => {
      assertProviderPaise(input.amountPaise, 'amountPaise');
      return { providerRefundId: `counter_refund_${input.idempotencyKey}`, status: 'SUCCEEDED' };
    });
  }
}
