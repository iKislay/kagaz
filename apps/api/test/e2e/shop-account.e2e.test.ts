import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../../src/modules/identity/passwords.js';
import { type Harness, createHarness, createShop } from './harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});

const randomMobile = () => `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
const signupBody = (phone: string) => ({
  shopName: 'Raju Xerox & Prints',
  address: 'Near Bus Stand, Mandya',
  ownerName: 'Raju',
  phone,
  password: 'raju-pass-123',
  deviceName: 'Counter PC',
  appVersion: '0.4.0',
});

/** Sign-up from the app → device token, then the owner signs in on that PC with the mobile. */
async function signedUpOwner() {
  const mobile = randomMobile();
  const res = await h.http().post('/api/shop/signup').send(signupBody(mobile)).expect(201);
  const auth = { Authorization: `Bearer ${res.body.deviceToken as string}` };
  const login = await h
    .http()
    .post('/api/shop/operator/login')
    .set(auth)
    .send({ login: mobile, password: 'raju-pass-123' })
    .expect(200);
  return {
    mobile,
    shopId: res.body.shop.id as string,
    auth,
    ownerAuth: { ...auth, 'X-Operator-Token': login.body.operatorToken as string },
  };
}

describe('POST /api/shop/signup', () => {
  it('creates a CLOSED shop with default prices, the owner login and this PC; duplicates refused; 5/hour/IP', async () => {
    const mobile = randomMobile();
    // 1: created, typed with spaces and without +91.
    const res = await h
      .http()
      .post('/api/shop/signup')
      .send(signupBody(`${mobile.slice(0, 5)} ${mobile.slice(5)}`))
      .expect(201);
    expect(res.body).toMatchObject({
      deviceToken: expect.any(String),
      device: { name: 'Counter PC' },
      shop: { name: 'Raju Xerox & Prints', isDemo: false },
    });

    const shop = await h.prisma.shop.findUniqueOrThrow({
      where: { id: res.body.shop.id },
      include: { members: { include: { user: true } }, pricing: true, devices: true },
    });
    expect(shop).toMatchObject({ status: 'CLOSED', contactPhone: `+91${mobile}` });
    expect(shop.slug).toMatch(/^raju-xerox-prints-[a-z0-9]{4}$/);
    expect(shop.pricing).toEqual([
      expect.objectContaining({
        monoRatePaise: 200,
        colourRatePaise: 1000,
        minimumChargePaise: 500,
      }),
    ]);
    expect(shop.devices).toHaveLength(1);
    expect(shop.members).toEqual([
      expect.objectContaining({ role: 'OWNER', user: expect.objectContaining({ kind: 'STAFF' }) }),
    ]);
    const audit = await h.prisma.auditLog.findMany({ where: { shopId: shop.id } });
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(['shop.self_signup', 'device.enrolled_with_login']),
    );

    // The new device token works.
    await h
      .http()
      .post('/api/shop/heartbeat')
      .set({ Authorization: `Bearer ${res.body.deviceToken as string}` })
      .send({})
      .expect(200);

    // 2: same number again → refused.
    const dup = await h.http().post('/api/shop/signup').send(signupBody(mobile)).expect(409);
    expect(dup.body.error.code).toBe('PHONE_IN_USE');

    // 3: an admin's number → refused.
    const adminPhone = `+91${randomMobile()}`;
    await h.prisma.user.create({
      data: { phone: adminPhone, kind: 'ADMIN', passwordHash: await hashPassword('x'.repeat(12)) },
    });
    await h.http().post('/api/shop/signup').send(signupBody(adminPhone)).expect(409);

    // Invalid input → 400 (rejected before it counts toward the limit).
    await h.http().post('/api/shop/signup').send(signupBody('raju@shop.in')).expect(400);

    // 4 and 5 allowed; the 6th attempt within the hour is rate limited.
    await h.http().post('/api/shop/signup').send(signupBody(randomMobile())).expect(201);
    await h.http().post('/api/shop/signup').send(signupBody(randomMobile())).expect(201);
    const limited = await h
      .http()
      .post('/api/shop/signup')
      .send(signupBody(randomMobile()))
      .expect(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
  });
});

describe('owner flows from the app', () => {
  // The signup limiter is per app instance: give these tests their own app.
  let app: Harness;
  beforeAll(async () => {
    app = await createHarness();
  });
  afterAll(async () => {
    await app.close();
  });

  async function owner() {
    const prev = h;
    h = app;
    try {
      return await signedUpOwner();
    } finally {
      h = prev;
    }
  }

  it('enroll-with-login connects another PC for the owner only', async () => {
    const o = await owner();
    const ok = await app
      .http()
      .post('/api/shop/enroll-with-login')
      .send({ login: o.mobile, password: 'raju-pass-123', deviceName: 'Second PC' })
      .expect(201);
    expect(ok.body).toMatchObject({ device: { name: 'Second PC' }, shop: { id: o.shopId } });

    const wrong = await app
      .http()
      .post('/api/shop/enroll-with-login')
      .send({ login: o.mobile, password: 'nope-nope', deviceName: 'X' })
      .expect(401);
    expect(wrong.body.error.code).toBe('LOGIN_FAILED');

    // An operator (not owner) cannot connect a PC.
    const op = randomMobile();
    await app
      .http()
      .post('/api/shop/members')
      .set(o.ownerAuth)
      .send({ phone: op, name: 'Op', password: 'op-pass-123' })
      .expect(200);
    const notOwner = await app
      .http()
      .post('/api/shop/enroll-with-login')
      .send({ login: op, password: 'op-pass-123', deviceName: 'X' })
      .expect(403);
    expect(notOwner.body.error.code).toBe('NOT_SHOP_OWNER');

    // Owner of two shops must choose.
    const user = await app.prisma.user.findUniqueOrThrow({ where: { phone: `+91${o.mobile}` } });
    const second = await createShop(app.prisma);
    await app.prisma.shopUser.create({
      data: { shopId: second.id, userId: user.id, role: 'OWNER' },
    });
    const multi = await app
      .http()
      .post('/api/shop/enroll-with-login')
      .send({ login: o.mobile, password: 'raju-pass-123', deviceName: 'X' })
      .expect(409);
    expect(multi.body.error).toMatchObject({ code: 'MULTIPLE_SHOPS' });
    expect(multi.body.error.details.shops).toHaveLength(2);
    await app
      .http()
      .post('/api/shop/enroll-with-login')
      .send({ login: o.mobile, password: 'raju-pass-123', deviceName: 'X', shopId: second.id })
      .expect(201);
  });

  it('members: owner lists/adds/resets/removes operators; operators get OWNER_ONLY', async () => {
    const o = await owner();
    const list = await app.http().get('/api/shop/members').set(o.ownerAuth).expect(200);
    expect(list.body.members).toEqual([
      expect.objectContaining({ phone: `+91${o.mobile}`, role: 'OWNER' }),
    ]);

    const op = randomMobile();
    const added = await app
      .http()
      .post('/api/shop/members')
      .set(o.ownerAuth)
      .send({ phone: op, name: 'Op', password: 'op-pass-123' })
      .expect(200);
    expect(added.body.members).toHaveLength(2);
    const opId = (added.body.members as { userId: string; role: string }[]).find(
      (m) => m.role === 'OPERATOR',
    )!.userId;

    // The operator signs in on the PC; operator-only calls are refused.
    const opLogin = await app
      .http()
      .post('/api/shop/operator/login')
      .set(o.auth)
      .send({ login: op, password: 'op-pass-123' })
      .expect(200);
    const opAuth = { ...o.auth, 'X-Operator-Token': opLogin.body.operatorToken as string };
    const forbidden = await app.http().get('/api/shop/members').set(opAuth).expect(403);
    expect(forbidden.body.error.code).toBe('OWNER_ONLY');

    // The owner's own login can't be reset through this API.
    await app
      .http()
      .post('/api/shop/members')
      .set(o.ownerAuth)
      .send({ phone: o.mobile, name: 'X', password: 'xxxx-xxxx' })
      .expect(403);

    const removed = await app
      .http()
      .delete(`/api/shop/members/${opId}`)
      .set(o.ownerAuth)
      .expect(200);
    expect(removed.body.members).toHaveLength(1);
    // Their session on the PC ended.
    await app.http().get('/api/shop/members').set(opAuth).expect(401);
  });

  it('pricing: device reads, owner sets a new version effective now', async () => {
    const o = await owner();
    const current = await app.http().get('/api/shop/pricing').set(o.auth).expect(200);
    expect(current.body).toMatchObject({ monoRatePaise: 200, colourRatePaise: 1000 });

    const updated = await app
      .http()
      .put('/api/shop/pricing')
      .set(o.ownerAuth)
      .send({ monoRatePaise: 300, colourRatePaise: 1200, minimumChargePaise: 0 })
      .expect(200);
    expect(updated.body).toMatchObject({ monoRatePaise: 300, colourRatePaise: 1200 });

    await app
      .http()
      .put('/api/shop/pricing')
      .set(o.ownerAuth)
      .send({ monoRatePaise: 1.5, colourRatePaise: 1200 })
      .expect(400);
    await app
      .http()
      .put('/api/shop/pricing')
      .set(o.auth)
      .send({ monoRatePaise: 300, colourRatePaise: 1200 })
      .expect(401);
  });
});
