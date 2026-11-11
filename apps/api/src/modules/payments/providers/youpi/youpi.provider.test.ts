import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { describePaymentProviderContract } from '../../payment-provider.contract.js';
import { PaymentProviderUnavailableError, WebhookSignatureError } from '../../payment-provider.js';
import { FakeYoupi } from './fake-youpi.js';
import {
  YoupiClient,
  YoupiError,
  paiseToRupeeString,
  parsePaise,
  parseYoupiTime,
} from './youpi-client.js';
import { type YoupiAccount, YoupiProvider, mapYoupiStatus } from './youpi.provider.js';

function setup() {
  const fake = new FakeYoupi();
  const client = new YoupiClient({
    baseUrl: 'https://youpi.test',
    adminToken: fake.adminToken,
    timeoutMs: 1000,
    fetch: fake.fetch,
  });
  const shopId = randomUUID();
  const merchant = fake.addMerchant();
  const account: YoupiAccount = {
    merchantId: merchant.id,
    apiKey: merchant.apiKey,
    webhookSecret: merchant.webhookSecret,
  };
  // Two shops, each with its own merchant: the resolver maps payment → owning shop.
  const other = fake.addMerchant();
  const otherShopId = randomUUID();
  const resolver = {
    forShop: async (id: string): Promise<YoupiAccount> => {
      if (id === shopId) return account;
      if (id === otherShopId) {
        return { merchantId: other.id, apiKey: other.apiKey, webhookSecret: other.webhookSecret };
      }
      throw new Error('PAYMENT_SETUP_REQUIRED');
    },
    forProviderOrder: async (paymentId: string): Promise<YoupiAccount | null> => {
      const s = fake.sessions.get(paymentId);
      if (!s) return null;
      const m = fake.merchants.get(s.merchantId)!;
      return { merchantId: m.id, apiKey: m.apiKey, webhookSecret: m.webhookSecret };
    },
  };
  const provider = new YoupiProvider(client, resolver);
  return { fake, client, provider, shopId, otherShopId, merchant, other };
}

describePaymentProviderContract('YoupiProvider (ADR-003)', () => {
  const { fake, provider, shopId } = setup();
  return {
    provider,
    shopId,
    settle: async (paymentId, state) =>
      fake.settle(paymentId, state === 'PAID' ? 'OBSERVED_SUCCESS' : 'FAILED', '412345678901'),
    signedPaymentWebhook: ({ eventId, providerOrderId, status, amountPaise }) => {
      const event =
        status === 'PAID' ? 'OBSERVED_SUCCESS' : status === 'FAILED' ? 'FAILED' : 'PROCESSING';
      return fake.webhookFor(providerOrderId, { event, amountPaise, deliveryId: eventId });
    },
  };
});

const create = async (s: ReturnType<typeof setup>, amountPaise = 2400, shopId = s.shopId) =>
  s.provider.createPayment({
    orderId: randomUUID(),
    shopId,
    returnUrl: 'https://kagaz.test/order/1',
    publicRef: 'KGZ-ABC123',
    receipt: `KGZ-${randomUUID().slice(0, 6)}`,
    amountPaise,
    currency: 'INR',
  });

describe('YoupiProvider specifics', () => {
  it("creates the session under the SHOP's merchant with its key, exact rupees and the return URL", async () => {
    const s = setup();
    const session = await create(s, 4805);
    expect(session.checkout).toEqual({
      kind: 'UPI_CHECKOUT',
      checkoutUrl: `https://pay.youpi.test/checkout/${session.providerOrderId}`,
    });
    const call = s.fake.calls.find((c) => c.path === '/api/v1/payments')!;
    expect(call.headers['x-merchant-id']).toBe(s.merchant.id);
    expect(call.headers['x-merchant-key']).toBe(s.merchant.apiKey);
    expect(s.fake.sessions.get(session.providerOrderId)!.amountPaise).toBe(4805);
  });

  it('maps statuses conservatively', () => {
    expect(mapYoupiStatus('OBSERVED_SUCCESS', 'UPI')).toBe('PAID');
    expect(mapYoupiStatus('RECONCILED', 'UPI')).toBe('PAID');
    // COD/counter "SUCCESS" is not money received.
    expect(mapYoupiStatus('SUCCESS', 'COD')).toBe('PENDING');
    expect(mapYoupiStatus('OBSERVED_SUCCESS', 'COD')).toBe('PENDING');
    expect(mapYoupiStatus('MANUAL_REVIEW', 'UPI')).toBe('PENDING');
    for (const s of ['FAILED', 'EXPIRED', 'CANCELLED'])
      expect(mapYoupiStatus(s, 'UPI')).toBe('FAILED');
    for (const s of ['INITIATED', 'QUEUED', 'ACTIVE', 'PROCESSING', 'whatever']) {
      expect(mapYoupiStatus(s, 'UPI')).toBe('PENDING');
    }
  });

  it('uses the UTR from the webhook as the payment reference', async () => {
    const s = setup();
    const { providerOrderId } = await create(s);
    s.fake.settle(providerOrderId, 'OBSERVED_SUCCESS', '412345678901');
    const { rawBody, headers } = s.fake.webhookFor(providerOrderId);
    const event = await s.provider.verifyWebhook(rawBody, headers);
    expect(event).toMatchObject({
      type: 'PAYMENT',
      status: 'PAID',
      providerPaymentId: '412345678901',
      amountPaise: 2400,
    });
  });

  it("rejects a webhook signed with ANOTHER shop's secret", async () => {
    const s = setup();
    const { providerOrderId } = await create(s);
    const { rawBody, headers } = s.fake.webhookFor(providerOrderId, {
      event: 'OBSERVED_SUCCESS',
      secret: s.other.webhookSecret,
    });
    await expect(s.provider.verifyWebhook(rawBody, headers)).rejects.toBeInstanceOf(
      WebhookSignatureError,
    );
  });

  it('rejects the V1 signature alone, stale or future timestamps and delivery-id mismatches', async () => {
    const s = setup();
    const { providerOrderId } = await create(s);
    const ok = s.fake.webhookFor(providerOrderId, { event: 'OBSERVED_SUCCESS' });
    const v1Only = { ...ok.headers };
    delete v1Only['x-gateway-signature-v2'];
    await expect(s.provider.verifyWebhook(ok.rawBody, v1Only)).rejects.toBeInstanceOf(
      WebhookSignatureError,
    );

    const stale = s.fake.webhookFor(providerOrderId, { timestamp: Date.now() - 3 * 3600_000 });
    await expect(s.provider.verifyWebhook(stale.rawBody, stale.headers)).rejects.toBeInstanceOf(
      WebhookSignatureError,
    );
    const future = s.fake.webhookFor(providerOrderId, { timestamp: Date.now() + 3600_000 });
    await expect(s.provider.verifyWebhook(future.rawBody, future.headers)).rejects.toBeInstanceOf(
      WebhookSignatureError,
    );

    const swapped = { ...ok.headers, 'x-gateway-delivery-id': randomUUID() };
    await expect(s.provider.verifyWebhook(ok.rawBody, swapped)).rejects.toBeInstanceOf(
      WebhookSignatureError,
    );
  });

  it("accepts a retry within YouPI's 1 h retry window", async () => {
    const s = setup();
    const { providerOrderId } = await create(s);
    const retry = s.fake.webhookFor(providerOrderId, {
      event: 'OBSERVED_SUCCESS',
      timestamp: Date.now() - 65 * 60_000,
    });
    await expect(s.provider.verifyWebhook(retry.rawBody, retry.headers)).resolves.toMatchObject({
      status: 'PAID',
    });
  });

  it('rejects webhooks for unknown payments and non-JSON bodies', async () => {
    const s = setup();
    const { providerOrderId } = await create(s);
    const w = s.fake.webhookFor(providerOrderId);
    s.fake.sessions.delete(providerOrderId);
    await expect(s.provider.verifyWebhook(w.rawBody, w.headers)).rejects.toBeInstanceOf(
      WebhookSignatureError,
    );
    await expect(s.provider.verifyWebhook(Buffer.from('nope'), w.headers)).rejects.toBeInstanceOf(
      WebhookSignatureError,
    );
  });

  it('never reports PAID for a non-INR or non-UPI success', async () => {
    const s = setup();
    const { providerOrderId } = await create(s);
    const usd = s.fake.webhookFor(providerOrderId, { event: 'OBSERVED_SUCCESS', currency: 'USD' });
    expect(await s.provider.verifyWebhook(usd.rawBody, usd.headers)).toMatchObject({
      status: 'PENDING',
    });
    const cod = s.fake.webhookFor(providerOrderId, { event: 'SUCCESS', method: 'COD' });
    expect(await s.provider.verifyWebhook(cod.rawBody, cod.headers)).toMatchObject({
      status: 'PENDING',
    });
  });

  it('refuses to start a checkout while the shop phone is offline (YouPI OBSERVERS_UNHEALTHY)', async () => {
    const s = setup();
    s.fake.observersHealthy = false;
    const err = await create(s).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PaymentProviderUnavailableError);
    expect(err).toMatchObject({ reason: 'RECEIVER_OFFLINE', retryAfterSeconds: 60 });
    s.fake.observersHealthy = true;
    s.fake.down = true;
    await expect(create(s)).rejects.toMatchObject({ reason: 'UNAVAILABLE' });
  });

  it('refuses to start a checkout for a shop without payment setup', async () => {
    const s = setup();
    await expect(create(s, 2400, randomUUID())).rejects.toThrow('PAYMENT_SETUP_REQUIRED');
  });

  it('refunds are manual placeholders', async () => {
    const s = setup();
    expect(s.provider.refundMode).toBe('MANUAL');
    await expect(
      s.provider.refund({ providerPaymentId: 'x', amountPaise: 100, idempotencyKey: 'refund:p:1' }),
    ).resolves.toEqual({ providerRefundId: 'manual:refund:p:1', status: 'PENDING' });
  });
});

describe('YoupiClient', () => {
  it('formats and parses paise exactly', () => {
    expect(paiseToRupeeString(1)).toBe('0.01');
    expect(paiseToRupeeString(4800)).toBe('48.00');
    expect(paiseToRupeeString(123456)).toBe('1234.56');
    expect(parsePaise('4800')).toBe(4800);
    expect(parsePaise(4800)).toBe(4800);
    expect(parsePaise('48.00')).toBeNull();
    expect(parsePaise(48.5)).toBeNull();
  });

  it('reads YouPI SQLite times as UTC, not local time', () => {
    expect(parseYoupiTime('2026-11-11 12:54:22')).toBe('2026-11-11T12:54:22.000Z');
    expect(parseYoupiTime('2026-11-11T12:54:22.192Z')).toBe('2026-11-11T12:54:22.192Z');
    expect(parseYoupiTime('2026-11-11T18:24:22+05:30')).toBe('2026-11-11T12:54:22.000Z');
    expect(parseYoupiTime('soon')).toBeNull();
    expect(parseYoupiTime(null)).toBeNull();
  });

  it('maps network failures and HTTP errors to YoupiError', async () => {
    const s = setup();
    s.fake.down = true;
    await expect(s.client.devices(s.merchant.id)).rejects.toMatchObject({
      name: 'YoupiError',
      code: 'UNREACHABLE',
    });
    s.fake.down = false;
    const bad = new YoupiClient({
      baseUrl: 'https://youpi.test',
      adminToken: 'wrong',
      timeoutMs: 1000,
      fetch: s.fake.fetch,
    });
    await expect(bad.devices(s.merchant.id)).rejects.toBeInstanceOf(YoupiError);
  });

  it('refuses rows that belong to another merchant (YouPI default-merchant fallback)', async () => {
    const fallback = async () =>
      new Response(
        JSON.stringify({
          accounts: [{ id: 'a', merchantId: 'default', upiId: 'x@y', isActive: true }],
        }),
        { status: 200 },
      );
    const c = new YoupiClient({
      baseUrl: 'https://youpi.test',
      adminToken: 't',
      timeoutMs: 1000,
      fetch: fallback,
    });
    await expect(c.listUpiAccounts('mine')).rejects.toMatchObject({ code: 'MERCHANT_MISMATCH' });
  });

  it('provisions a merchant, adds and activates a VPA, and pairs a phone', async () => {
    const s = setup();
    const { merchantId } = await s.client.createMerchant({
      businessName: 'Sri Ganesh Xerox',
      slug: 'kagaz-shop-1',
      webhookUrl: 'https://kagaz.test/api/webhooks/youpi',
      upiId: 'ganesh@okicici',
      apiKey: 'yp_live_x',
      webhookSecret: 'secret',
    });
    const added = await s.client.addUpiAccount(merchantId, 'ganesh2@ybl', 'Sri Ganesh Xerox');
    await s.client.activateUpiAccount(added.id);
    const accounts = await s.client.listUpiAccounts(merchantId);
    expect(accounts.find((a) => a.isActive)?.upiId).toBe('ganesh2@ybl');
    const pairing = await s.client.pairingPayload(merchantId);
    expect(JSON.parse(pairing.qrText).merchantId).toBe(merchantId);
  });
});
