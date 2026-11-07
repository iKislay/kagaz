import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CreateOrderResponse, type PublicOrder } from '@kagaz/shared';
import { type DemoMockProvider } from '../../src/modules/payments/demo-mock.provider.js';
import { PAYMENT_PROVIDER } from '../../src/modules/payments/payment-provider.js';
import { type Harness, createHarness, createShop } from './harness.js';
import {
  adminCookie,
  eventually,
  pairedShop,
  pay,
  payableOrder,
  shopAction,
  view,
} from './pay-helpers.js';

// Fast simulated gateway for this file (read when the app module is created).
const saved = {
  delay: process.env.DEMO_WEBHOOK_DELAY_MS,
  pending: process.env.DEMO_PENDING_RESOLVE_SECONDS,
};
process.env.DEMO_WEBHOOK_DELAY_MS = '20';
process.env.DEMO_PENDING_RESOLVE_SECONDS = '1';

let h: Harness;
let admin: string;
let gateway: DemoMockProvider;
beforeAll(async () => {
  h = await createHarness();
  admin = await adminCookie(h);
  gateway = h.app.get(PAYMENT_PROVIDER);
});
afterAll(async () => {
  await h.close();
  process.env.DEMO_WEBHOOK_DELAY_MS = saved.delay;
  process.env.DEMO_PENDING_RESOLVE_SECONDS = saved.pending;
});

const setOutcome = (orderId: string, outcome: string | null) =>
  h
    .http()
    .put(`/api/admin/demo/payments/${orderId}/outcome`)
    .set('Cookie', admin)
    .send({ outcome })
    .expect(200);

/** POST a webhook exactly as bytes (signature covers the raw body). */
function postWebhook(rawBody: Buffer, headers: Record<string, string>) {
  return h.http().post('/api/webhooks/demo').set(headers).send(rawBody.toString('utf8'));
}

async function pendingPayment(created: CreateOrderResponse) {
  // PENDING keeps the gateway undecided so the test drives the webhooks itself.
  await setOutcome(created.order.id, 'PENDING');
  const res = await pay(h, created).expect(200);
  expect(res.body.order.payment.status).toBe('PENDING');
  return h.prisma.payment.findFirstOrThrow({ where: { orderId: created.order.id } });
}

function paidWebhook(
  payment: { providerOrderId: string | null; amountPaise: number },
  eventId: string,
  extra: Partial<{ amountPaise: number | null; providerPaymentId: string | null }> = {},
) {
  return gateway.buildWebhook({
    type: 'PAYMENT',
    eventId,
    providerOrderId: payment.providerOrderId!,
    providerPaymentId: payment.providerOrderId!.replace('DEMO-ORD-', 'DEMO-PAY-'),
    status: 'PAID',
    amountPaise: payment.amountPaise,
    ...extra,
  });
}

describe('webhook pipeline (P3.3)', () => {
  it('T06: the same event twice → one paid transition and one print job', async () => {
    const s = await pairedShop(h);
    await shopAction(h, s.auth, 'patch', '/api/shop/mode', { approvalMode: 'AUTO' }).expect(200);
    const created = await payableOrder(h, s.shop.id);
    const payment = await pendingPayment(created);
    const { rawBody, headers } = paidWebhook(payment, `evt-t06-${payment.id}`);

    const first = await postWebhook(rawBody, headers).expect(200);
    expect(first.body).toEqual({ received: true, duplicate: false, outcome: 'PAID' });
    const second = await postWebhook(rawBody, headers).expect(200);
    expect(second.body).toEqual({ received: true, duplicate: true, outcome: 'DUPLICATE' });

    expect(
      await h.prisma.orderEvent.count({
        where: { orderId: created.order.id, toStatus: 'PENDING_REVIEW' },
      }),
    ).toBe(1);
    expect(await h.prisma.printJob.count({ where: { orderId: created.order.id } })).toBe(1);
    expect(((await view(h, created)).body as PublicOrder).status).toBe('QUEUED');
    const rows = await h.prisma.webhookEvent.findMany({
      where: { providerEventId: `evt-t06-${payment.id}` },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ signatureValid: true });
    expect(rows[0]!.processedAt).not.toBeNull();
  });

  it('T06: concurrent duplicate deliveries still yield one transition', async () => {
    const shop = await createShop(h.prisma);
    const created = await payableOrder(h, shop.id);
    const payment = await pendingPayment(created);
    const { rawBody, headers } = paidWebhook(payment, `evt-race-${payment.id}`);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => postWebhook(rawBody, headers)),
    );
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(results.filter((r) => r.body.duplicate === false)).toHaveLength(1);
    expect(
      await h.prisma.orderEvent.count({
        where: { orderId: created.order.id, toStatus: 'PENDING_REVIEW' },
      }),
    ).toBe(1);
  });

  it('invalid signature → 400, logged, no state change', async () => {
    const shop = await createShop(h.prisma);
    const created = await payableOrder(h, shop.id);
    const payment = await pendingPayment(created);
    const { rawBody, headers } = paidWebhook(payment, `evt-bad-${payment.id}`);
    const tampered = Buffer.from(
      rawBody.toString().replace(/"amountPaise":\d+/, '"amountPaise":1'),
    );

    const res = await postWebhook(tampered, headers).expect(400);
    expect(res.body.error.code).toBe('WEBHOOK_SIGNATURE_INVALID');
    await postWebhook(rawBody, { 'content-type': 'application/json' }).expect(400);
    // Re-serialised JSON (same content, different bytes) is not the signed body.
    await postWebhook(
      Buffer.from(JSON.stringify(JSON.parse(rawBody.toString()), null, 1)),
      headers,
    ).expect(400);

    const after = await h.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(after.status).toBe('PENDING');
    expect(((await view(h, created)).body as PublicOrder).status).toBe('AWAITING_PAYMENT');
    expect(
      await h.prisma.webhookEvent.count({
        where: { signatureValid: false, error: 'INVALID_SIGNATURE' },
      }),
    ).toBeGreaterThan(0);
    // The real event id was not burned by the forged deliveries.
    await postWebhook(rawBody, headers).expect(200, {
      received: true,
      duplicate: false,
      outcome: 'PAID',
    });
  });

  it('out-of-order: a stale PENDING after PAID is ignored (monotonic)', async () => {
    const shop = await createShop(h.prisma);
    const created = await payableOrder(h, shop.id);
    const payment = await pendingPayment(created);
    await postWebhook(
      ...(Object.values(paidWebhook(payment, `evt-ooo1-${payment.id}`)) as [
        Buffer,
        Record<string, string>,
      ]),
    ).expect(200);
    const stale = gateway.buildWebhook({
      type: 'PAYMENT',
      eventId: `evt-ooo2-${payment.id}`,
      providerOrderId: payment.providerOrderId!,
      status: 'PENDING',
      occurredAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const res = await postWebhook(stale.rawBody, stale.headers).expect(200);
    expect(res.body.outcome).toBe('IGNORED_STALE');
    const failed = gateway.buildWebhook({
      type: 'PAYMENT',
      eventId: `evt-ooo3-${payment.id}`,
      providerOrderId: payment.providerOrderId!,
      status: 'FAILED',
    });
    expect((await postWebhook(failed.rawBody, failed.headers).expect(200)).body.outcome).toBe(
      'IGNORED_STALE',
    );
    expect((await h.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
      'PAID',
    );
  });

  it('ambiguous success is confirmed server-to-server; wrong amounts never mark paid', async () => {
    const shop = await createShop(h.prisma);
    const created = await payableOrder(h, shop.id);
    const payment = await pendingPayment(created);

    // No amount / payment id → status fetch says the gateway is still PENDING.
    const vague = paidWebhook(payment, `evt-vague-${payment.id}`, {
      amountPaise: null,
      providerPaymentId: null,
    });
    expect((await postWebhook(vague.rawBody, vague.headers).expect(200)).body.outcome).toBe(
      'PENDING',
    );
    const wrong = paidWebhook(payment, `evt-wrong-${payment.id}`, { amountPaise: 1 });
    expect((await postWebhook(wrong.rawBody, wrong.headers).expect(200)).body.outcome).toBe(
      'AMOUNT_MISMATCH',
    );
    expect((await h.prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe(
      'PENDING',
    );
    const row = await h.prisma.webhookEvent.findFirstOrThrow({
      where: { providerEventId: `evt-wrong-${payment.id}` },
    });
    expect(row).toMatchObject({ error: 'AMOUNT_MISMATCH', processedAt: null });
  });

  it('unknown provider → 404; unknown payment → 200 recorded as unprocessed', async () => {
    const hook = gateway.buildWebhook({
      type: 'PAYMENT',
      eventId: 'evt-orphan',
      providerOrderId: 'DEMO-ORD-NOPE',
      status: 'PAID',
      amountPaise: 100,
      providerPaymentId: 'x',
    });
    await h
      .http()
      .post('/api/webhooks/razorpay')
      .set(hook.headers)
      .send(hook.rawBody.toString())
      .expect(404);
    const res = await postWebhook(hook.rawBody, hook.headers).expect(200);
    expect(res.body.outcome).toBe('PAYMENT_NOT_FOUND');
  });
});

describe('T05: simulated payment outcomes (P3.5)', () => {
  it('FAIL never reaches the shop queue; retry pays with a new attempt', async () => {
    const s = await pairedShop(h);
    const created = await payableOrder(h, s.shop.id);
    const failed = await pay(h, created, '?demoOutcome=FAIL').expect(200);
    expect(failed.body.order.status).toBe('AWAITING_PAYMENT');
    expect(failed.body.order.payment.status).toBe('FAILED');
    const queue = await h.http().get('/api/shop/jobs').set(s.auth).expect(200);
    expect(queue.body.jobs.map((j: { orderId: string }) => j.orderId)).not.toContain(
      created.order.id,
    );

    const retried = await pay(h, created).expect(200);
    expect(retried.body.order.status).toBe('PENDING_REVIEW');
    expect(retried.body.order.payment).toMatchObject({
      status: 'PAID',
      reference: `DEMO-PAY-${created.order.publicRef}-2`,
    });
    const payments = await h.prisma.payment.findMany({ where: { orderId: created.order.id } });
    expect(payments.map((p) => p.status).sort()).toEqual(['FAILED', 'PAID']);
    expect(new Set(payments.map((p) => p.amountPaise)).size).toBe(1);
  });

  it('PENDING waits for confirmation, then the webhook marks it paid', async () => {
    const s = await pairedShop(h);
    const created = await payableOrder(h, s.shop.id);
    const res = await pay(h, created, '?demoOutcome=PENDING').expect(200);
    expect(res.body.order).toMatchObject({
      status: 'AWAITING_PAYMENT',
      payment: { status: 'PENDING' },
    });
    const queue = await h.http().get('/api/shop/jobs').set(s.auth).expect(200);
    expect(queue.body.jobs).toHaveLength(0);
    // Paying again while pending re-checks; it never creates a second payment.
    await pay(h, created).expect(200);
    expect(await h.prisma.payment.count({ where: { orderId: created.order.id } })).toBe(1);

    const done = await eventually(
      async () => (await view(h, created)).body as PublicOrder,
      (o) => o.status === 'PENDING_REVIEW',
    );
    expect(done.payment?.status).toBe('PAID');
  });

  it('DUPLICATE_WEBHOOK and OUT_OF_ORDER resolve to exactly one paid transition', async () => {
    const shop = await createShop(h.prisma);
    for (const outcome of ['DUPLICATE_WEBHOOK', 'OUT_OF_ORDER']) {
      const created = await payableOrder(h, shop.id);
      await setOutcome(created.order.id, outcome);
      await pay(h, created).expect(200);
      const done = await eventually(
        async () => (await view(h, created)).body as PublicOrder,
        (o) => o.status === 'PENDING_REVIEW',
      );
      expect(done.payment?.status).toBe('PAID');
      // Let the trailing duplicate / stale event arrive too.
      const payment = await h.prisma.payment.findFirstOrThrow({
        where: { orderId: created.order.id },
      });
      const prefix = `DEMO-EVT-${created.order.publicRef}-`;
      await eventually(
        () => h.prisma.webhookEvent.count({ where: { providerEventId: { startsWith: prefix } } }),
        (n) => n >= (outcome === 'OUT_OF_ORDER' ? 2 : 1),
      );
      expect(payment.status).toBe('PAID');
      expect(
        await h.prisma.orderEvent.count({
          where: { orderId: created.order.id, toStatus: 'PENDING_REVIEW' },
        }),
      ).toBe(1);
    }
  });

  it('demo controls list orders and reject unknown outcomes / disabled access', async () => {
    const list = await h.http().get('/api/admin/demo/payments').set('Cookie', admin).expect(200);
    expect(list.body.outcomes).toEqual([
      'SUCCESS',
      'FAIL',
      'PENDING',
      'DUPLICATE_WEBHOOK',
      'OUT_OF_ORDER',
    ]);
    await h.http().get('/api/admin/demo/payments').expect(401);
    const shop = await createShop(h.prisma);
    const created = await payableOrder(h, shop.id);
    await pay(h, created, '?demoOutcome=NOPE').expect(400);
    await h
      .http()
      .put('/api/admin/demo/payments/not-a-uuid/outcome')
      .set('Cookie', admin)
      .send({ outcome: 'FAIL' })
      .expect(404);
  });
});
