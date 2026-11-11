import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type PayResponse } from '@kagaz/shared';
import { makePdf } from '../fixtures/pdfs.js';
import {
  MONO,
  type Harness,
  createHarness,
  createOrder,
  createShop,
  uploadPdf,
} from './harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});

async function payableOrder(copies = 2) {
  const shop = await createShop(h.prisma);
  const created = await createOrder(h, shop.id, { ...MONO, copies });
  expect((await uploadPdf(h, created, await makePdf(12))).status).toBe(200);
  return created;
}

describe('demo payment (T04)', () => {
  it('pays the server amount, is labelled simulated, and moves to PENDING_REVIEW once', async () => {
    const created = await payableOrder();
    const res = await h
      .http()
      .post(`/api/orders/${created.order.id}/pay`)
      .set('x-tracking-token', created.trackingToken)
      .send({ amountPaise: 1 }) // ignored: the client never decides the amount
      .expect(200);
    const body = res.body as PayResponse;
    expect(body.mode).toBe('DEMO_AUTO_APPROVED');
    expect(body.order.status).toBe('PENDING_REVIEW');
    expect(body.order.amountPaise).toBe(4800);
    expect(body.order.payment).toEqual({
      status: 'PAID',
      isSimulated: true,
      reference: `DEMO-PAY-${created.order.publicRef}`,
      checkoutUrl: null,
    });

    const payments = await h.prisma.payment.findMany({ where: { orderId: created.order.id } });
    expect(payments).toHaveLength(1);
    expect(payments[0]).toMatchObject({ amountPaise: 4800, provider: 'demo', isSimulated: true });

    const order = await h.prisma.order.findUniqueOrThrow({ where: { id: created.order.id } });
    expect(order.priceSnapshot).toMatchObject({ totalPaise: 4800, ratePaise: 200 });
    expect(order.paidAt).not.toBeNull();
  });

  it('repeated and concurrent pay calls create one payment and one paid transition', async () => {
    const created = await payableOrder();
    const pay = () =>
      h
        .http()
        .post(`/api/orders/${created.order.id}/pay`)
        .set('x-tracking-token', created.trackingToken);
    const results = await Promise.all([pay(), pay(), pay(), pay(), pay()]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    await pay().expect(200);

    expect(await h.prisma.payment.count({ where: { orderId: created.order.id } })).toBe(1);
    const paidEvents = await h.prisma.orderEvent.count({
      where: { orderId: created.order.id, toStatus: 'PENDING_REVIEW' },
    });
    expect(paidEvents).toBe(1);
  });

  it('price changes after payment do not change the order (snapshot)', async () => {
    const created = await payableOrder(1);
    await h
      .http()
      .post(`/api/orders/${created.order.id}/pay`)
      .set('x-tracking-token', created.trackingToken)
      .expect(200);
    const order = await h.prisma.order.findUniqueOrThrow({ where: { id: created.order.id } });
    await h.prisma.shopPricing.create({
      data: { shopId: order.shopId, monoRatePaise: 999, colourRatePaise: 999 },
    });
    const view = await h
      .http()
      .get(`/api/orders/${created.order.id}`)
      .set('x-tracking-token', created.trackingToken);
    expect(view.body.amountPaise).toBe(2400);
    expect(view.body.quote.ratePaise).toBe(200);
  });

  it('cannot pay a draft without a validated file', async () => {
    const shop = await createShop(h.prisma);
    const created = await createOrder(h, shop.id);
    const res = await h
      .http()
      .post(`/api/orders/${created.order.id}/pay`)
      .set('x-tracking-token', created.trackingToken)
      .expect(409);
    expect(res.body.error.code).toBe('ORDER_NOT_PAYABLE');
  });

  it('options are locked once payment started', async () => {
    const created = await payableOrder(1);
    await h
      .http()
      .post(`/api/orders/${created.order.id}/pay`)
      .set('x-tracking-token', created.trackingToken)
      .expect(200);
    const res = await h
      .http()
      .patch(`/api/orders/${created.order.id}/options`)
      .set('x-tracking-token', created.trackingToken)
      .send({ options: { ...MONO, copies: 5 } })
      .expect(409);
    expect(res.body.error.code).toBe('ORDER_NOT_EDITABLE');
  });
});
