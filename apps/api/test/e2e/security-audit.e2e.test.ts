/**
 * Regression tests for the 2026-11-24 security audit (docs/security/SECURITY_AUDIT_2026-11-24.md).
 * Each `describe` names the finding it covers.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type UploadUrlResponse } from '@kagaz/shared';
import { randomCode } from '../../src/common/crypto/tokens.js';
import { StorageService } from '../../src/modules/files/storage.service.js';
import { hashPassword, verifyPassword } from '../../src/modules/identity/passwords.js';
import { makePdf } from '../fixtures/pdfs.js';
import { MONO, type Harness, createHarness, createOrder, createShop } from './harness.js';
import { paidOrder, pairedShop } from './shop-helpers.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});

const randomMobile = () => `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;

function uploadUrl(created: { order: { id: string }; trackingToken: string }, bytes: number) {
  return h
    .http()
    .post(`/api/orders/${created.order.id}/upload-url`)
    .set('x-tracking-token', created.trackingToken)
    .send({ bytes });
}

async function put(upload: UploadUrlResponse, pdf: Buffer) {
  const res = await fetch(upload.uploadUrl, {
    method: 'PUT',
    headers: upload.headers,
    body: new Uint8Array(pdf),
  });
  return res.status;
}

/** Same byte length, different page count: pads the smaller PDF with a trailing comment. */
async function sameSizePdfs(smallPages: number, bigPages: number): Promise<[Buffer, Buffer]> {
  const small = await makePdf(smallPages);
  const big = await makePdf(bigPages);
  const pad = (b: Buffer, len: number) =>
    Buffer.concat([b, Buffer.from(`\n%${'x'.repeat(Math.max(0, len - b.length - 2))}`)]);
  const len = Math.max(small.length, big.length) + 4;
  return [pad(small, len), pad(big, len)];
}

describe('H-1: a validated upload cannot be swapped through its signed URL', () => {
  it('re-PUT after upload-complete changes neither the priced file nor the print packet', async () => {
    const s = await pairedShop(h);
    const created = await createOrder(h, s.shop.id, MONO);
    const [onePage, manyPages] = await sameSizePdfs(1, 40);
    expect(onePage.length).toBe(manyPages.length);

    const upload = (await uploadUrl(created, onePage.length).expect(200)).body as UploadUrlResponse;
    expect(await put(upload, onePage)).toBe(200);
    const done = await h
      .http()
      .post(`/api/orders/${created.order.id}/upload-complete`)
      .set('x-tracking-token', created.trackingToken)
      .send({ fileId: upload.fileId })
      .expect(200);
    expect(done.body.quote).toMatchObject({ printedSides: 1, totalPaise: 500 });

    // The attack: the signed PUT URL is still valid for minutes. Overwrite with 40 pages.
    await put(upload, manyPages); // staging key: accepted or not, it must not matter

    const file = await h.prisma.fileAsset.findFirstOrThrow({
      where: { orderId: created.order.id, kind: 'ORIGINAL', status: 'VALID' },
    });
    expect(file.objectKey).toMatch(/^orders\/[0-9a-f-]+\/original\/[0-9a-f-]+\.pdf$/);
    expect(upload.uploadUrl).not.toContain(file.objectKey);

    await h
      .http()
      .post(`/api/orders/${created.order.id}/pay`)
      .set('x-tracking-token', created.trackingToken)
      .expect(200);
    const job = await s.human(`jobs/${created.order.id}/accept`).expect(200);
    const packet = await h.prisma.fileAsset.findFirstOrThrow({
      where: { orderId: created.order.id, kind: 'PACKET' },
    });
    expect(job.body.status).toBe('QUEUED');
    expect(packet.pageCount).toBe(2); // 1 customer page + the pickup slip — never 41
  });

  it('accept refuses a source whose bytes no longer match the validated checksum', async () => {
    const s = await pairedShop(h);
    const created = await paidOrder(h, s.shop.id, 1);
    const file = await h.prisma.fileAsset.findFirstOrThrow({
      where: { orderId: created.order.id, kind: 'ORIGINAL', status: 'VALID' },
    });
    // Simulate tampering in storage (or a regression that reads a customer-writable key).
    await h.app.get(StorageService).put(file.objectKey, await makePdf(30), 'application/pdf');
    const res = await s.human(`jobs/${created.order.id}/accept`).expect(409);
    expect(res.body.error.code).toBe('FILE_CHANGED');
  });

  it('the staging object and superseded originals are deleted (security review L3)', async () => {
    const shop = await createShop(h.prisma);
    // pageRange "2" can't be quoted for a 1-page file, so the order stays a DRAFT and a second
    // upload supersedes the first (valid) one.
    const created = await createOrder(h, shop.id, { ...MONO, pageRange: '2' });
    const storage = h.app.get(StorageService);
    const keys: string[] = [];
    for (const [pages, status] of [
      [1, 400],
      [2, 200],
    ] as const) {
      const pdf = await makePdf(pages);
      const upload = (await uploadUrl(created, pdf.length).expect(200)).body as UploadUrlResponse;
      expect(await put(upload, pdf)).toBe(200);
      const staging = await h.prisma.fileAsset.findUniqueOrThrow({ where: { id: upload.fileId } });
      await h
        .http()
        .post(`/api/orders/${created.order.id}/upload-complete`)
        .set('x-tracking-token', created.trackingToken)
        .send({ fileId: upload.fileId })
        .expect(status);
      expect(await storage.head(staging.objectKey)).toBeNull(); // staging copy gone
      const validated = await h.prisma.fileAsset.findUniqueOrThrow({
        where: { id: upload.fileId },
      });
      keys.push(validated.objectKey);
    }
    expect(await storage.head(keys[0]!)).toBeNull(); // superseded original deleted
    expect(await storage.head(keys[1]!)).not.toBeNull(); // current one kept
  });
});

describe('H-2: a shop cannot open itself without Kaggaz activation', () => {
  it('PATCH /shop/mode {status: OPEN} needs a current subscription; closing never does', async () => {
    const s = await pairedShop(h);
    await h.prisma.shop.update({ where: { id: s.shop.id }, data: { status: 'CLOSED' } });
    const mode = (body: object) =>
      h
        .http()
        .patch('/api/shop/mode')
        .set({ ...s.auth, ...s.operator })
        .send(body);

    const refused = await mode({ status: 'OPEN' }).expect(409);
    expect(refused.body.error.code).toBe('SUBSCRIPTION_INACTIVE');
    expect((await h.prisma.shop.findUniqueOrThrow({ where: { id: s.shop.id } })).status).toBe(
      'CLOSED',
    );
    await mode({ status: 'MAINTENANCE' }).expect(200);

    const now = Date.now();
    await h.prisma.subscription.create({
      data: {
        shopId: s.shop.id,
        printerSeats: 1,
        pricePerPrinterPaise: 50_000,
        months: 1,
        totalPaise: 50_000,
        periodStart: new Date(now - 86_400_000),
        periodEnd: new Date(now + 29 * 86_400_000),
      },
    });
    expect((await mode({ status: 'OPEN' }).expect(200)).body.status).toBe('OPEN');
    await mode({ status: 'CLOSED' }).expect(200);
  });

  it('a self-signed-up shop stays closed to customers', async () => {
    const mobile = randomMobile();
    const res = await h
      .http()
      .post('/api/shop/signup')
      .send({
        shopName: 'Totally Official Kaggaz Print',
        ownerName: 'Mallory',
        phone: mobile,
        password: 'mallory-pass-123',
        deviceName: 'PC',
      })
      .expect(201);
    const auth = { Authorization: `Bearer ${res.body.deviceToken as string}` };
    const login = await h
      .http()
      .post('/api/shop/operator/login')
      .set(auth)
      .send({ login: mobile, password: 'mallory-pass-123' })
      .expect(200);
    await h
      .http()
      .patch('/api/shop/mode')
      .set({ ...auth, 'X-Operator-Token': login.body.operatorToken as string })
      .send({ status: 'OPEN' })
      .expect(409);
    const shops = (await h.http().get('/api/shops').expect(200)).body as {
      id: string;
      acceptingOrders: boolean;
    }[];
    expect(shops.find((x) => x.id === res.body.shop.id)?.acceptingOrders).toBe(false);
    await h
      .http()
      .post('/api/orders')
      .send({ shopId: res.body.shop.id, options: MONO })
      .expect(409);
  });
});

describe('M-3: shop sign-up never takes over an existing login', () => {
  it('refuses a phone that already has a password (e.g. a removed operator)', async () => {
    const phone = `+91${randomMobile()}`;
    const original = await hashPassword('operators-own-password');
    const user = await h.prisma.user.create({
      data: { phone, name: 'Former operator', kind: 'STAFF', passwordHash: original },
    });
    const res = await h
      .http()
      .post('/api/shop/signup')
      .send({
        shopName: 'Squatter Prints',
        ownerName: 'Mallory',
        phone: phone.slice(3),
        password: 'attacker-chosen-pass',
        deviceName: 'PC',
      })
      .expect(409);
    expect(res.body.error.code).toBe('PHONE_IN_USE');
    const after = await h.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await verifyPassword(after.passwordHash, 'operators-own-password')).toBe(true);
    expect(await verifyPassword(after.passwordHash, 'attacker-chosen-pass')).toBe(false);
  });
});

describe('M-1: order creation and uploads are throttled', () => {
  it('caps upload URLs per order', async () => {
    const shop = await createShop(h.prisma);
    const created = await createOrder(h, shop.id, MONO);
    for (let i = 0; i < 10; i++) await uploadUrl(created, 1000).expect(200);
    const res = await uploadUrl(created, 1000).expect(429);
    expect(res.body.error.code).toBe('UPLOAD_LIMIT');
  });

  it('limits new orders per client IP', async () => {
    const prev = process.env.ORDER_CREATE_LIMIT_PER_IP_HOUR;
    process.env.ORDER_CREATE_LIMIT_PER_IP_HOUR = '3';
    const limited = await createHarness();
    try {
      const shop = await createShop(limited.prisma);
      const create = () =>
        limited.http().post('/api/orders').send({ shopId: shop.id, options: MONO });
      for (let i = 0; i < 3; i++) await create().expect(201);
      const res = await create().expect(429);
      expect(res.body.error.code).toBe('RATE_LIMITED');
    } finally {
      process.env.ORDER_CREATE_LIMIT_PER_IP_HOUR = prev;
      await limited.close();
    }
  });
});

describe('M-2: unauthenticated invalid webhooks cannot flood the database', () => {
  it('records at most 20 invalid deliveries per IP per window, then 429 without a write', async () => {
    const marker = randomCode(12);
    const before = await h.prisma.webhookEvent.count({ where: { signatureValid: false } });
    const send = (i: number) =>
      h
        .http()
        .post('/api/webhooks/demo')
        .set('content-type', 'application/json')
        .set('x-demo-signature', 'a'.repeat(64))
        .send(JSON.stringify({ marker, i }));
    for (let i = 0; i < 20; i++) await send(i).expect(400);
    const res = await send(20).expect(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
    await send(21).expect(429);
    const after = await h.prisma.webhookEvent.count({ where: { signatureValid: false } });
    expect(after - before).toBe(20);
  });
});

describe('L-2: idempotency records never store signed URLs (security review L2)', () => {
  it('resolve with Idempotency-Key stores previewUrl as null', async () => {
    const s = await pairedShop(h);
    const created = await paidOrder(h, s.shop.id, 1);
    const job = await s.human(`jobs/${created.order.id}/accept`).expect(200);
    const printJobId = job.body.printJob.id as string;
    await s.agent(`print-jobs/${printJobId}/lease`).expect(200);
    await s.agent(`print-jobs/${printJobId}/status`, { status: 'UNCERTAIN' }).expect(200);
    const key = `resolve-${randomCode(10)}`;
    const first = await s
      .human(
        `jobs/${created.order.id}/resolve`,
        { action: 'CONFIRM_PRINTED' },
        { 'Idempotency-Key': key },
      )
      .expect(200);
    expect(typeof first.body.previewUrl).toBe('string');
    const record = await h.prisma.idempotencyRecord.findFirstOrThrow({ where: { key } });
    expect(JSON.stringify(record.responseBody)).not.toContain('X-Amz-Signature');
    expect((record.responseBody as { previewUrl: unknown }).previewUrl).toBeNull();
  });
});

describe('L-6: malformed order ids are 404, not 500', () => {
  it('a 36-character dash string never reaches the uuid cast', async () => {
    const id = '-'.repeat(36);
    await h.http().get(`/api/orders/${id}`).set('x-tracking-token', 'x'.repeat(43)).expect(404);
    await h.http().post(`/api/orders/${id}/pay`).set('x-tracking-token', 'x').expect(404);
  });
});

describe('L-5: staff login is limited per IP across logins (security review L5)', () => {
  it('20 failures from one IP with different logins → 429', async () => {
    const limited = await createHarness();
    try {
      for (let i = 0; i < 20; i++) {
        await limited
          .http()
          .post('/api/admin/auth/login')
          .send({ login: `nobody${i}@e2e.local`, password: 'wrong-password' })
          .expect(401);
      }
      const res = await limited
        .http()
        .post('/api/admin/auth/login')
        .send({ login: 'someone-else@e2e.local', password: 'wrong-password' })
        .expect(429);
      expect(res.body.error.code).toBe('RATE_LIMITED');
    } finally {
      await limited.close();
    }
  });
});
