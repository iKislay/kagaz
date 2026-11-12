import { describe, expect, it } from 'vitest';
import { CounterPaymentProvider } from './counter.provider.js';
import { WebhookSignatureError } from './payment-provider.js';

describe('CounterPaymentProvider (ADR-003)', () => {
  const provider = new CounterPaymentProvider();
  const input = {
    orderId: 'o1',
    publicRef: 'KGZ-1',
    receipt: 'KGZ-1',
    amountPaise: 4000,
    currency: 'INR' as const,
  };

  it('is not simulated and confirms the order at once, to be paid at the counter', async () => {
    expect(provider.simulated).toBe(false);
    const session = await provider.createPayment(input);
    expect(session.checkout).toEqual({ kind: 'PAY_AT_COUNTER' });
    const status = await provider.fetchPaymentStatus(session.providerOrderId);
    expect(status.state).toBe('PAID');
  });

  it('rejects non-integer paise and every webhook', async () => {
    await expect(provider.createPayment({ ...input, amountPaise: 40.5 })).rejects.toThrow();
    await expect(provider.verifyWebhook()).rejects.toBeInstanceOf(WebhookSignatureError);
  });
});
