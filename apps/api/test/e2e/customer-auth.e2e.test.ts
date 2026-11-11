import { randomInt } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CreateOrderResponse, type DemoOtpInbox, type MyOrdersResponse } from '@kagaz/shared';
import { makePdf } from '../fixtures/pdfs.js';
import {
  MONO,
  type Harness,
  createHarness,
  createOrder,
  createShop,
  uploadPdf,
} from './harness.js';
import { adminCookie, cookieFrom } from './pay-helpers.js';

let h: Harness;
let admin: string;
beforeAll(async () => {
  h = await createHarness();
  admin = await adminCookie(h);
});
afterAll(async () => {
  await h.close();
});

const newPhone = () => `+9198${String(randomInt(0, 100_000_000)).padStart(8, '0')}`;

async function latestCode(phone: string): Promise<string> {
  const inbox = (await h.http().get('/api/admin/demo/otp-inbox').set('Cookie', admin).expect(200))
    .body as DemoOtpInbox;
  const hit = inbox.items.find((i) => i.phone.endsWith(phone.slice(-4)));
  if (!hit) throw new Error('no OTP in inbox');
  return hit.code;
}

async function signIn(phone: string): Promise<string> {
  const req = await h.http().post('/api/auth/otp/request').send({ phone }).expect(200);
  expect(req.body).toMatchObject({ demo: true, expiresInSeconds: 300 });
  expect(req.body.sentTo).toBe(`+91******${phone.slice(-4)}`);
  // Resolve the code before building the next request (supertest binds a server eagerly).
  const code = await latestCode(phone);
  const res = await h.http().post('/api/auth/otp/verify').send({ phone, code }).expect(200);
  expect(res.body.customer.phone).toBe(phone);
  const cookie = cookieFrom(res, 'kagaz_session');
  expect(cookie).toBeTruthy();
  const setCookie = String(res.headers['set-cookie']);
  expect(setCookie).toMatch(/HttpOnly/i);
  expect(setCookie).toMatch(/SameSite=Lax/i);
  return cookie!;
}

describe('customer OTP sign-in (P2.2)', () => {
  it('signs in, links new orders, lists them and opens them without a tracking token', async () => {
    const phone = newPhone();
    const session = await signIn(phone);
    expect((await h.http().get('/api/me').set('Cookie', session).expect(200)).body).toMatchObject({
      customer: { phone },
    });

    const shop = await createShop(h.prisma);
    const created = (
      await h
        .http()
        .post('/api/orders')
        .set('Cookie', session)
        .send({ shopId: shop.id, options: MONO })
        .expect(201)
    ).body as CreateOrderResponse;
    expect((await uploadPdf(h, created, await makePdf(2))).status).toBe(200);
    const row = await h.prisma.order.findUniqueOrThrow({ where: { id: created.order.id } });
    expect(row.customerId).not.toBeNull();
    expect(row.customerPhone).toBe(phone);

    const mine = (await h.http().get('/api/me/orders').set('Cookie', session).expect(200))
      .body as MyOrdersResponse;
    expect(mine.orders.map((o) => o.id)).toEqual([created.order.id]);
    expect(mine.orders[0]).toMatchObject({
      status: 'AWAITING_PAYMENT',
      shopName: shop.name,
      pickupNumber: null, // ADR-002: no pickup code before payment
      pickupDate: null,
    });

    // Session works instead of the tracking token; tracking link still works too.
    await h.http().get(`/api/orders/${created.order.id}`).set('Cookie', session).expect(200);
    await h
      .http()
      .get(`/api/orders/${created.order.id}`)
      .set('x-tracking-token', created.trackingToken)
      .expect(200);

    // Another customer's session can't see it (404, not 403).
    const other = await signIn(newPhone());
    await h.http().get(`/api/orders/${created.order.id}`).set('Cookie', other).expect(404);
    expect(
      (
        (await h.http().get('/api/me/orders').set('Cookie', other).expect(200))
          .body as MyOrdersResponse
      ).orders,
    ).toEqual([]);
  });

  it('guest orders placed with the verified phone are linked on sign-in', async () => {
    const phone = newPhone();
    const shop = await createShop(h.prisma);
    const guest = (
      await h
        .http()
        .post('/api/orders')
        .send({ shopId: shop.id, options: MONO, customerPhone: phone })
        .expect(201)
    ).body as CreateOrderResponse;
    expect((await uploadPdf(h, guest, await makePdf(1))).status).toBe(200);
    const session = await signIn(phone);
    const mine = (await h.http().get('/api/me/orders').set('Cookie', session).expect(200))
      .body as MyOrdersResponse;
    expect(mine.orders.map((o) => o.id)).toContain(guest.order.id);
  });

  it('without a session: /me is null, /me/orders is 401, guest orders unaffected', async () => {
    expect((await h.http().get('/api/me').expect(200)).body).toEqual({ customer: null });
    const res = await h.http().get('/api/me/orders').expect(401);
    expect(res.body.error.code).toBe('SIGN_IN_REQUIRED');
    await h
      .http()
      .get('/api/me')
      .set('Cookie', 'kagaz_session=not-a-jwt')
      .expect(200)
      .expect({ customer: null });
    const shop = await createShop(h.prisma);
    const guest = await createOrder(h, shop.id);
    expect(guest.order.status).toBe('DRAFT');
  });

  it('codes are one-time, wrong codes lock the code after 5 tries (brute force)', async () => {
    const phone = newPhone();
    await h.http().post('/api/auth/otp/request').send({ phone }).expect(200);
    const code = await latestCode(phone);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      const r = await h
        .http()
        .post('/api/auth/otp/verify')
        .send({ phone, code: wrong })
        .expect(400);
      expect(r.body.error.code).toBe('OTP_INVALID');
    }
    const locked = await h.http().post('/api/auth/otp/verify').send({ phone, code }).expect(429);
    expect(locked.body.error.code).toBe('OTP_LOCKED');
    expect(
      await h.prisma.auditLog.count({ where: { action: 'customer.otp_locked' } }),
    ).toBeGreaterThan(0);
  });

  it('a used code cannot be replayed', async () => {
    const phone = newPhone();
    await h.http().post('/api/auth/otp/request').send({ phone }).expect(200);
    const code = await latestCode(phone);
    await h.http().post('/api/auth/otp/verify').send({ phone, code }).expect(200);
    const again = await h.http().post('/api/auth/otp/verify').send({ phone, code }).expect(400);
    expect(again.body.error.code).toBe('OTP_INVALID');
  });

  it('requests are rate-limited per phone (resend cooldown)', async () => {
    const phone = newPhone();
    await h.http().post('/api/auth/otp/request').send({ phone }).expect(200);
    const res = await h.http().post('/api/auth/otp/request').send({ phone }).expect(429);
    expect(res.body.error.code).toBe('OTP_RESEND_TOO_SOON');
    // Three codes in the window, even when spaced out, then OTP_RATE_LIMITED.
    await h.prisma.otpChallenge.updateMany({
      where: { phone },
      data: { createdAt: new Date(Date.now() - 60_000) },
    });
    await h.http().post('/api/auth/otp/request').send({ phone }).expect(200);
    await h.prisma.otpChallenge.updateMany({
      where: { phone },
      data: { createdAt: new Date(Date.now() - 60_000) },
    });
    await h.http().post('/api/auth/otp/request').send({ phone }).expect(200);
    await h.prisma.otpChallenge.updateMany({
      where: { phone },
      data: { createdAt: new Date(Date.now() - 60_000) },
    });
    const limited = await h.http().post('/api/auth/otp/request').send({ phone }).expect(429);
    expect(limited.body.error.code).toBe('OTP_RATE_LIMITED');
  });

  it('rejects malformed phones and codes; inbox needs an admin', async () => {
    await h.http().post('/api/auth/otp/request').send({ phone: '12345' }).expect(400);
    await h
      .http()
      .post('/api/auth/otp/verify')
      .send({ phone: newPhone(), code: '12ab56' })
      .expect(400);
    await h.http().get('/api/admin/demo/otp-inbox').expect(401);
  });

  it('logout clears the session cookie', async () => {
    const res = await h.http().post('/api/auth/logout').expect(200);
    expect(String(res.headers['set-cookie'])).toMatch(/kagaz_session=;/);
  });
});
