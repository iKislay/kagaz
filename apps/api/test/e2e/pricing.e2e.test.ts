import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AdminPricingList, type PublicOrder } from '@kagaz/shared';
import { type Harness, createHarness, createShop } from './harness.js';
import { adminCookie, pay, payableOrder, view } from './pay-helpers.js';

let h: Harness;
let admin: string;
beforeAll(async () => {
  h = await createHarness();
  admin = await adminCookie(h);
});
afterAll(async () => {
  await h.close();
});

const newVersion = (shopId: string, body: object) =>
  h.http().post(`/api/admin/shops/${shopId}/pricing`).set('Cookie', admin).send(body);

describe('pricing versions (P2.5)', () => {
  it('admin lists and creates versions; quotes use the latest effective row', async () => {
    const shop = await createShop(h.prisma);
    const list = (
      await h.http().get(`/api/admin/shops/${shop.id}/pricing`).set('Cookie', admin).expect(200)
    ).body as AdminPricingList;
    expect(list.versions).toHaveLength(1);
    expect(list.versions[0]).toMatchObject({ monoRatePaise: 200, current: true });

    const created = await newVersion(shop.id, { monoRatePaise: 300, colourRatePaise: 1200 }).expect(
      201,
    );
    expect(created.body).toMatchObject({
      monoRatePaise: 300,
      current: true,
      minimumChargePaise: 0,
    });
    const order = await payableOrder(h, shop.id, 3);
    expect(order.order.id).toBeTruthy();
    const quoted = (await view(h, order)).body as PublicOrder;
    expect(quoted.quote).toMatchObject({ ratePaise: 300, totalPaise: 900 });
    expect(quoted.quote?.pricingId).toBe(created.body.id);

    expect(
      await h.prisma.auditLog.count({
        where: { shopId: shop.id, action: 'pricing.version_created' },
      }),
    ).toBe(1);
  });

  it('a future version is scheduled, not used yet', async () => {
    const shop = await createShop(h.prisma);
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const res = await newVersion(shop.id, {
      monoRatePaise: 999,
      colourRatePaise: 999,
      effectiveFrom: future,
    }).expect(201);
    expect(res.body.current).toBe(false);
    const order = await payableOrder(h, shop.id, 1);
    expect(((await view(h, order)).body as PublicOrder).quote?.ratePaise).toBe(200);
  });

  it('T03: a paid order keeps its snapshot after a price change', async () => {
    const shop = await createShop(h.prisma);
    const order = await payableOrder(h, shop.id, 4);
    await pay(h, order).expect(200);
    await newVersion(shop.id, { monoRatePaise: 500, colourRatePaise: 1500 }).expect(201);
    const after = (await view(h, order)).body as PublicOrder;
    expect(after.amountPaise).toBe(800);
    expect(after.quote?.ratePaise).toBe(200);
    const row = await h.prisma.order.findUniqueOrThrow({ where: { id: order.order.id } });
    expect(row.priceSnapshot).toMatchObject({ totalPaise: 800, ratePaise: 200 });
  });

  it('T03: a price change before payment re-quotes and asks the customer to confirm', async () => {
    const shop = await createShop(h.prisma);
    const order = await payableOrder(h, shop.id, 4);
    await newVersion(shop.id, { monoRatePaise: 250, colourRatePaise: 1500 }).expect(201);
    const changed = await pay(h, order).send({ amountPaise: 800 }).expect(409);
    expect(changed.body.error.code).toBe('PRICE_CHANGED');
    expect(changed.body.error.details.quote.totalPaise).toBe(1000);
    expect(await h.prisma.payment.count({ where: { orderId: order.order.id } })).toBe(0);

    const paid = await pay(h, order).expect(200);
    expect(paid.body.order.amountPaise).toBe(1000);
    expect(paid.body.order.payment.status).toBe('PAID');
  });

  it('validates input and access', async () => {
    const shop = await createShop(h.prisma);
    await h.http().get(`/api/admin/shops/${shop.id}/pricing`).expect(401);
    await newVersion(shop.id, { monoRatePaise: 2.5, colourRatePaise: 10 }).expect(400);
    await newVersion(shop.id, { monoRatePaise: 200, colourRatePaise: 1000, amount: 1 }).expect(400);
    await newVersion(shop.id, {
      monoRatePaise: 200,
      colourRatePaise: 1000,
      duplexRule: 'DISCOUNTED_SIDE_RATE',
    }).expect(400);
    const past = await newVersion(shop.id, {
      monoRatePaise: 200,
      colourRatePaise: 1000,
      effectiveFrom: new Date(Date.now() - 3_600_000).toISOString(),
    }).expect(422);
    expect(past.body.error.code).toBe('PRICING_IN_PAST');
    await h
      .http()
      .get('/api/admin/shops/00000000-0000-7000-8000-000000000000/pricing')
      .set('Cookie', admin)
      .expect(404);
  });
});
