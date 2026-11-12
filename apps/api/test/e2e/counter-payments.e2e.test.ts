import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type CounterPaymentList,
  type CounterPaymentRequest,
  type CreateOrderResponse,
  type PayAtCounterResponse,
  type ShopJob,
} from '@kagaz/shared';
import { makePdf } from '../fixtures/pdfs.js';
import { type Harness, createHarness, createOrder, uploadPdf } from './harness.js';
import { type PairedShop, customerView, pairedShop, paidOrder } from './shop-helpers.js';

/**
 * ADR-003: pay at counter. Choosing it gives the order its daily pickup number at once; the
 * customer shows "#7" at the counter and a signed-in operator approves the payment.
 */
let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});

async function uploadedOrder(s: PairedShop, pages = 2): Promise<CreateOrderResponse> {
  const created = await createOrder(h, s.shop.id);
  expect((await uploadPdf(h, created, await makePdf(pages))).status).toBe(200);
  return created;
}

function payAtCounter(c: CreateOrderResponse) {
  return h
    .http()
    .post(`/api/orders/${c.order.id}/pay-at-counter`)
    .set('x-tracking-token', c.trackingToken);
}

async function counterList(s: PairedShop): Promise<CounterPaymentRequest[]> {
  const res = await h.http().get('/api/shop/counter-payments').set(s.auth).expect(200);
  return (res.body as CounterPaymentList).requests;
}

async function waitingOrder(s: PairedShop) {
  const created = await uploadedOrder(s);
  const order = ((await payAtCounter(created).expect(200)).body as PayAtCounterResponse).order;
  return { created, order, number: order.pickupNumber! };
}

describe('ADR-003: pay at counter', () => {
  it('ADR-003: choosing pay at counter gives the pickup number; the operator approves it → paid', async () => {
    const s = await pairedShop(h);
    const created = await uploadedOrder(s, 3);

    const first = (await payAtCounter(created).expect(200)).body as PayAtCounterResponse;
    expect(first.order.status).toBe('AWAITING_PAYMENT');
    expect(first.order.payment).toMatchObject({ method: 'COUNTER', status: 'PENDING' });
    expect(first.order.pickupNumber).toBe(1);
    expect(first.order.pickupDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(first.order.amountPaise).toBe(600); // 3 sides × ₹2

    // Idempotent: same payment, same number.
    const again = (await payAtCounter(created).expect(200)).body as PayAtCounterResponse;
    expect(again.order.pickupNumber).toBe(1);
    expect(await h.prisma.payment.count({ where: { orderId: created.order.id } })).toBe(1);

    // The shop sees "#1 · collect ₹6"; it is not a print job yet.
    const list = await counterList(s);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      orderId: created.order.id,
      pickupNumber: 1,
      pickupDate: first.order.pickupDate,
      amountPaise: 600,
      pageCount: 3,
      printedSides: 3,
    });
    const jobs = (await h.http().get('/api/shop/jobs').set(s.auth).expect(200)).body
      .jobs as ShopJob[];
    expect(jobs).toHaveLength(0);

    // Lookup and approve are operator actions.
    await s.agent('counter-payments/lookup', { pickupNumber: 1 }).expect(401);
    const found = (await s.human('counter-payments/lookup', { pickupNumber: 1 }).expect(200))
      .body as CounterPaymentRequest;
    expect(found.orderId).toBe(created.order.id);
    const miss = await s.human('counter-payments/lookup', { pickupNumber: 2 }).expect(404);
    expect(miss.body.error.code).toBe('COUNTER_PAYMENT_NOT_FOUND');
    await s.human('counter-payments/lookup', { pickupNumber: '1' }).expect(400);

    const bad = await s
      .human(`counter-payments/${created.order.id}/approve`, { pickupNumber: 2 })
      .expect(422);
    expect(bad.body.error.code).toBe('PICKUP_NUMBER_MISMATCH');

    const job = (
      await s.human(`counter-payments/${created.order.id}/approve`, { pickupNumber: 1 }).expect(200)
    ).body as ShopJob;
    expect(job).toMatchObject({
      orderId: created.order.id,
      status: 'PENDING_REVIEW',
      paymentMethod: 'COUNTER',
      simulatedPayment: false,
      pickupNumber: 1,
    });

    // The number never changes on payment.
    const view = await customerView(h, created);
    expect(view.status).toBe('PENDING_REVIEW');
    expect(view.pickupNumber).toBe(1);
    expect(view.payment).toMatchObject({ method: 'COUNTER', status: 'PAID' });

    // Exactly once; audited as the operator.
    const twice = await s
      .human(`counter-payments/${created.order.id}/approve`, { pickupNumber: 1 })
      .expect(409);
    expect(twice.body.error.code).toBe('COUNTER_PAYMENT_NOT_PENDING');
    const audit = await h.prisma.auditLog.findMany({
      where: { orderId: created.order.id, action: 'payment.counter_collected' },
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actorType).toBe('STAFF');
    expect(await counterList(s)).toHaveLength(0);
  });

  it('ADR-003: counter and online orders share one daily sequence; abandoned numbers are not reused', async () => {
    const s = await pairedShop(h);
    const a = await waitingOrder(s); // #1 (counter, will be abandoned)
    const b = await paidOrder(h, s.shop.id); // #2 (online)
    const c = await waitingOrder(s); // #3 (counter)
    expect(a.number).toBe(1);
    expect((await customerView(h, b)).pickupNumber).toBe(2);
    expect(c.number).toBe(3);

    await s.human(`counter-payments/${a.created.order.id}/cancel`).expect(200);
    const d = await waitingOrder(s);
    expect(d.number).toBe(4);
    expect((await counterList(s)).map((r) => r.pickupNumber)).toEqual([3, 4]);
  });

  it('ADR-003: another shop cannot see, look up, approve or cancel the order (404)', async () => {
    const s = await pairedShop(h);
    const other = await pairedShop(h);
    const { created, number } = await waitingOrder(s);

    expect(await counterList(other)).toHaveLength(0);
    await other.human('counter-payments/lookup', { pickupNumber: number }).expect(404);
    const approve = await other
      .human(`counter-payments/${created.order.id}/approve`, { pickupNumber: number })
      .expect(404);
    expect(approve.body.error.code).toBe('ORDER_NOT_FOUND');
    await other.human(`counter-payments/${created.order.id}/cancel`).expect(404);
    expect((await customerView(h, created)).status).toBe('AWAITING_PAYMENT');
  });

  it('ADR-003: online pay is refused after choosing counter; the customer can still cancel', async () => {
    const s = await pairedShop(h);
    const { created, order } = await waitingOrder(s);
    expect(order.canCancel).toBe(true);

    const pay = await h
      .http()
      .post(`/api/orders/${created.order.id}/pay`)
      .set('x-tracking-token', created.trackingToken)
      .expect(409);
    expect(pay.body.error.code).toBe('COUNTER_PAYMENT_PENDING');

    const cancelled = await h
      .http()
      .post(`/api/orders/${created.order.id}/cancel`)
      .set('x-tracking-token', created.trackingToken)
      .expect(200);
    expect(cancelled.body.status).toBe('CANCELLED');
    expect(cancelled.body.payment).toMatchObject({ status: 'FAILED' });
    expect(await counterList(s)).toHaveLength(0);
  });

  it('ADR-003: customer left — the operator cancels the waiting order', async () => {
    const s = await pairedShop(h);
    const { created } = await waitingOrder(s);

    await s.agent(`counter-payments/${created.order.id}/cancel`).expect(401);
    await s.human(`counter-payments/${created.order.id}/cancel`).expect(200);
    expect((await customerView(h, created)).status).toBe('CANCELLED');
    expect(await counterList(s)).toHaveLength(0);
    const again = await s.human(`counter-payments/${created.order.id}/cancel`).expect(409);
    expect(again.body.error.code).toBe('COUNTER_PAYMENT_NOT_PENDING');
    expect(
      await h.prisma.auditLog.count({
        where: { orderId: created.order.id, action: 'payment.counter_cancelled' },
      }),
    ).toBe(1);
  });

  it('ADR-003: rejecting a counter-paid order records a cash refund at the counter', async () => {
    const s = await pairedShop(h);
    const { created, number } = await waitingOrder(s);
    await s
      .human(`counter-payments/${created.order.id}/approve`, { pickupNumber: number })
      .expect(200);

    await s.human(`jobs/${created.order.id}/reject`, { reasonCode: 'OTHER' }).expect(200);
    const view = await customerView(h, created);
    expect(view.status).toBe('REFUNDED');
    expect(view.refund).toMatchObject({ status: 'SUCCEEDED', isSimulated: false });
    expect(view.refund!.amountPaise).toBe(view.amountPaise);
  });
});
