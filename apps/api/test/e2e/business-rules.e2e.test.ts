import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type HeldOrders, type PublicOrder } from '@kagaz/shared';
import { type DemoMockProvider } from '../../src/modules/payments/demo-mock.provider.js';
import { PAYMENT_PROVIDER } from '../../src/modules/payments/payment-provider.js';
import { RefundService } from '../../src/modules/payments/refunds.service.js';
import { MONO, type Harness, createHarness, createOrder, createShop } from './harness.js';
import { adminCookie, pairedShop, pay, payableOrder, shopAction, view } from './pay-helpers.js';

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
});

const statuses = async (orderId: string) =>
  (await h.prisma.orderEvent.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } })).map(
    (e) => e.toStatus,
  );

describe('refund workflow (P3.4)', () => {
  it('T07/T20: shop reject of a paid order → simulated refund; history, payment, refund agree', async () => {
    const s = await pairedShop(h);
    const created = await payableOrder(h, s.shop.id, 3);
    await pay(h, created).expect(200);
    await shopAction(h, s.auth, 'post', `/api/shop/jobs/${created.order.id}/reject`, {
      reasonCode: 'OUT_OF_SUPPLIES',
      note: 'No toner',
    }).expect(200);

    const order = (await view(h, created)).body as PublicOrder;
    expect(order.status).toBe('REFUNDED');
    expect(order.refund).toEqual({ status: 'SUCCEEDED', amountPaise: 600, isSimulated: true });
    expect(order.rejection).toEqual({ code: 'OUT_OF_SUPPLIES', note: 'No toner' });
    expect(await statuses(created.order.id)).toEqual([
      'DRAFT',
      'AWAITING_PAYMENT',
      'PENDING_REVIEW',
      'REJECTED',
      'REFUND_PENDING',
      'REFUNDED',
    ]);
    const payment = await h.prisma.payment.findFirstOrThrow({
      where: { orderId: created.order.id },
      include: { refunds: true },
    });
    expect(payment.status).toBe('REFUNDED');
    expect(payment.refunds).toHaveLength(1);
    expect(payment.refunds[0]).toMatchObject({
      status: 'SUCCEEDED',
      amountPaise: payment.amountPaise,
      isSimulated: true,
      idempotencyKey: `refund:${payment.id}:1`,
    });
    const refunded = await h.prisma.orderEvent.findFirstOrThrow({
      where: { orderId: created.order.id, toStatus: 'REFUNDED' },
    });
    expect(refunded.reason).toBe('Demo refund — no money moved');

    // RefundService.request is idempotent: no second refund, same result.
    const again = await h.app.get(RefundService).request(created.order.id, 'again');
    expect(again.refund?.id).toBe(payment.refunds[0]!.id);
    expect(await h.prisma.refund.count({ where: { paymentId: payment.id } })).toBe(1);
  });

  it('RefundService.request on an unpaid rejected order returns no refund', async () => {
    const shop = await createShop(h.prisma);
    const created = await payableOrder(h, shop.id);
    await expect(h.app.get(RefundService).request(created.order.id, 'x')).rejects.toMatchObject({
      code: 'INVALID_TRANSITION',
    });
  });

  it('a failed provider refund stays REFUND_PENDING; admin retry uses the next key', async () => {
    const s = await pairedShop(h);
    const created = await payableOrder(h, s.shop.id);
    await pay(h, created).expect(200);
    const spy = vi
      .spyOn(gateway, 'refund')
      .mockResolvedValueOnce({ providerRefundId: 'DEMO-RFD-FAILED', status: 'FAILED' });
    const res = await h
      .http()
      .post(`/api/admin/orders/${created.order.id}/reject`)
      .set('Cookie', admin)
      .send({ reasonCode: 'PRINTER_UNAVAILABLE' })
      .expect(200);
    spy.mockRestore();
    expect(res.body).toMatchObject({ status: 'REFUND_PENDING', refund: { status: 'FAILED' } });

    const retry = await h
      .http()
      .post(`/api/admin/orders/${created.order.id}/refund`)
      .set('Cookie', admin)
      .expect(200);
    expect(retry.body).toMatchObject({ status: 'REFUNDED', refund: { status: 'SUCCEEDED' } });
    const refunds = await h.prisma.refund.findMany({
      where: { payment: { orderId: created.order.id } },
      orderBy: { createdAt: 'asc' },
    });
    expect(refunds.map((r) => [r.status, r.idempotencyKey.split(':')[2]])).toEqual([
      ['FAILED', '1'],
      ['SUCCEEDED', '2'],
    ]);
  });
});

describe('cancellation and business rules (P3.6)', () => {
  it('customer cancels before payment; cannot cancel with a payment in flight or done', async () => {
    const shop = await createShop(h.prisma);
    const draft = await createOrder(h, shop.id);
    expect(draft.order.canCancel).toBe(true);
    const cancelled = await h
      .http()
      .post(`/api/orders/${draft.order.id}/cancel`)
      .set('x-tracking-token', draft.trackingToken)
      .expect(200);
    expect(cancelled.body).toMatchObject({ status: 'CANCELLED', canCancel: false });
    await h
      .http()
      .post(`/api/orders/${draft.order.id}/cancel`)
      .set('x-tracking-token', draft.trackingToken)
      .expect(200); // idempotent
    await pay(h, draft).expect(409);

    const paid = await payableOrder(h, shop.id);
    await pay(h, paid).expect(200);
    const refused = await h
      .http()
      .post(`/api/orders/${paid.order.id}/cancel`)
      .set('x-tracking-token', paid.trackingToken)
      .expect(409);
    expect(refused.body.error.code).toBe('PAYMENT_IN_PROGRESS');

    const pending = await payableOrder(h, shop.id);
    await pay(h, pending, '?demoOutcome=PENDING').expect(200);
    expect(((await view(h, pending)).body as PublicOrder).canCancel).toBe(false);
    await h
      .http()
      .post(`/api/orders/${pending.order.id}/cancel`)
      .set('x-tracking-token', pending.trackingToken)
      .expect(409);
    await h.http().post(`/api/orders/${pending.order.id}/cancel`).expect(404); // no token
  });

  it('after a failed payment the customer may cancel; a late success is flagged, not applied', async () => {
    const shop = await createShop(h.prisma);
    const created = await payableOrder(h, shop.id);
    await pay(h, created, '?demoOutcome=FAIL').expect(200);
    await h
      .http()
      .post(`/api/orders/${created.order.id}/cancel`)
      .set('x-tracking-token', created.trackingToken)
      .expect(200);
    const payment = await h.prisma.payment.findFirstOrThrow({
      where: { orderId: created.order.id },
    });
    const late = gateway.buildWebhook({
      type: 'PAYMENT',
      eventId: `late-${payment.id}`,
      providerOrderId: payment.providerOrderId!,
      providerPaymentId: `DEMO-PAY-LATE-${payment.id}`,
      status: 'PAID',
      amountPaise: payment.amountPaise,
    });
    const res = await h
      .http()
      .post('/api/webhooks/demo')
      .set(late.headers)
      .send(late.rawBody.toString())
      .expect(200);
    expect(res.body.outcome).toBe('PAID_ORDER_NOT_PAYABLE');
    expect(((await view(h, created)).body as PublicOrder).status).toBe('CANCELLED');
    expect(
      await h.prisma.auditLog.count({
        where: { orderId: created.order.id, action: 'payment.paid_order_not_payable' },
      }),
    ).toBe(1);
  });

  it('admin rejects after payment → refund; not before payment', async () => {
    const s = await pairedShop(h);
    const created = await payableOrder(h, s.shop.id);
    await h
      .http()
      .post(`/api/admin/orders/${created.order.id}/reject`)
      .set('Cookie', admin)
      .send({ reasonCode: 'OTHER' })
      .expect(409);
    await pay(h, created).expect(200);
    await shopAction(h, s.auth, 'post', `/api/shop/jobs/${created.order.id}/accept`).expect(200);
    const res = await h
      .http()
      .post(`/api/admin/orders/${created.order.id}/reject`)
      .set('Cookie', admin)
      .send({ reasonCode: 'SHOP_CLOSING', note: 'Closed early' })
      .expect(200);
    expect(res.body).toMatchObject({ status: 'REFUNDED', refund: { status: 'SUCCEEDED' } });
    const job = await h.prisma.printJob.findFirstOrThrow({ where: { orderId: created.order.id } });
    expect(job.status).toBe('CANCELLED');
    const audit = await h.prisma.auditLog.findFirstOrThrow({
      where: { orderId: created.order.id, action: 'order.admin_rejected' },
    });
    expect(audit.actorType).toBe('ADMIN');
    await h
      .http()
      .post(`/api/admin/orders/${created.order.id}/reject`)
      .send({ reasonCode: 'OTHER' })
      .expect(401);
  });

  it('T19: closed shop blocks new checkout; already-paid orders stay in review and are flagged', async () => {
    const s = await pairedShop(h);
    await shopAction(h, s.auth, 'patch', '/api/shop/mode', { approvalMode: 'AUTO' }).expect(200);
    const paidBefore = await payableOrder(h, s.shop.id);
    const awaiting = await payableOrder(h, s.shop.id);
    const inFlight = await payableOrder(h, s.shop.id);
    await pay(h, inFlight, '?demoOutcome=PENDING').expect(200);
    await h.prisma.shop.update({ where: { id: s.shop.id }, data: { approvalMode: 'MANUAL' } });
    await pay(h, paidBefore).expect(200);
    await h.prisma.shop.update({
      where: { id: s.shop.id },
      data: { approvalMode: 'AUTO', status: 'CLOSED' },
    });

    // New drafts and new checkouts are refused.
    const draft = await h
      .http()
      .post('/api/orders')
      .send({ shopId: s.shop.id, options: MONO })
      .expect(409);
    expect(draft.body.error.code).toBe('SHOP_UNAVAILABLE');
    const checkout = await pay(h, awaiting).expect(409);
    expect(checkout.body.error.code).toBe('SHOP_UNAVAILABLE');
    const shops = await h.http().get('/api/shops').expect(200);
    expect(shops.body.shops.find((x: { id: string }) => x.id === s.shop.id).acceptingOrders).toBe(
      false,
    );

    // A payment already in flight still completes, but is held (never auto-queued).
    const payment = await h.prisma.payment.findFirstOrThrow({
      where: { orderId: inFlight.order.id },
    });
    const hook = gateway.buildWebhook({
      type: 'PAYMENT',
      eventId: `t19-${payment.id}`,
      providerOrderId: payment.providerOrderId!,
      providerPaymentId: payment.providerOrderId!.replace('DEMO-ORD-', 'DEMO-PAY-'),
      status: 'PAID',
      amountPaise: payment.amountPaise,
    });
    await h
      .http()
      .post('/api/webhooks/demo')
      .set(hook.headers)
      .send(hook.rawBody.toString())
      .expect(200);
    expect(((await view(h, inFlight)).body as PublicOrder).status).toBe('PENDING_REVIEW');
    const ev = await h.prisma.orderEvent.findFirstOrThrow({
      where: { orderId: inFlight.order.id, toStatus: 'PENDING_REVIEW' },
    });
    expect((ev.metadata as { autoAccept: { reasons: string[] } }).autoAccept.reasons).toContain(
      'SHOP_NOT_OPEN',
    );

    const held = (await h.http().get('/api/admin/held-orders').set('Cookie', admin).expect(200))
      .body as HeldOrders;
    const mine = held.items.filter((i) => i.shopId === s.shop.id);
    expect(mine.map((i) => i.orderId).sort()).toEqual(
      [paidBefore.order.id, inFlight.order.id].sort(),
    );
    expect(mine.every((i) => i.reason === 'SHOP_NOT_OPEN')).toBe(true);

    await h.prisma.shop.update({ where: { id: s.shop.id }, data: { status: 'MAINTENANCE' } });
    const maint = (await h.http().get('/api/admin/held-orders').set('Cookie', admin).expect(200))
      .body as HeldOrders;
    expect(maint.items.find((i) => i.orderId === paidBefore.order.id)?.reason).toBe(
      'SHOP_MAINTENANCE',
    );
  });

  it('opening hours (Asia/Kolkata) gate new orders', async () => {
    const shop = await createShop(h.prisma);
    const order = await payableOrder(h, shop.id);
    // A window that is never "now": one minute, 12 hours away from the current IST time.
    const ist = new Date(Date.now() + 330 * 60_000 + 12 * 3600_000);
    const hh = String(ist.getUTCHours()).padStart(2, '0');
    const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    await h.prisma.shop.update({
      where: { id: shop.id },
      data: { openingHours: { [days[ist.getUTCDay()]!]: [[`${hh}:00`, `${hh}:01`]] } },
    });
    const res = await h
      .http()
      .post('/api/orders')
      .send({ shopId: shop.id, options: MONO })
      .expect(409);
    expect(res.body.error).toMatchObject({
      code: 'SHOP_UNAVAILABLE',
      details: { reason: 'OUTSIDE_OPENING_HOURS' },
    });
    expect((await pay(h, order).expect(409)).body.error.code).toBe('SHOP_UNAVAILABLE');
  });

  it('P3.8: admin stores settlement fields (inactive)', async () => {
    const shop = await createShop(h.prisma);
    const res = await h
      .http()
      .patch(`/api/admin/shops/${shop.id}/settlement`)
      .set('Cookie', admin)
      .send({ gatewayAccountId: 'acc_TEST123', settlementConfig: { model: 'PENDING_D6' } })
      .expect(200);
    expect(res.body).toEqual({
      shopId: shop.id,
      gatewayAccountId: 'acc_TEST123',
      settlementConfig: { model: 'PENDING_D6' },
      active: false,
    });
    await h
      .http()
      .patch(`/api/admin/shops/${shop.id}/settlement`)
      .send({ gatewayAccountId: 'x' })
      .expect(401);
    expect(
      await h.prisma.auditLog.count({
        where: { shopId: shop.id, action: 'shop.settlement_updated' },
      }),
    ).toBe(1);
  });
});
