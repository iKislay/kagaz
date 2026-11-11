import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type PublicOrder, type UploadUrlResponse } from '@kagaz/shared';
import { makeEncryptedPdf, makePdf } from '../fixtures/pdfs.js';
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

describe('shops', () => {
  it('GET /api/shops lists shops with pricing and capabilities', async () => {
    const shop = await createShop(h.prisma, { printer: true, colour: true });
    const res = await h.http().get('/api/shops').expect(200);
    const listed = (res.body.shops as Array<Record<string, unknown>>).find((s) => s.id === shop.id);
    expect(listed).toMatchObject({
      acceptingOrders: true,
      isDemo: true,
      capabilities: { colour: true, duplex: false },
      pricing: { monoRatePaise: 200, colourRatePaise: 1000, minimumChargePaise: 500 },
    });
  });
});

describe('order creation and tracking', () => {
  it('creates a DRAFT order with a tracking token and httpOnly cookie', async () => {
    const shop = await createShop(h.prisma);
    const res = await h
      .http()
      .post('/api/orders')
      .send({ shopId: shop.id, options: MONO })
      .expect(201);
    expect(res.body.order).toMatchObject({ status: 'DRAFT', quote: null });
    expect(res.body.order).toMatchObject({ pickupNumber: null, pickupDate: null });
    expect(res.body.order.publicRef).toMatch(/^KGZ-[A-HJ-NP-Z2-9]{6}$/);
    expect(res.body.trackingToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toContain(`kgz_t_${res.body.order.id}=`);
    expect(cookie).toContain('HttpOnly');
  });

  it('requires the tracking token (header or cookie); wrong token looks like not found', async () => {
    const shop = await createShop(h.prisma);
    const { order, trackingToken } = await createOrder(h, shop.id);
    await h.http().get(`/api/orders/${order.id}`).expect(404);
    await h.http().get(`/api/orders/${order.id}`).set('x-tracking-token', 'nope').expect(404);
    await h
      .http()
      .get(`/api/orders/${order.id}`)
      .set('x-tracking-token', trackingToken)
      .expect(200);
    await h
      .http()
      .get(`/api/orders/${order.id}`)
      .set('Cookie', `kgz_t_${order.id}=${trackingToken}`)
      .expect(200);
  });

  it('rejects unknown fields such as a client-sent amount (T03)', async () => {
    const shop = await createShop(h.prisma);
    const res = await h
      .http()
      .post('/api/orders')
      .send({ shopId: shop.id, options: MONO, amountPaise: 1 })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('blocks checkout at a closed shop', async () => {
    const shop = await createShop(h.prisma, { status: 'CLOSED' });
    const res = await h
      .http()
      .post('/api/orders')
      .send({ shopId: shop.id, options: MONO })
      .expect(409);
    expect(res.body.error.code).toBe('SHOP_UNAVAILABLE');
  });

  it('rejects colour/duplex the shop cannot print', async () => {
    const shop = await createShop(h.prisma, { printer: true, colour: false, duplex: true });
    const colour = await h
      .http()
      .post('/api/orders')
      .send({ shopId: shop.id, options: { ...MONO, colour: true } })
      .expect(422);
    expect(colour.body.error.code).toBe('OPTION_UNSUPPORTED');
    await h
      .http()
      .post('/api/orders')
      .send({ shopId: shop.id, options: { ...MONO, duplex: true } })
      .expect(201);
  });

  it('enforces the copies limit', async () => {
    const shop = await createShop(h.prisma);
    const res = await h
      .http()
      .post('/api/orders')
      .send({ shopId: shop.id, options: { ...MONO, copies: 21 } })
      .expect(422);
    expect(res.body.error.code).toBe('COPIES_LIMIT');
  });
});

describe('upload and validation (T01, T02, T03)', () => {
  it('validates a real PDF, records page count + checksum, quotes and awaits payment', async () => {
    const shop = await createShop(h.prisma);
    const created = await createOrder(h, shop.id, { ...MONO, copies: 2 });
    const res = await uploadPdf(h, created, await makePdf(12));
    expect(res.status).toBe(200);
    const order = res.body as PublicOrder;
    expect(order.status).toBe('AWAITING_PAYMENT');
    expect(order.file).toMatchObject({ pageCount: 12 });
    expect(order.quote).toMatchObject({ printedSides: 24, ratePaise: 200, totalPaise: 4800 });
    expect(order.amountPaise).toBe(4800);
    expect(order.timeline.map((e) => e.status)).toEqual(['DRAFT', 'AWAITING_PAYMENT']);

    const file = await h.prisma.fileAsset.findFirstOrThrow({
      where: { orderId: order.id, kind: 'ORIGINAL', status: 'VALID' },
    });
    expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(file.objectKey).toMatch(/^orders\/[0-9a-f-]+\/original\/[0-9a-f-]+\.pdf$/);

    // T01: the private object is not publicly readable.
    const anon = await fetch(
      `${process.env.S3_ENDPOINT}/${process.env.S3_BUCKET}/${file.objectKey}`,
    );
    expect(anon.status).toBe(403);
  });

  it('upload-complete is idempotent', async () => {
    const shop = await createShop(h.prisma);
    const created = await createOrder(h, shop.id);
    const pdf = await makePdf(1);
    const tok = { 'x-tracking-token': created.trackingToken };
    const urlRes = await h
      .http()
      .post(`/api/orders/${created.order.id}/upload-url`)
      .set(tok)
      .send({ bytes: pdf.length });
    const upload = urlRes.body as UploadUrlResponse;
    await fetch(upload.uploadUrl, {
      method: 'PUT',
      headers: upload.headers,
      body: new Uint8Array(pdf),
    });
    const path = `/api/orders/${created.order.id}/upload-complete`;
    await h.http().post(path).set(tok).send({ fileId: upload.fileId }).expect(200);
    const again = await h.http().post(path).set(tok).send({ fileId: upload.fileId }).expect(200);
    expect(again.body.status).toBe('AWAITING_PAYMENT');
    expect(again.body.timeline).toHaveLength(2);
  });

  it('rejects a password-protected PDF and deletes it; order stays DRAFT (T02)', async () => {
    const shop = await createShop(h.prisma);
    const created = await createOrder(h, shop.id);
    const res = await uploadPdf(h, created, makeEncryptedPdf());
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('FILE_ENCRYPTED');
    const file = await h.prisma.fileAsset.findFirstOrThrow({
      where: { orderId: created.order.id },
    });
    expect(file).toMatchObject({ status: 'INVALID', error: 'FILE_ENCRYPTED' });
    const order = await h
      .http()
      .get(`/api/orders/${created.order.id}`)
      .set('x-tracking-token', created.trackingToken);
    expect(order.body.status).toBe('DRAFT');
  });

  it('refuses an oversize upload before signing', async () => {
    const shop = await createShop(h.prisma);
    const created = await createOrder(h, shop.id);
    const res = await h
      .http()
      .post(`/api/orders/${created.order.id}/upload-url`)
      .set('x-tracking-token', created.trackingToken)
      .send({ bytes: 26_214_401 })
      .expect(413);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
  });

  it('the signed upload URL only accepts the declared size', async () => {
    const shop = await createShop(h.prisma);
    const created = await createOrder(h, shop.id);
    const pdf = await makePdf(2);
    const urlRes = await h
      .http()
      .post(`/api/orders/${created.order.id}/upload-url`)
      .set('x-tracking-token', created.trackingToken)
      .send({ bytes: pdf.length - 100 });
    const upload = urlRes.body as UploadUrlResponse;
    const put = await fetch(upload.uploadUrl, {
      method: 'PUT',
      headers: upload.headers,
      body: new Uint8Array(pdf),
    });
    expect(put.ok).toBe(false);
  });

  it('upload-complete without uploading reports FILE_MISSING', async () => {
    const shop = await createShop(h.prisma);
    const created = await createOrder(h, shop.id);
    const tok = { 'x-tracking-token': created.trackingToken };
    const urlRes = await h
      .http()
      .post(`/api/orders/${created.order.id}/upload-url`)
      .set(tok)
      .send({ bytes: 1000 });
    const res = await h
      .http()
      .post(`/api/orders/${created.order.id}/upload-complete`)
      .set(tok)
      .send({ fileId: urlRes.body.fileId })
      .expect(409);
    expect(res.body.error.code).toBe('FILE_MISSING');
  });
});

describe('options and re-quoting', () => {
  it('re-quotes on option change and validates the page range against the document', async () => {
    const shop = await createShop(h.prisma);
    const created = await createOrder(h, shop.id);
    await uploadPdf(h, created, await makePdf(10));
    const path = `/api/orders/${created.order.id}/options`;
    const tok = { 'x-tracking-token': created.trackingToken };

    const ranged = await h
      .http()
      .patch(path)
      .set(tok)
      .send({ options: { ...MONO, pageRange: '1-3,5', copies: 3 } })
      .expect(200);
    expect(ranged.body.quote).toMatchObject({
      selectedPages: 4,
      printedSides: 12,
      totalPaise: 2400,
    });

    const bad = await h
      .http()
      .patch(path)
      .set(tok)
      .send({ options: { ...MONO, pageRange: '11' } })
      .expect(400);
    expect(bad.body.error.code).toBe('PAGE_RANGE_INVALID');

    const min = await h
      .http()
      .patch(path)
      .set(tok)
      .send({ options: { ...MONO, pageRange: '1' } });
    expect(min.body.quote).toMatchObject({ minimumChargeApplied: true, totalPaise: 500 });
  });

  it('a draft whose page range was invalid advances once fixed', async () => {
    const shop = await createShop(h.prisma);
    const created = await createOrder(h, shop.id, { ...MONO, pageRange: '5-9' });
    const res = await uploadPdf(h, created, await makePdf(3));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PAGE_RANGE_INVALID');

    const fixed = await h
      .http()
      .patch(`/api/orders/${created.order.id}/options`)
      .set('x-tracking-token', created.trackingToken)
      .send({ options: { ...MONO, pageRange: '2-3' } })
      .expect(200);
    expect(fixed.body).toMatchObject({ status: 'AWAITING_PAYMENT', file: { pageCount: 3 } });
  });
});
