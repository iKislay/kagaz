import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type CreateOrderResponse,
  type PublicOrder,
  type ShopPricing,
  type ShopProfile,
  type ShopSummary,
} from '@kagaz/shared';
import { makePdf } from '../fixtures/pdfs.js';
import { type Harness, createHarness, createOrder, pairDevice, uploadPdf } from './harness.js';
import { pairedShop } from './shop-helpers.js';

/** The shop's own prices, QR code and map position (shop app Pricing / Shop QR pages). */
let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});

const NEW_PRICES = {
  monoRatePaise: 300,
  monoDuplexRatePaise: 250,
  colourRatePaise: 1500,
  colourDuplexRatePaise: 1200,
  minimumChargePaise: 0,
};

describe('shop pricing', () => {
  it('shows the current price for every configuration (duplex = simplex when not discounted)', async () => {
    const s = await pairedShop(h);
    const res = await h.http().get('/api/shop/pricing').set(s.auth).expect(200);
    expect(res.body as ShopPricing).toMatchObject({
      monoRatePaise: 200,
      monoDuplexRatePaise: 200,
      colourRatePaise: 1000,
      colourDuplexRatePaise: 1000,
      minimumChargePaise: 500,
      colourAvailable: false,
      duplexAvailable: true,
    });
  });

  it('only the shop owner can change prices; operators get 403 OWNER_REQUIRED', async () => {
    const s = await pairedShop(h);
    const put = await h
      .http()
      .put('/api/shop/pricing')
      .set({ ...s.auth, ...s.operator })
      .send(NEW_PRICES)
      .expect(403);
    expect(put.body.error.code).toBe('OWNER_REQUIRED');
    await h.http().put('/api/shop/pricing').set(s.auth).send(NEW_PRICES).expect(401);
  });

  it('the owner sets new prices; new quotes use them right away (integer paise only)', async () => {
    const s = await pairedShop(h, { colour: true, duplex: true });
    const owner = await pairDevice(h, s.shop.id, { role: 'OWNER' });

    await h
      .http()
      .put('/api/shop/pricing')
      .set(owner.opAuth)
      .send({ ...NEW_PRICES, monoRatePaise: 2.5 })
      .expect(400);
    await h
      .http()
      .put('/api/shop/pricing')
      .set(owner.opAuth)
      .send({ ...NEW_PRICES, colourRatePaise: 0 })
      .expect(400);

    const saved = (
      await h.http().put('/api/shop/pricing').set(owner.opAuth).send(NEW_PRICES).expect(200)
    ).body as ShopPricing;
    expect(saved).toMatchObject({ ...NEW_PRICES, colourAvailable: true, duplexAvailable: true });
    expect(
      await h.prisma.auditLog.count({
        where: { shopId: s.shop.id, action: 'pricing.version_created', actorType: 'STAFF' },
      }),
    ).toBe(1);

    // 4 pages double-sided B/W × 1 copy = 4 sides × ₹2.50; colour single-sided = 4 × ₹15.
    const quote = async (colour: boolean, duplex: boolean) => {
      const created: CreateOrderResponse = await createOrder(h, s.shop.id, {
        copies: 1,
        colour,
        duplex,
        paperSize: 'A4',
      });
      const res = await uploadPdf(h, created, await makePdf(4));
      expect(res.status).toBe(200);
      return (res.body as PublicOrder).quote!.totalPaise;
    };
    expect(await quote(false, true)).toBe(1000);
    expect(await quote(true, false)).toBe(6000);
    expect(await quote(false, false)).toBe(1200);

    // The public shop list shows the new rates too.
    const shops = (await h.http().get('/api/shops').expect(200)).body.shops as ShopSummary[];
    expect(shops.find((x) => x.id === s.shop.id)!.pricing).toMatchObject({
      monoRatePaise: 300,
      colourRatePaise: 1500,
    });
  });
});

describe('shop profile, QR and location', () => {
  it('profile gives the QR link and poster link; QR images are public and cross-origin', async () => {
    const s = await pairedShop(h);
    const profile = (await h.http().get('/api/shop/profile').set(s.auth).expect(200))
      .body as ShopProfile;
    expect(profile).toMatchObject({ shopId: s.shop.id, slug: s.shop.slug, location: null });
    expect(profile.orderUrl).toMatch(new RegExp(`/s/${s.shop.slug}$`));
    expect(profile.posterUrl).toBe(`${profile.orderUrl}/poster`);

    const png = await h.http().get(`/api/shops/${s.shop.slug}/qr.png?size=300`).expect(200);
    expect(png.headers['content-type']).toBe('image/png');
    expect(png.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect((png.body as Buffer).subarray(1, 4).toString()).toBe('PNG');

    const svg = await h.http().get(`/api/shops/${s.shop.slug}/qr.svg`).expect(200);
    expect(svg.headers['content-type']).toMatch(/^image\/svg\+xml/);

    await h.http().get('/api/shops/no-such-shop/qr.png').expect(404);
    await h.http().get('/api/shops/..%2Fadmin/qr.png').expect(404);
  });

  it('the owner sets the map position; it appears in the public shop list', async () => {
    const s = await pairedShop(h);
    const owner = await pairDevice(h, s.shop.id, { role: 'OWNER' });
    const where = { latitude: 12.5236, longitude: 76.8964 };

    const denied = await h
      .http()
      .put('/api/shop/profile/location')
      .set({ ...s.auth, ...s.operator })
      .send(where)
      .expect(403);
    expect(denied.body.error.code).toBe('OWNER_REQUIRED');
    await h
      .http()
      .put('/api/shop/profile/location')
      .set(owner.opAuth)
      .send({ latitude: 91, longitude: 0 })
      .expect(400);

    const profile = (
      await h.http().put('/api/shop/profile/location').set(owner.opAuth).send(where).expect(200)
    ).body as ShopProfile;
    expect(profile.location).toEqual(where);
    const shops = (await h.http().get('/api/shops').expect(200)).body.shops as ShopSummary[];
    expect(shops.find((x) => x.id === s.shop.id)!.location).toEqual(where);
  });
});
