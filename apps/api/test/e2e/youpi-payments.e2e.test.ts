/**
 * ADR-003 / Phase 6 — direct-to-shop UPI via YouPI, against real Postgres + S3 with an
 * in-memory YouPI (FakeYoupi). Covers shop setup, checkout, signed webhooks, the customer
 * "I paid" fallback with shop approve/decline, manual refunds and tenant isolation.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type CreateOrderResponse,
  type PayResponse,
  type PublicOrder,
  type ShopPaymentReport,
  type ShopPaymentSetup,
} from '@kagaz/shared';
import { FakeYoupi } from '../../src/modules/payments/providers/youpi/fake-youpi.js';
import { YoupiClient } from '../../src/modules/payments/providers/youpi/youpi-client.js';
import { YOUPI_CLIENT } from '../../src/modules/payments/shop-payment-accounts.service.js';
import { createHarness, type Harness } from './harness.js';
import { type PairedShop, pairedShop, payableOrder, pay, view } from './pay-helpers.js';

const fake = new FakeYoupi();
const YOUPI_ENV = {
  PAYMENT_PROVIDER: 'youpi',
  YOUPI_API_URL: 'https://youpi.test',
  YOUPI_PUBLIC_URL: 'https://pay.youpi.test',
  YOUPI_ADMIN_TOKEN: fake.adminToken,
  PUBLIC_API_URL: 'https://api.kagaz.test/api',
  PAYMENT_SECRETS_KEY: randomBytes(32).toString('base64'),
  PAYMENT_CLAIM_AFTER_SECONDS: '90',
};

let h: Harness;
const saved: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const [k, v] of Object.entries(YOUPI_ENV)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  h = await createHarness((b) =>
    b.overrideProvider(YOUPI_CLIENT).useValue(
      new YoupiClient({
        baseUrl: YOUPI_ENV.YOUPI_API_URL,
        adminToken: fake.adminToken,
        timeoutMs: 2000,
        fetch: fake.fetch,
      }),
    ),
  );
  // Config is read at compile time; restore so later suites keep the demo provider.
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});
afterAll(() => h?.close());

const utr = () => `4${randomBytes(6).readUIntBE(0, 6).toString().padStart(11, '0').slice(0, 11)}`;

async function setUpShop(s: PairedShop, upiId = `shop${randomBytes(3).toString('hex')}@okicici`) {
  const res = await h
    .http()
    .put('/api/shop/payments/setup')
    .set(s.auth)
    .send({ upiId, payeeName: 'Sri Ganesh Xerox' })
    .expect(200);
  return res.body as ShopPaymentSetup;
}

async function merchantOf(shopId: string) {
  const account = await h.prisma.shopPaymentAccount.findUniqueOrThrow({ where: { shopId } });
  return fake.merchants.get(account.externalMerchantId!)!;
}

async function checkout(created: CreateOrderResponse) {
  const res = await pay(h, created).expect(200);
  const body = res.body as PayResponse;
  const payment = await h.prisma.payment.findFirstOrThrow({
    where: { orderId: created.order.id },
    orderBy: { createdAt: 'desc' },
  });
  return { body, payment };
}

function deliver(paymentId: string, over: Parameters<FakeYoupi['webhookFor']>[1] = {}) {
  const { rawBody, headers } = fake.webhookFor(paymentId, over);
  return h.http().post('/api/webhooks/youpi').set(headers).send(rawBody.toString('utf8'));
}

/** Let the automatic check "have its chance" without waiting 90 s. */
async function ageCheckout(orderId: string) {
  await h.prisma.payment.updateMany({
    where: { orderId },
    data: { createdAt: new Date(Date.now() - 5 * 60_000) },
  });
}

function report(created: CreateOrderResponse, value: string) {
  return h
    .http()
    .post(`/api/orders/${created.order.id}/payment-report`)
    .set('x-tracking-token', created.trackingToken)
    .send({ utr: value });
}

describe('P6.4 shop payment setup (UPI ID + phone)', () => {
  it('provisions the YouPI merchant on first save and keeps credentials sealed', async () => {
    const s = await pairedShop(h);
    const before = (await h.http().get('/api/shop/payments/setup').set(s.auth).expect(200))
      .body as ShopPaymentSetup;
    expect(before).toMatchObject({ provider: 'youpi', readiness: 'NEEDS_UPI_ID', upiId: null });
    expect(before.appDownloadUrl).toBe('https://pay.youpi.test/youpi-sms-gateway.apk');

    const after = await setUpShop(s, 'Ganesh.Xerox@OKICICI');
    expect(after).toMatchObject({ readiness: 'NEEDS_PHONE', upiId: 'ganesh.xerox@okicici' });

    const merchant = await merchantOf(s.shop.id);
    expect(merchant.webhookUrl).toBe('https://api.kagaz.test/api/webhooks/youpi');
    expect(merchant.accounts).toMatchObject([{ upiId: 'ganesh.xerox@okicici', isActive: true }]);
    const row = await h.prisma.shopPaymentAccount.findUniqueOrThrow({
      where: { shopId: s.shop.id },
    });
    expect(row.credentialsSealed).not.toContain(merchant.apiKey);
    expect(row.credentialsSealed).not.toContain(merchant.webhookSecret);
    expect(JSON.stringify(after)).not.toContain(merchant.apiKey);

    const audit = await h.prisma.auditLog.findFirst({
      where: { shopId: s.shop.id, action: 'shop.payment_setup_saved' },
    });
    expect(audit?.actorType).toBe('STAFF');
  });

  it('saving again is idempotent; a new UPI ID switches the active VPA on the same merchant', async () => {
    const s = await pairedShop(h);
    await setUpShop(s, 'first@ybl');
    await setUpShop(s, 'first@ybl');
    const merchantCount = fake.merchants.size;
    await setUpShop(s, 'second@ybl');
    expect(fake.merchants.size).toBe(merchantCount);
    const merchant = await merchantOf(s.shop.id);
    expect(merchant.accounts.find((a) => a.isActive)?.upiId).toBe('second@ybl');
  });

  it('readiness follows the paired phone heartbeat; pairing needs step 1 and an operator', async () => {
    const s = await pairedShop(h);
    const noOperator = { Authorization: s.auth.Authorization! };
    await h.http().post('/api/shop/payments/pairing').set(s.auth).expect(409);
    await h
      .http()
      .put('/api/shop/payments/setup')
      .set(noOperator)
      .send({ upiId: 'x@ybl', payeeName: 'X Shop' })
      .expect(401);
    await setUpShop(s);
    const merchant = await merchantOf(s.shop.id);
    const pairing = (await h.http().post('/api/shop/payments/pairing').set(s.auth).expect(200))
      .body;
    expect(JSON.parse(pairing.qrText as string).merchantId).toBe(merchant.id);

    fake.devices.set(merchant.id, [
      {
        id: 'd1',
        deviceName: 'Redmi 12',
        isActive: true,
        lastHeartbeatAt: new Date().toISOString(),
      },
    ]);
    const ready = (await h.http().get('/api/shop/payments/setup').set(s.auth).expect(200))
      .body as ShopPaymentSetup;
    expect(ready.readiness).toBe('READY');
    expect(ready.phones[0]).toMatchObject({ name: 'Redmi 12', online: true });

    fake.devices.set(merchant.id, [
      {
        id: 'd1',
        deviceName: 'Redmi 12',
        isActive: true,
        lastHeartbeatAt: new Date(Date.now() - 3600_000).toISOString(),
      },
    ]);
    const offline = (await h.http().get('/api/shop/payments/setup').set(s.auth).expect(200))
      .body as ShopPaymentSetup;
    expect(offline.readiness).toBe('PHONE_OFFLINE');
  });

  it('maps YouPI being down to a retryable 502 without changing anything', async () => {
    const s = await pairedShop(h);
    fake.down = true;
    try {
      const res = await h
        .http()
        .put('/api/shop/payments/setup')
        .set(s.auth)
        .send({ upiId: 'down@ybl', payeeName: 'Down Shop' });
      expect(res.status).toBe(502);
      expect(res.body.error.code).toBe('PAYMENT_PROVIDER_UNAVAILABLE');
    } finally {
      fake.down = false;
    }
    expect(
      await h.prisma.shopPaymentAccount.findUnique({ where: { shopId: s.shop.id } }),
    ).toBeNull();
  });
});

describe('P6.3 UPI checkout + signed webhooks', () => {
  it('refuses checkout for a shop that has not set up payments', async () => {
    const s = await pairedShop(h);
    const created = await payableOrder(h, s.shop.id);
    const res = await pay(h, created).expect(409);
    expect(res.body.error.code).toBe('SHOP_PAYMENTS_NOT_SET_UP');
  });

  it('returns the hosted UPI checkout for the shop and marks paid on a verified alert', async () => {
    const s = await pairedShop(h);
    await setUpShop(s);
    const merchant = await merchantOf(s.shop.id);
    const created = await payableOrder(h, s.shop.id);
    const { body, payment } = await checkout(created);
    expect(body.mode).toBe('UPI_CHECKOUT');
    expect(body.checkoutUrl).toBe(`https://pay.youpi.test/checkout/${payment.providerOrderId}`);
    expect(body.order.payment).toMatchObject({
      status: 'PENDING',
      isSimulated: false,
      checkoutUrl: body.checkoutUrl,
    });
    const session = fake.sessions.get(payment.providerOrderId!)!;
    expect(session).toMatchObject({ merchantId: merchant.id, amountPaise: payment.amountPaise });

    // A second click reuses the same checkout.
    const again = (await pay(h, created).expect(200)).body as PayResponse;
    expect(again.checkoutUrl).toBe(body.checkoutUrl);

    const ref = utr();
    fake.settle(payment.providerOrderId!, 'OBSERVED_SUCCESS', ref);
    const first = await deliver(payment.providerOrderId!).expect(200);
    expect(first.body).toMatchObject({ duplicate: false, outcome: 'PAID' });

    const order = (await view(h, created).expect(200)).body as PublicOrder;
    expect(['PENDING_REVIEW', 'QUEUED']).toContain(order.status);
    expect(order.pickupNumber).toBeGreaterThan(0);
    expect(order.payment).toMatchObject({ status: 'PAID', reference: ref, checkoutUrl: null });
  });

  it('T06: the same delivery twice yields one transition', async () => {
    const s = await pairedShop(h);
    await setUpShop(s);
    const created = await payableOrder(h, s.shop.id);
    const { payment } = await checkout(created);
    fake.settle(payment.providerOrderId!, 'OBSERVED_SUCCESS', utr());
    const deliveryId = crypto.randomUUID();
    const w = fake.webhookFor(payment.providerOrderId!, { deliveryId });
    for (const expected of [false, true]) {
      const res = await h
        .http()
        .post('/api/webhooks/youpi')
        .set(w.headers)
        .send(w.rawBody.toString())
        .expect(200);
      expect(res.body.duplicate).toBe(expected);
    }
    const events = await h.prisma.orderEvent.count({
      where: { orderId: created.order.id, toStatus: 'PENDING_REVIEW' },
    });
    expect(events).toBe(1);
  });

  it("rejects a webhook signed with another shop's secret and never pays a different amount", async () => {
    const a = await pairedShop(h);
    const b = await pairedShop(h);
    await setUpShop(a);
    await setUpShop(b);
    const created = await payableOrder(h, a.shop.id);
    const { payment } = await checkout(created);
    fake.settle(payment.providerOrderId!, 'OBSERVED_SUCCESS', utr());
    const other = await merchantOf(b.shop.id);
    const forged = await deliver(payment.providerOrderId!, { secret: other.webhookSecret });
    expect(forged.status).toBe(400);
    expect(forged.body.error.code).toBe('WEBHOOK_SIGNATURE_INVALID');

    const wrong = await deliver(payment.providerOrderId!, {
      amountPaise: payment.amountPaise - 100,
    }).expect(200);
    expect(wrong.body.outcome).toBe('AMOUNT_MISMATCH');
    expect((await view(h, created)).body.status).toBe('AWAITING_PAYMENT');
  });

  it('an expired checkout fails the payment; MANUAL_REVIEW keeps it pending', async () => {
    const s = await pairedShop(h);
    await setUpShop(s);
    const review = await payableOrder(h, s.shop.id);
    const r = await checkout(review);
    await deliver(r.payment.providerOrderId!, { event: 'MANUAL_REVIEW' }).expect(200);
    expect((await view(h, review)).body.payment.status).toBe('PENDING');

    const expired = await payableOrder(h, s.shop.id);
    const e = await checkout(expired);
    await deliver(e.payment.providerOrderId!, { event: 'EXPIRED' }).expect(200);
    const order = (await view(h, expired)).body as PublicOrder;
    expect(order.payment?.status).toBe('FAILED');
    // A timed-out checkout can be reported at once (the money may still have moved).
    expect(order.canReportPayment).toBe(true);
  });
});

describe('P6.5 "I paid" fallback — customer reports, shop decides', () => {
  it('opens only after the automatic check had its chance, then blocks pay/cancel until decided', async () => {
    const s = await pairedShop(h);
    await setUpShop(s);
    const created = await payableOrder(h, s.shop.id);
    await checkout(created);

    const early = await report(created, utr()).expect(409);
    expect(early.body.error.code).toBe('PAYMENT_REPORT_TOO_EARLY');
    expect(Date.parse(early.body.error.details.after as string)).toBeGreaterThan(Date.now());
    const before = (await view(h, created)).body as PublicOrder;
    expect(before.canReportPayment).toBe(false);
    expect(before.reportPaymentAfter).toBeTruthy();

    await ageCheckout(created.order.id);
    const ref = utr();
    const opened = (await report(created, ` ${ref.slice(0, 6)} ${ref.slice(6)} `).expect(200))
      .body as PublicOrder;
    expect(opened.paymentReport).toMatchObject({ status: 'OPEN', utr: `••••••••${ref.slice(-4)}` });
    expect(opened.canReportPayment).toBe(false);
    expect(opened.canCancel).toBe(false);

    expect((await pay(h, created).expect(409)).body.error.code).toBe('PAYMENT_REPORT_OPEN');
    expect((await report(created, utr()).expect(409)).body.error.code).toBe('PAYMENT_REPORT_OPEN');
    await h
      .http()
      .post(`/api/orders/${created.order.id}/cancel`)
      .set('x-tracking-token', created.trackingToken)
      .expect(409);

    const list = (await h.http().get('/api/shop/payment-reports').set(s.auth).expect(200)).body
      .reports as ShopPaymentReport[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ orderId: created.order.id, utr: ref, status: 'OPEN' });
  });

  it('approve marks the order paid exactly once, with the operator as actor', async () => {
    const s = await pairedShop(h);
    await setUpShop(s);
    const created = await payableOrder(h, s.shop.id);
    await checkout(created);
    await ageCheckout(created.order.id);
    const ref = utr();
    await report(created, ref).expect(200);
    const [r] = (await h.http().get('/api/shop/payment-reports').set(s.auth)).body
      .reports as ShopPaymentReport[];

    const noOperator = { Authorization: s.auth.Authorization! };
    await h.http().post(`/api/shop/payment-reports/${r!.id}/approve`).set(noOperator).expect(401);

    const approved = (
      await h.http().post(`/api/shop/payment-reports/${r!.id}/approve`).set(s.auth).expect(200)
    ).body as ShopPaymentReport;
    expect(approved.status).toBe('APPROVED');
    const again = await h
      .http()
      .post(`/api/shop/payment-reports/${r!.id}/approve`)
      .set(s.auth)
      .expect(409);
    expect(again.body.error.code).toBe('PAYMENT_REPORT_NOT_OPEN');

    const order = (await view(h, created)).body as PublicOrder;
    expect(['PENDING_REVIEW', 'QUEUED']).toContain(order.status);
    expect(order.pickupNumber).toBeGreaterThan(0);
    expect(order.payment).toMatchObject({ status: 'PAID', reference: ref });

    const paidEvent = await h.prisma.orderEvent.findFirstOrThrow({
      where: { orderId: created.order.id, toStatus: 'PENDING_REVIEW' },
    });
    expect(paidEvent.actorType).toBe('STAFF');
    expect(paidEvent.reason).toContain(ref.slice(-4));
    const audits = await h.prisma.auditLog.findMany({ where: { orderId: created.order.id } });
    expect(audits.map((a) => a.action)).toEqual(
      expect.arrayContaining(['payment.report_opened', 'payment.report_approved']),
    );

    // A late automatic alert for the same payment is a harmless duplicate.
    const payment = await h.prisma.payment.findFirstOrThrow({
      where: { orderId: created.order.id },
    });
    fake.settle(payment.providerOrderId!, 'OBSERVED_SUCCESS', ref);
    const late = await deliver(payment.providerOrderId!).expect(200);
    expect(late.body.outcome).toBe('ALREADY_PAID');
  });

  it('decline tells the customer why and allows another report, up to 3', async () => {
    const s = await pairedShop(h);
    await setUpShop(s);
    const created = await payableOrder(h, s.shop.id);
    await checkout(created);
    await ageCheckout(created.order.id);
    for (let i = 0; i < 3; i++) {
      await report(created, utr()).expect(200);
      const [r] = (await h.http().get('/api/shop/payment-reports').set(s.auth)).body
        .reports as ShopPaymentReport[];
      await h
        .http()
        .post(`/api/shop/payment-reports/${r!.id}/decline`)
        .set(s.auth)
        .send({ reason: 'NOT_RECEIVED' })
        .expect(200);
    }
    const order = (await view(h, created)).body as PublicOrder;
    expect(order.status).toBe('AWAITING_PAYMENT');
    expect(order.paymentReport).toMatchObject({
      status: 'DECLINED',
      declineReason: 'NOT_RECEIVED',
    });
    expect(order.canReportPayment).toBe(false);
    expect((await report(created, utr()).expect(409)).body.error.code).toBe('PAYMENT_REPORT_LIMIT');
  });

  it('a UPI reference cannot back two orders of the same shop', async () => {
    const s = await pairedShop(h);
    await setUpShop(s);
    const ref = utr();
    const one = await payableOrder(h, s.shop.id);
    const two = await payableOrder(h, s.shop.id);
    for (const o of [one, two]) {
      await checkout(o);
      await ageCheckout(o.order.id);
    }
    await report(one, ref).expect(200);
    expect((await report(two, ref).expect(409)).body.error.code).toBe('PAYMENT_REPORT_UTR_USED');
  });

  it('an automatic confirmation supersedes an open report', async () => {
    const s = await pairedShop(h);
    await setUpShop(s);
    const created = await payableOrder(h, s.shop.id);
    const { payment } = await checkout(created);
    await ageCheckout(created.order.id);
    const ref = utr();
    await report(created, ref).expect(200);
    fake.settle(payment.providerOrderId!, 'OBSERVED_SUCCESS', ref);
    await deliver(payment.providerOrderId!).expect(200);
    const row = await h.prisma.paymentReport.findFirstOrThrow({
      where: { orderId: created.order.id },
    });
    expect(row.status).toBe('SUPERSEDED');
    expect((await h.http().get('/api/shop/payment-reports').set(s.auth)).body.reports).toHaveLength(
      0,
    );
  });

  it('tenant isolation: another shop cannot see or decide the report', async () => {
    const a = await pairedShop(h);
    const b = await pairedShop(h);
    await setUpShop(a);
    const created = await payableOrder(h, a.shop.id);
    await checkout(created);
    await ageCheckout(created.order.id);
    await report(created, utr()).expect(200);
    const [r] = (await h.http().get('/api/shop/payment-reports').set(a.auth)).body
      .reports as ShopPaymentReport[];
    expect(
      (await h.http().get('/api/shop/payment-reports?status=ALL').set(b.auth)).body.reports,
    ).toHaveLength(0);
    await h.http().post(`/api/shop/payment-reports/${r!.id}/approve`).set(b.auth).expect(404);
    await h
      .http()
      .post(`/api/shop/payment-reports/${r!.id}/decline`)
      .set(b.auth)
      .send({ reason: 'OTHER' })
      .expect(404);
  });
});

describe('P6.5 manual refunds', () => {
  it('a rejected paid order waits for the shop to send the money back, then completes', async () => {
    const s = await pairedShop(h);
    await setUpShop(s);
    const created = await payableOrder(h, s.shop.id);
    const { payment } = await checkout(created);
    fake.settle(payment.providerOrderId!, 'OBSERVED_SUCCESS', utr());
    await deliver(payment.providerOrderId!).expect(200);
    await h
      .http()
      .post(`/api/shop/jobs/${created.order.id}/reject`)
      .set(s.auth)
      .send({ reasonCode: 'SHOP_CLOSING' })
      .expect(200);

    const pending = (await view(h, created)).body as PublicOrder;
    expect(pending.status).toBe('REFUND_PENDING');
    expect(pending.refund).toMatchObject({ status: 'PENDING', manual: true, isSimulated: false });

    const refunds = (await h.http().get('/api/shop/refunds').set(s.auth).expect(200)).body.refunds;
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({
      orderId: created.order.id,
      amountPaise: payment.amountPaise,
    });

    const other = await pairedShop(h);
    await h
      .http()
      .post(`/api/shop/refunds/${refunds[0].refundId}/confirm`)
      .set(other.auth)
      .send({})
      .expect(404);
    await h
      .http()
      .post(`/api/shop/refunds/${refunds[0].refundId}/confirm`)
      .set(s.auth)
      .send({ utr: utr() })
      .expect(204);
    await h
      .http()
      .post(`/api/shop/refunds/${refunds[0].refundId}/confirm`)
      .set(s.auth)
      .send({})
      .expect(204);

    const done = (await view(h, created)).body as PublicOrder;
    expect(done.status).toBe('REFUNDED');
    expect(done.refund).toMatchObject({ status: 'SUCCEEDED', manual: true });
    expect((await h.http().get('/api/shop/refunds').set(s.auth)).body.refunds).toHaveLength(0);
  });
});
