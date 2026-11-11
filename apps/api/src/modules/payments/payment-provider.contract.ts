import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  PROVIDER_PAYMENT_STATES,
  type PaymentProvider,
  type ProviderPaymentState,
  WebhookSignatureError,
} from './payment-provider.js';

/**
 * What an adapter's test file supplies so the shared contract can drive it. For a live
 * gateway these hooks talk to the provider's sandbox (P3.9); for the demo they use the
 * simulated gateway's controls.
 */
export interface PaymentProviderContractHarness {
  provider: PaymentProvider;
  /** Shop the harness has an account for (providers with per-shop accounts). */
  shopId?: string;
  /** Move a created payment to a final state on the provider side (sandbox / simulation). */
  settle(providerOrderId: string, state: Exclude<ProviderPaymentState, 'PENDING'>): Promise<void>;
  /** A correctly signed PAYMENT webhook for a payment, exactly as the provider would send it. */
  signedPaymentWebhook(input: {
    eventId: string;
    providerOrderId: string;
    providerPaymentId: string | null;
    status: ProviderPaymentState;
    amountPaise: number;
  }): { rawBody: Buffer; headers: Record<string, string> };
}

const receipt = () => `KGZ-${randomUUID().slice(0, 8).toUpperCase()}`;

/**
 * Reusable contract suite (P3.1): every PaymentProvider adapter must pass it.
 * Covers amounts in integer paise, signature rejection, status mapping and idempotent refunds.
 */
export function describePaymentProviderContract(
  name: string,
  factory: () => PaymentProviderContractHarness | Promise<PaymentProviderContractHarness>,
): void {
  describe(`PaymentProvider contract: ${name}`, () => {
    const create = async (h: PaymentProviderContractHarness, amountPaise = 4800) => {
      const r = receipt();
      const session = await h.provider.createPayment({
        orderId: randomUUID(),
        shopId: h.shopId ?? randomUUID(),
        returnUrl: 'https://kagaz.test/order/x',
        publicRef: r,
        receipt: r,
        amountPaise,
        currency: 'INR',
      });
      return session;
    };

    it('has a stable name and declares whether it moves money', async () => {
      const h = await factory();
      expect(h.provider.name).toMatch(/^[a-z0-9-]+$/);
      expect(typeof h.provider.simulated).toBe('boolean');
    });

    it('creates a payment session with a provider order id', async () => {
      const h = await factory();
      const a = await create(h);
      const b = await create(h);
      expect(a.providerOrderId).toBeTruthy();
      expect(a.providerOrderId).not.toBe(b.providerOrderId);
      expect(['DEMO_AUTO_APPROVE', 'UPI_CHECKOUT', 'PROVIDER_CHECKOUT']).toContain(a.checkout.kind);
      expect(['API', 'MANUAL']).toContain(h.provider.refundMode);
    });

    it('accepts only positive integer paise', async () => {
      const h = await factory();
      for (const bad of [0, -100, 10.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2]) {
        await expect(create(h, bad)).rejects.toThrow();
      }
    });

    it('maps provider status to PENDING | PAID | FAILED with integer amounts', async () => {
      const h = await factory();
      const paid = await create(h, 2400);
      await h.settle(paid.providerOrderId, 'PAID');
      const status = await h.provider.fetchPaymentStatus(paid.providerOrderId);
      expect(PROVIDER_PAYMENT_STATES).toContain(status.state);
      expect(status.state).toBe('PAID');
      expect(status.providerPaymentId).toBeTruthy();
      if (status.amountPaise !== null) expect(status.amountPaise).toBe(2400);

      const failed = await create(h, 2400);
      await h.settle(failed.providerOrderId, 'FAILED');
      expect((await h.provider.fetchPaymentStatus(failed.providerOrderId)).state).toBe('FAILED');
    });

    it('verifies a correctly signed webhook and maps its fields', async () => {
      const h = await factory();
      const s = await create(h, 1500);
      const { rawBody, headers } = h.signedPaymentWebhook({
        eventId: `evt-${randomUUID()}`,
        providerOrderId: s.providerOrderId,
        providerPaymentId: 'pay-1',
        status: 'PAID',
        amountPaise: 1500,
      });
      const event = await h.provider.verifyWebhook(rawBody, headers);
      expect(event.type).toBe('PAYMENT');
      if (event.type !== 'PAYMENT') return;
      expect(event.providerOrderId).toBe(s.providerOrderId);
      expect(event.status).toBe('PAID');
      expect(event.amountPaise).toBe(1500);
      expect(Number.isInteger(event.amountPaise)).toBe(true);
      expect(event.eventId).toBeTruthy();
      expect(event.occurredAt).toBeInstanceOf(Date);
    });

    it('rejects tampered, re-signed-elsewhere and unsigned webhooks', async () => {
      const h = await factory();
      const s = await create(h);
      const { rawBody, headers } = h.signedPaymentWebhook({
        eventId: `evt-${randomUUID()}`,
        providerOrderId: s.providerOrderId,
        providerPaymentId: null,
        status: 'FAILED',
        amountPaise: 4800,
      });
      const tampered = Buffer.from(rawBody.toString('utf8').replace('FAILED', 'PAID'));
      await expect(h.provider.verifyWebhook(tampered, headers)).rejects.toBeInstanceOf(
        WebhookSignatureError,
      );
      // Whitespace changes the bytes: the signature is over the exact raw body.
      const reformatted = Buffer.from(JSON.stringify(JSON.parse(rawBody.toString()), null, 2));
      await expect(h.provider.verifyWebhook(reformatted, headers)).rejects.toBeInstanceOf(
        WebhookSignatureError,
      );
      await expect(h.provider.verifyWebhook(rawBody, {})).rejects.toBeInstanceOf(
        WebhookSignatureError,
      );
    });

    it('refunds are idempotent per idempotency key and never exceed the payment', async () => {
      const h = await factory();
      const s = await create(h, 3000);
      await h.settle(s.providerOrderId, 'PAID');
      const { providerPaymentId } = await h.provider.fetchPaymentStatus(s.providerOrderId);
      const key = `refund:${randomUUID()}:1`;
      const first = await h.provider.refund({
        providerPaymentId: providerPaymentId!,
        amountPaise: 3000,
        idempotencyKey: key,
      });
      const again = await h.provider.refund({
        providerPaymentId: providerPaymentId!,
        amountPaise: 3000,
        idempotencyKey: key,
      });
      expect(again.providerRefundId).toBe(first.providerRefundId);
      expect(['PENDING', 'SUCCEEDED', 'FAILED']).toContain(first.status);
      if (h.provider.refundMode === 'MANUAL') {
        // Manual refunds: the provider moves nothing; RefundsService caps the amount.
        expect(first.status).toBe('PENDING');
        await expect(
          h.provider.refund({
            providerPaymentId: providerPaymentId!,
            amountPaise: 12.5,
            idempotencyKey: `refund:${randomUUID()}:3`,
          }),
        ).rejects.toThrow();
        return;
      }

      await expect(
        h.provider.refund({
          providerPaymentId: providerPaymentId!,
          amountPaise: 1,
          idempotencyKey: `refund:${randomUUID()}:2`,
        }),
      ).rejects.toThrow();
      await expect(
        h.provider.refund({
          providerPaymentId: providerPaymentId!,
          amountPaise: 12.5,
          idempotencyKey: `refund:${randomUUID()}:3`,
        }),
      ).rejects.toThrow();
    });
  });
}
