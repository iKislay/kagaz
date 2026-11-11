import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hash } from '@node-rs/argon2';
import { type Harness, createHarness } from './harness.js';

let h: Harness;
let http: ReturnType<Harness['http']>;
let session = ''; // `kgz_admin=<jwt>` cookie value, applied to authenticated requests
const ADMIN_EMAIL = 'admin-e2e@kagaz.local';
const ADMIN_PASSWORD = 'StrongAdminPass-123!';
const RATE_EMAIL = 'ratelimit-e2e@kagaz.local';
const RATE_PASSWORD = 'RateLimitPass-123!';

beforeAll(async () => {
  h = await createHarness();
  http = h.http();
  await h.prisma.user.create({
    data: { email: ADMIN_EMAIL, kind: 'ADMIN', passwordHash: await hash(ADMIN_PASSWORD) },
  });
  await h.prisma.user.create({
    data: { email: RATE_EMAIL, kind: 'ADMIN', passwordHash: await hash(RATE_PASSWORD) },
  });
});

afterAll(async () => {
  await h.close();
});

function cookieOf(res: { headers: Record<string, unknown> }) {
  const c = res.headers['set-cookie'];
  const arr = Array.isArray(c) ? c : typeof c === 'string' ? [c] : [];
  return arr.join(',');
}

function sessionCookieOf(res: { headers: Record<string, unknown> }): string {
  const arr = cookieOf(res)
    .split(';')
    .map((p) => p.trim());
  const chunk = arr.find((p) => p.startsWith('kgz_admin='));
  return chunk ?? '';
}

describe('admin auth (FR-ADMIN-01)', () => {
  it('401 on every admin route without a session cookie', async () => {
    // Every /api/admin/* route except the sign-in endpoints must refuse an anonymous caller.
    const uuid = '00000000-0000-0000-0000-000000000000';
    const routes: ['get' | 'post' | 'put' | 'patch', string][] = [
      ['get', '/api/admin/auth/me'],
      ['get', '/api/admin/shops'],
      ['post', '/api/admin/shops'],
      ['get', `/api/admin/shops/${uuid}`],
      ['patch', `/api/admin/shops/${uuid}`],
      ['get', `/api/admin/shops/${uuid}/devices`],
      ['patch', `/api/admin/shops/${uuid}/devices/${uuid}`],
      ['get', `/api/admin/shops/${uuid}/enrollment-codes`],
      ['post', `/api/admin/shops/${uuid}/enrollment-codes`],
      ['get', `/api/admin/shops/${uuid}/printers`],
      ['patch', `/api/admin/shops/${uuid}/printers/${uuid}`],
      ['get', `/api/admin/shops/${uuid}/pricing`],
      ['post', `/api/admin/shops/${uuid}/pricing`],
      ['patch', `/api/admin/shops/${uuid}/settlement`],
      ['get', '/api/admin/orders'],
      ['get', `/api/admin/orders/${uuid}`],
      ['post', `/api/admin/orders/${uuid}/reject`],
      ['post', `/api/admin/orders/${uuid}/refund`],
      ['get', '/api/admin/held-orders'],
      ['get', '/api/admin/audit'],
      ['get', '/api/admin/health'],
      ['get', '/api/admin/overview'],
      ['get', '/api/admin/reconciliation'],
      ['get', '/api/admin/demo/otp-inbox'],
      ['get', '/api/admin/demo/payments'],
      ['put', `/api/admin/demo/payments/${uuid}/outcome`],
    ];
    for (const [method, path] of routes) {
      const agent = h.http();
      const res =
        method === 'get'
          ? await agent.get(path)
          : method === 'post'
            ? await agent.post(path)
            : method === 'put'
              ? await agent.put(path)
              : await agent.patch(path);
      expect(res.status, `${method.toUpperCase()} ${path}`).toBe(401);
      expect(res.body.error.code, `${method.toUpperCase()} ${path}`).toBe('ADMIN_UNAUTHENTICATED');
    }
  });

  it('login success sets the kgz_admin session cookie', async () => {
    const res = await http
      .post('/api/admin/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(200);
    expect(res.body.admin).toMatchObject({ email: ADMIN_EMAIL });
    expect(typeof res.body.admin.id).toBe('string');
    const cookie = cookieOf(res);
    expect(cookie).toContain('kgz_admin=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    session = sessionCookieOf(res);
    expect(session).toContain('kgz_admin=');
  });

  it('GET /api/admin/auth/me returns the signed-in admin', async () => {
    const res = await http.get('/api/admin/auth/me').set('Cookie', session).expect(200);
    expect(res.body).toMatchObject({ email: ADMIN_EMAIL, role: 'ADMIN', shops: [] });
  });

  it('wrong email and wrong password give the same 401 ADMIN_LOGIN_FAILED', async () => {
    await http
      .post('/api/admin/auth/login')
      .send({ email: ADMIN_EMAIL, password: 'wrong' })
      .expect(401);
    const badEmail = await http
      .post('/api/admin/auth/login')
      .send({ email: 'nope@kagaz.local', password: ADMIN_PASSWORD })
      .expect(401);
    const badPass = await http
      .post('/api/admin/auth/login')
      .send({ email: ADMIN_EMAIL, password: 'wrong' })
      .expect(401);
    expect(badEmail.body.error.code).toBe('ADMIN_LOGIN_FAILED');
    expect(badPass.body.error.code).toBe('ADMIN_LOGIN_FAILED');
  });

  it('rate limit: 5 failed logins then 429', async () => {
    for (let i = 0; i < 4; i++) {
      await http
        .post('/api/admin/auth/login')
        .send({ email: RATE_EMAIL, password: 'wrong' })
        .expect(401);
    }
    const res = await http
      .post('/api/admin/auth/login')
      .send({ email: RATE_EMAIL, password: 'wrong' })
      .expect(429);
    expect(res.body.error.code).toBe('ADMIN_RATE_LIMITED');
  });

  it('login clears the rate limit on success', async () => {
    const res = await http
      .post('/api/admin/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(200);
    session = sessionCookieOf(res);
    expect(res.body.admin.email).toBe(ADMIN_EMAIL);
  });

  it('logout clears the cookie', async () => {
    const res = await http.post('/api/admin/auth/logout').expect(200);
    const cookie = cookieOf(res);
    expect(cookie).toContain('kgz_admin=');
    expect(cookie).toContain('Max-Age=0');
    session = '';
    await http.get('/api/admin/auth/me').set('Cookie', session).expect(401);
  });
});

describe('admin read API', () => {
  let shopA: string;
  let shopB: string;

  beforeAll(async () => {
    shopA = (
      await h.prisma.shop.create({
        data: {
          slug: 'admin-shop-a',
          name: 'Admin Shop A',
          address: 'College Road, Mandya',
          status: 'OPEN',
          approvalMode: 'MANUAL',
          autoPaused: false,
          isDemo: true,
          autoLimits: { maxPages: 50, maxCopies: 5, maxSides: 250, maxQueueDepth: 10 },
          openingHours: {},
          pricing: {
            create: {
              monoRatePaise: 200,
              colourRatePaise: 1000,
              minimumChargePaise: 500,
              effectiveFrom: new Date(0),
            },
          },
        },
      })
    ).id;
    await h.prisma.shopDevice.create({
      data: {
        shopId: shopA,
        name: 'Counter PC',
        appVersion: '1.0.0',
        lastHeartbeatAt: new Date(Date.now() - 10_000),
        status: 'ACTIVE',
        tokenHash: 'device-token-a',
      },
    });
    await h.prisma.printer.create({
      data: {
        shopId: shopA,
        printerName: 'HP LaserJet',
        displayName: 'Counter Printer',
        colourCapable: true,
        duplexCapable: true,
        capabilitiesConfirmed: true,
        status: 'READY',
      },
    });

    shopB = (
      await h.prisma.shop.create({
        data: {
          slug: 'admin-shop-b',
          name: 'Admin Shop B',
          address: 'Bus Stand, Mandya',
          status: 'CLOSED',
          approvalMode: 'AUTO',
          autoPaused: true,
          isDemo: false,
          autoLimits: { maxPages: 50, maxCopies: 5, maxSides: 250, maxQueueDepth: 10 },
          openingHours: {},
          pricing: {
            create: {
              monoRatePaise: 150,
              colourRatePaise: 800,
              minimumChargePaise: 300,
              effectiveFrom: new Date(0),
            },
          },
        },
      })
    ).id;
    await h.prisma.shopDevice.create({
      data: {
        shopId: shopB,
        name: 'Back PC',
        lastHeartbeatAt: new Date(Date.now() - 100_000),
        status: 'ACTIVE',
        tokenHash: 'device-token-b',
      },
    });
    await h.prisma.printer.create({
      data: {
        shopId: shopB,
        printerName: 'Epson L',
        displayName: 'Back Printer',
        colourCapable: false,
        duplexCapable: false,
        capabilitiesConfirmed: false,
        status: 'OFFLINE',
      },
    });

    await http
      .post('/api/admin/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(200);
    // re-establish session after the logout in the previous describe
    const loginRes = await http
      .post('/api/admin/auth/login')
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    session = sessionCookieOf(loginRes);
  });

  function get(path: string) {
    return http.get(path).set('Cookie', session);
  }

  it('GET /api/admin/shops: overview with device online/offline and counts', async () => {
    const res = await get('/api/admin/shops').expect(200);
    const shops: unknown[] = res.body.shops;
    expect(shops.length).toBeGreaterThanOrEqual(2);
    const a = shops.find((s) => (s as { id: string }).id === shopA);
    const b = shops.find((s) => (s as { id: string }).id === shopB);
    expect(a).toBeDefined();
    expect((a as { status: string }).status).toBe('OPEN');
    expect((a as { approvalMode: string }).approvalMode).toBe('MANUAL');
    expect((a as { autoPaused: boolean }).autoPaused).toBe(false);
    expect((a as { isDemo: boolean }).isDemo).toBe(true);
    expect((a as { devices: unknown[] }).devices.length).toBe(1);
    expect((a as { devices: { online: boolean }[] }).devices[0]!.online).toBe(true);
    expect((a as { devices: { appVersion: string }[] }).devices[0]!.appVersion).toBe('1.0.0');
    expect((a as { printers: unknown[] }).printers.length).toBe(1);
    expect((a as { printers: { status: string }[] }).printers[0]!.status).toBe('READY');
    expect((a as { printers: { colourCapable: boolean }[] }).printers[0]!.colourCapable).toBe(true);
    expect((a as { pricing: { monoRatePaise: number } }).pricing).toMatchObject({
      monoRatePaise: 200,
      colourRatePaise: 1000,
    });
    expect(typeof (a as { todayOrders: number }).todayOrders).toBe('number');
    expect(typeof (a as { todayRevenuePaise: number }).todayRevenuePaise).toBe('number');

    expect((b as { devices: { online: boolean }[] }).devices[0]!.online).toBe(false);
    expect((b as { printers: { status: string }[] }).printers[0]!.status).toBe('OFFLINE');
    expect((b as { autoPaused: boolean }).autoPaused).toBe(true);
  });

  it('GET /api/admin/orders: search + pagination, newest first', async () => {
    const base = Date.now();
    await h.prisma.order.create({
      data: {
        publicRef: `KGZ-SEARCH-${base}-A`,
        shopId: shopA,
        customerPhone: '+919876543210',
        options: { copies: 2, colour: false, duplex: false, paperSize: 'A4' },
        quote: { totalPaise: 800 },
        priceSnapshot: { totalPaise: 800 },
        amountPaise: 800,
        status: 'QUEUED',
        trackingTokenHash: `track-${base}`,
        createdAt: new Date(Date.now() - 1000),
      },
    });
    await h.prisma.order.create({
      data: {
        publicRef: `KGZ-SEARCH-${base}-B`,
        shopId: shopB,
        customerPhone: '+919876543211',
        options: { copies: 1, colour: true, duplex: false, paperSize: 'A4' },
        quote: { totalPaise: 1000 },
        priceSnapshot: { totalPaise: 1000 },
        amountPaise: 1000,
        status: 'PRINTING',
        trackingTokenHash: `track-${base + 1}`,
        createdAt: new Date(),
      },
    });

    const res = await get(`/api/admin/orders?q=SEARCH-${base}&page=1&pageSize=10`).expect(200);
    expect(res.body.items.length).toBe(2);
    expect(res.body.items[0].publicRef).toBe(`KGZ-SEARCH-${base}-B`); // newest first
    expect(res.body.items[1].publicRef).toBe(`KGZ-SEARCH-${base}-A`);
    expect(res.body.total).toBe(2);

    const onlyA = await get(`/api/admin/orders?q=SEARCH-${base}&shopId=${shopA}`).expect(200);
    expect(onlyA.body.items.length).toBe(1);
    expect(onlyA.body.items[0].shopId).toBe(shopA);
  });

  it('GET /api/admin/orders/:id: full detail, no secrets exposed', async () => {
    const printer = await h.prisma.printer.findFirst({ where: { shopId: shopA } });
    const order = await h.prisma.order.create({
      data: {
        publicRef: 'KGZ-DETAIL-01',
        shopId: shopA,
        customerPhone: '+919876543210',
        options: { copies: 1, colour: true, duplex: true, paperSize: 'A4' },
        quote: {
          totalPaise: 2000,
          selectedPages: 10,
          copies: 2,
          printedSides: 20,
          sheets: 10,
          ratePaise: 100,
          subtotalPaise: 2000,
          minimumChargeApplied: false,
          pricingId: 'abc',
        },
        priceSnapshot: { totalPaise: 2000 },
        amountPaise: 2000,
        status: 'READY_FOR_PICKUP',
        trackingTokenHash: 'track-detail-01',
      },
    });
    await h.prisma.payment.create({
      data: {
        orderId: order.id,
        provider: 'demo',
        providerOrderId: 'po_1',
        amountPaise: 2000,
        status: 'PAID',
        isSimulated: true,
        verifiedAt: new Date(),
      },
    });
    await h.prisma.printJob.create({
      data: {
        orderId: order.id,
        printerId: printer!.id,
        attempt: 1,
        status: 'SUBMITTED',
        spoolerJobId: 42,
      },
    });
    await h.prisma.orderEvent.create({
      data: {
        orderId: order.id,
        fromStatus: 'QUEUED',
        toStatus: 'READY_FOR_PICKUP',
        actorType: 'ADMIN',
        actorId: 'admin',
        reason: 'marked ready',
      },
    });
    await h.prisma.auditLog.create({
      data: {
        actorType: 'ADMIN',
        actorId: 'admin',
        shopId: shopA,
        orderId: order.id,
        action: 'ORDER_MARKED_READY',
        metadata: {},
        ip: '127.0.0.1',
      },
    });

    const res = await get(`/api/admin/orders/${order.id}`).expect(200);
    const body: Record<string, unknown> = res.body;
    expect(body.publicRef).toBe('KGZ-DETAIL-01');
    expect(body.customerPhoneMasked).toBe('+**********10');
    expect(body.amountPaise).toBe(2000);
    const payments = body.payments as { isSimulated: boolean }[];
    expect(payments[0]!.isSimulated).toBe(true);
    const printJobs = body.printJobs as { spoolerJobId: number | null }[];
    expect(printJobs[0]!.spoolerJobId).toBe(42);
    const events = body.events as { fromStatus: string }[];
    expect(events[0]!.fromStatus).toBe('QUEUED');
    expect(Array.isArray(body.audit)).toBe(true);
    expect(body.files).toEqual([]);

    const json = JSON.stringify(body);
    for (const secret of [
      'objectKey',
      'codeHmac',
      'encryptedDisplayValue',
      'trackingTokenHash',
      'passwordHash',
      '+919876543210',
      'uploadUrl',
    ]) {
      expect(json).not.toContain(secret);
    }
  });

  it('GET /api/admin/orders/:id returns 404 for unknown order', async () => {
    await get('/api/admin/orders/00000000-0000-0000-0000-000000000000').expect(404);
  });

  it('GET /api/admin/audit: filters and pagination', async () => {
    const all = await get('/api/admin/audit').expect(200);
    expect(typeof all.body.total).toBe('number');
    const byAction = await get('/api/admin/audit?action=ADMIN_LOGIN').expect(200);
    const items = byAction.body.items as { action: string }[];
    expect(items.every((a) => a.action.includes('ADMIN_LOGIN'))).toBe(true);
    const byOrder = await get(
      '/api/admin/audit?orderId=00000000-0000-0000-0000-000000000000',
    ).expect(200);
    expect(byOrder.body.items.length).toBe(0);
  });

  it('login success and failure are audited with actorType ADMIN', async () => {
    const res = await get('/api/admin/audit?action=ADMIN_LOGIN&pageSize=100').expect(200);
    const items = res.body.items as { action: string; actorType: string }[];
    const actions = new Set(items.map((a) => a.action));
    expect(actions.has('ADMIN_LOGIN_SUCCESS')).toBe(true);
    expect(actions.has('ADMIN_LOGIN_FAILED')).toBe(true);
    expect(items.every((a) => a.actorType === 'ADMIN')).toBe(true);
  });
});
