import { HttpStatus } from '@nestjs/common';
import { AppError } from '../../common/http/api-exception.filter.js';
import {
  type PaymentProvider,
  type PaymentSession,
  type ProviderPaymentStatus,
  type RefundResult,
  type VerifiedPaymentEvent,
  WebhookSignatureError,
} from './payment-provider.js';

export function onlinePaymentsUnavailable(): AppError {
  return new AppError(
    'ONLINE_PAYMENT_UNAVAILABLE',
    'Online payment is not available yet. Please choose “Pay at counter”.',
    HttpStatus.CONFLICT,
  );
}

/**
 * PAYMENT_PROVIDER=none (ADR-003): no online gateway is configured; customers pay at the counter.
 * Every gateway operation is refused. PaymentsService checks `isOnlinePaymentDisabled` BEFORE
 * creating a payment row, so this never leaves a half-open payment behind. Webhooks are rejected
 * like any unsigned request.
 */
export class DisabledPaymentProvider implements PaymentProvider {
  readonly name = 'none';
  readonly simulated = false;

  createPayment(): Promise<PaymentSession> {
    return Promise.reject(onlinePaymentsUnavailable());
  }

  verifyWebhook(): Promise<VerifiedPaymentEvent> {
    return Promise.reject(new WebhookSignatureError('No online payment provider is configured'));
  }

  fetchPaymentStatus(): Promise<ProviderPaymentStatus> {
    return Promise.reject(onlinePaymentsUnavailable());
  }

  refund(): Promise<RefundResult> {
    return Promise.reject(onlinePaymentsUnavailable());
  }
}

export function isOnlinePaymentDisabled(provider: PaymentProvider): boolean {
  return provider instanceof DisabledPaymentProvider;
}
