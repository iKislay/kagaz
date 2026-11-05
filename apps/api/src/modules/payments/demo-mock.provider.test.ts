import { describe, expect, it } from 'vitest';
import { DEMO_SIGNATURE_HEADER, DemoMockProvider } from './demo-mock.provider.js';
import { WebhookSignatureError } from './payment-provider.js';

const provider = new DemoMockProvider('demo-secret');

describe('DemoMockProvider', () => {
  it('is labelled simulated and auto-approves with DEMO references', async () => {
    expect(provider.simulated).toBe(true);
    const session = await provider.createPayment({
      orderId: 'o1',
      publicRef: 'KGZ-ABC234',
      amountPaise: 4800,
      currency: 'INR',
    });
    expect(session).toEqual({
      providerOrderId: 'DEMO-ORD-KGZ-ABC234',
      checkout: { kind: 'DEMO_AUTO_APPROVE' },
    });
    expect(await provider.fetchPaymentStatus(session.providerOrderId)).toEqual({
      state: 'PAID',
      providerPaymentId: 'DEMO-PAY-KGZ-ABC234',
      amountPaise: 4800,
    });
  });

  it('verifies webhook signatures over the exact raw body', async () => {
    const body = Buffer.from(
      JSON.stringify({ eventId: 'evt_1', providerOrderId: 'DEMO-ORD-X', state: 'PAID' }),
    );
    const event = await provider.verifyWebhook(body, {
      [DEMO_SIGNATURE_HEADER]: provider.sign(body),
    });
    expect(event).toMatchObject({ eventId: 'evt_1', state: 'PAID' });

    const tampered = Buffer.from(body.toString().replace('PAID', 'FAILED'));
    await expect(
      provider.verifyWebhook(tampered, { [DEMO_SIGNATURE_HEADER]: provider.sign(body) }),
    ).rejects.toBeInstanceOf(WebhookSignatureError);
    await expect(provider.verifyWebhook(body, {})).rejects.toBeInstanceOf(WebhookSignatureError);
  });

  it('simulates refunds without moving money', async () => {
    expect(
      await provider.refund({
        providerPaymentId: 'DEMO-PAY-KGZ-ABC234',
        amountPaise: 4800,
        idempotencyKey: 'k',
      }),
    ).toEqual({ providerRefundId: 'DEMO-RFD-KGZ-ABC234', state: 'SUCCEEDED' });
  });
});
