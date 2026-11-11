import { afterEach, describe, expect, it, vi } from 'vitest';
import { DemoPaymentOutcome } from '@kagaz/shared';
import { DEMO_SIGNATURE_HEADER, DemoMockProvider } from './demo-mock.provider.js';
import { describePaymentProviderContract } from './payment-provider.contract.js';
import { type VerifiedPaymentEvent } from './payment-provider.js';

describePaymentProviderContract('DemoMockProvider', () => {
  const provider = new DemoMockProvider({ webhookSecret: 'contract-secret' });
  return {
    provider,
    settle: async (providerOrderId, state) => provider.settle(providerOrderId, state),
    signedPaymentWebhook: (e) => provider.buildWebhook({ type: 'PAYMENT', ...e }),
  };
});

const input = (orderId: string, receipt: string) => ({
  orderId,
  shopId: 'shop-1',
  returnUrl: 'https://kagaz.test/order/1',
  publicRef: receipt,
  receipt,
  amountPaise: 4800,
  currency: 'INR' as const,
});

describe('DemoMockProvider', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is labelled simulated and approves with DEMO references (FR-PAY-02)', async () => {
    const provider = new DemoMockProvider({ webhookSecret: 'demo-secret' });
    expect(provider.simulated).toBe(true);
    const session = await provider.createPayment(input('o1', 'KGZ-ABC234'));
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
    const provider = new DemoMockProvider({ webhookSecret: 'demo-secret' });
    const body = Buffer.from(
      JSON.stringify({
        type: 'PAYMENT',
        eventId: 'evt_1',
        providerOrderId: 'DEMO-ORD-X',
        status: 'PAID',
      }),
    );
    const event = await provider.verifyWebhook(body, {
      [DEMO_SIGNATURE_HEADER]: provider.sign(body),
    });
    expect(event).toMatchObject({ eventId: 'evt_1', status: 'PAID', type: 'PAYMENT' });
    const other = new DemoMockProvider({ webhookSecret: 'another-secret' });
    await expect(
      provider.verifyWebhook(body, { [DEMO_SIGNATURE_HEADER]: other.sign(body) }),
    ).rejects.toThrow('Invalid demo webhook signature');
  });

  it('outcome modes are one-shot per order: FAIL then a retry succeeds', async () => {
    const provider = new DemoMockProvider({ webhookSecret: 's' });
    provider.setOutcome('o2', DemoPaymentOutcome.FAIL);
    const failed = await provider.createPayment(input('o2', 'KGZ-FAIL22'));
    expect((await provider.fetchPaymentStatus(failed.providerOrderId)).state).toBe('FAILED');
    const retry = await provider.createPayment(input('o2', 'KGZ-FAIL22-2'));
    expect((await provider.fetchPaymentStatus(retry.providerOrderId)).state).toBe('PAID');
  });

  it('PENDING resolves to PAID after the configured delay and emits a webhook', async () => {
    vi.useFakeTimers();
    const provider = new DemoMockProvider({ webhookSecret: 's', pendingResolveMs: 5000 });
    const received: VerifiedPaymentEvent[] = [];
    provider.attachWebhookSink(async (raw, headers) => {
      received.push(await provider.verifyWebhook(raw, headers));
    });
    provider.setOutcome('o3', DemoPaymentOutcome.PENDING);
    const s = await provider.createPayment(input('o3', 'KGZ-PEND33'));
    expect((await provider.fetchPaymentStatus(s.providerOrderId)).state).toBe('PENDING');
    await vi.advanceTimersByTimeAsync(5001);
    expect((await provider.fetchPaymentStatus(s.providerOrderId)).state).toBe('PAID');
    expect(received.map((e) => e.status)).toEqual(['PAID']);
  });

  it('DUPLICATE_WEBHOOK sends the same event twice; OUT_OF_ORDER sends a stale PENDING last', async () => {
    vi.useFakeTimers();
    const provider = new DemoMockProvider({ webhookSecret: 's', webhookDelayMs: 10 });
    const received: VerifiedPaymentEvent[] = [];
    provider.attachWebhookSink(async (raw, headers) => {
      received.push(await provider.verifyWebhook(raw, headers));
    });
    provider.setOutcome('o4', DemoPaymentOutcome.DUPLICATE_WEBHOOK);
    await provider.createPayment(input('o4', 'KGZ-DUPE44'));
    await vi.advanceTimersByTimeAsync(20);
    expect(received).toHaveLength(2);
    expect(received[0]!.eventId).toBe(received[1]!.eventId);

    received.length = 0;
    provider.setOutcome('o5', DemoPaymentOutcome.OUT_OF_ORDER);
    await provider.createPayment(input('o5', 'KGZ-OOO555'));
    await vi.advanceTimersByTimeAsync(20);
    expect(received.map((e) => e.status)).toEqual(['PAID', 'PENDING']);
    expect(received[1]!.occurredAt.getTime()).toBeLessThanOrEqual(
      received[0]!.occurredAt.getTime(),
    );
  });

  it('simulates refunds without moving money', async () => {
    const provider = new DemoMockProvider({ webhookSecret: 's' });
    await provider.createPayment(input('o6', 'KGZ-RFND66'));
    const r = await provider.refund({
      providerPaymentId: 'DEMO-PAY-KGZ-RFND66',
      amountPaise: 4800,
      idempotencyKey: 'refund:p:1',
    });
    expect(r).toEqual({ providerRefundId: 'DEMO-RFD-KGZ-RFND66', status: 'SUCCEEDED' });
  });
});
