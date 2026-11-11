import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type CreateOrderResponse,
  type LeaseResponse,
  type PublicOrder,
  type ShopJob,
  formatPickupDate,
} from '@kagaz/shared';
import { randomCode, sha256Hex } from '../../src/common/crypto/tokens.js';
import { makePdf } from '../fixtures/pdfs.js';
import {
  MONO,
  type Harness,
  createHarness,
  createOrder,
  createShop,
  pairDevice,
  uploadPdf,
} from './harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});

/**
 * A shop with one paired device, a signed-in operator and one confirmed printer.
 * `auth` carries device + operator tokens (human actions); `agentAuth` only the device token.
 */
async function pairedShop(caps: { colour?: boolean; duplex?: boolean } = {}) {
  const shop = await createShop(h.prisma);
  const paired = await pairDevice(h, shop.id);
  const auth = paired.opAuth;
  const printers = await h
    .http()
    .put('/api/shop/printers')
    .set(auth)
    .send({
      printers: [
        {
          printerName: `HP LaserJet ${randomCode(4)}`,
          colourCapable: caps.colour ?? false,
          duplexCapable: caps.duplex ?? true,
          capabilitiesConfirmed: true,
          isDefault: true,
        },
      ],
    })
    .expect(200);
  return {
    shop,
    auth,
    agentAuth: paired.auth,
    paired,
    printerId: printers.body[0].id as string,
  };
}

async function paidOrder(shopId: string, pages = 3, options = MONO): Promise<CreateOrderResponse> {
  const created = await createOrder(h, shopId, options);
  expect((await uploadPdf(h, created, await makePdf(pages))).status).toBe(200);
  await h
    .http()
    .post(`/api/orders/${created.order.id}/pay`)
    .set('x-tracking-token', created.trackingToken)
    .expect(200);
  return created;
}

const customerView = async (c: CreateOrderResponse) =>
  (await h.http().get(`/api/orders/${c.order.id}`).set('x-tracking-token', c.trackingToken))
    .body as PublicOrder;

describe('device enrollment', () => {
  it('pairs once with a one-time code; reuse and bad tokens are refused', async () => {
    const shop = await createShop(h.prisma);
    const code = randomCode(8);
    await h.prisma.enrollmentCode.create({
      data: {
        shopId: shop.id,
        codeHash: sha256Hex(code),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const first = await h.http().post('/api/devices/enroll').send({ code, name: 'PC' }).expect(201);
    expect(first.body.shop.id).toBe(shop.id);
    const again = await h
      .http()
      .post('/api/devices/enroll')
      .send({ code, name: 'PC2' })
      .expect(400);
    expect(again.body.error.code).toBe('ENROLLMENT_CODE_INVALID');

    await h.http().get('/api/shop/jobs').expect(401);
    await h
      .http()
      .get('/api/shop/jobs')
      .set('Authorization', 'Bearer nope-nope-nope-nope-nope')
      .expect(401);
    await h
      .http()
      .get('/api/shop/jobs')
      .set('Authorization', `Bearer ${first.body.deviceToken}`)
      .expect(200);
  });
});

describe('vertical slice lifecycle (T07, T10, T15)', () => {
  it('pay → accept → lease → submit → ready → customer sees code → pickup → collected', async () => {
    const { shop, auth, agentAuth, printerId } = await pairedShop({ duplex: true });
    const created = await paidOrder(shop.id, 3, { ...MONO, copies: 2, duplex: true });

    // Operator sees the paid order, without the customer's phone number.
    const list = await h.http().get('/api/shop/jobs').set(agentAuth).expect(200);
    const listed = (list.body.jobs as ShopJob[]).find((j) => j.orderId === created.order.id)!;
    expect(listed).toMatchObject({
      status: 'PENDING_REVIEW',
      pageCount: 3,
      simulatedPayment: true,
    });
    expect(JSON.stringify(list.body)).not.toContain('customerPhone');

    const detail = await h.http().get(`/api/shop/jobs/${created.order.id}`).set(auth).expect(200);
    expect(detail.body.previewUrl).toMatch(/^http/);

    // Accept: packet built (slip carries the pickup number taken at payment), job queued.
    const accepted = await h
      .http()
      .post(`/api/shop/jobs/${created.order.id}/accept`)
      .set(auth)
      .send({})
      .expect(200);
    expect(accepted.body).toMatchObject({
      status: 'QUEUED',
      printJob: { attempt: 1, status: 'READY' },
    });
    const paid = await customerView(created);
    expect(paid.pickupNumber).toBe(1); // ADR-002: shown from payment verified onward
    expect(accepted.body).toMatchObject({
      pickupNumber: paid.pickupNumber,
      pickupDate: paid.pickupDate,
    });

    // Lease: one combined packet, checksum, document name, settings.
    const lease = (
      await h
        .http()
        .post(`/api/shop/print-jobs/${accepted.body.printJob.id}/lease`)
        .set(agentAuth)
        .expect(200)
    ).body as LeaseResponse;
    expect(lease).toMatchObject({
      printerName: expect.stringContaining('HP LaserJet'),
      documentName: `KAGAZ-${created.order.publicRef}-A1`,
      settings: { colour: false, duplex: true, paperSize: 'A4' },
      pageCount: 9, // (3 + spacer) × 2 + slip
    });
    const packet = Buffer.from(await (await fetch(lease.downloadUrl)).arrayBuffer());
    expect(sha256Hex(packet)).toBe(lease.sha256);

    // The slip is the last page and carries the pickup number the customer sees.
    const task = getDocument({ data: new Uint8Array(packet), verbosity: 0 });
    const doc = await task.promise;
    const slipText = (await (await doc.getPage(doc.numPages)).getTextContent()).items
      .map((it) => ('str' in it ? it.str : ''))
      .join('');
    await task.destroy();

    await h
      .http()
      .post(`/api/shop/print-jobs/${lease.printJobId}/status`)
      .set(agentAuth)
      .send({ status: 'SUBMITTED', spoolerJobId: 42 })
      .expect(200);
    await h
      .http()
      .post(`/api/shop/print-jobs/${lease.printJobId}/status`)
      .set(agentAuth)
      .send({ status: 'SUBMITTED', spoolerJobId: 42 })
      .expect(200); // idempotent replay
    const complete = await h
      .http()
      .post(`/api/shop/print-jobs/${lease.printJobId}/status`)
      .set(agentAuth)
      .send({ status: 'SPOOLER_COMPLETE' })
      .expect(200);
    expect(complete.body.status).toBe('READY_FOR_PICKUP'); // ADR-002: printing finished = ready
    const printer = await h.prisma.printer.findUniqueOrThrow({ where: { id: printerId } });
    expect(printer.activeJobId).toBeNull(); // lease released for the next job

    const ready = await customerView(created);
    expect(ready.status).toBe('READY_FOR_PICKUP');
    expect(ready.pickupNumber).toBe(1);
    expect(slipText).toContain('#1');
    expect(slipText).toContain(formatPickupDate(ready.pickupDate!));
    expect(ready.timeline.map((e) => e.status)).toEqual([
      'DRAFT',
      'AWAITING_PAYMENT',
      'PENDING_REVIEW',
      'QUEUED',
      'PRINTING',
      'READY_FOR_PICKUP',
    ]);
    const audit = await h.prisma.auditLog.findMany({ where: { orderId: created.order.id } });
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(['order.accepted', 'print.started']),
    );
  });

  it('reject records the reason and a simulated refund (T07, T20)', async () => {
    const { shop, auth } = await pairedShop();
    const created = await paidOrder(shop.id);
    const res = await h
      .http()
      .post(`/api/shop/jobs/${created.order.id}/reject`)
      .set(auth)
      .send({ reasonCode: 'CONTENT_NOT_ALLOWED', note: 'Blank pages only' })
      .expect(200);
    expect(res.body).toMatchObject({
      status: 'REFUNDED',
      rejection: { code: 'CONTENT_NOT_ALLOWED', note: 'Blank pages only' },
    });
    const payment = await h.prisma.payment.findFirstOrThrow({
      where: { orderId: created.order.id },
      include: { refunds: true },
    });
    expect(payment.status).toBe('REFUNDED');
    expect(payment.refunds).toEqual([
      expect.objectContaining({
        status: 'SUCCEEDED',
        isSimulated: true,
        amountPaise: payment.amountPaise,
        providerRefundId: `DEMO-RFD-${created.order.publicRef}`,
      }),
    ]);
    const view = await customerView(created);
    expect(view.timeline.map((e) => e.status).slice(-3)).toEqual([
      'REJECTED',
      'REFUND_PENDING',
      'REFUNDED',
    ]);
  });
});

describe('printer queue (T11, T12)', () => {
  it('leases strictly in FIFO order, one job per printer at a time', async () => {
    const { shop, auth } = await pairedShop();
    const a = await paidOrder(shop.id, 1);
    const b = await paidOrder(shop.id, 1);
    const accept = async (c: CreateOrderResponse) =>
      (await h.http().post(`/api/shop/jobs/${c.order.id}/accept`).set(auth).send({}).expect(200))
        .body as ShopJob;
    const jobA = await accept(a);
    const jobB = await accept(b);

    const outOfOrder = await h
      .http()
      .post(`/api/shop/print-jobs/${jobB.printJob!.id}/lease`)
      .set(auth)
      .expect(409);
    expect(outOfOrder.body.error.code).toBe('NOT_NEXT_IN_QUEUE');

    await h.http().post(`/api/shop/print-jobs/${jobA.printJob!.id}/lease`).set(auth).expect(200);
    // A is still printing: B must wait even though it's now first in the READY queue.
    const busy = await h
      .http()
      .post(`/api/shop/print-jobs/${jobB.printJob!.id}/lease`)
      .set(auth)
      .expect(409);
    expect(busy.body.error.code).toBe('PRINTER_BUSY');

    await h
      .http()
      .post(`/api/shop/print-jobs/${jobA.printJob!.id}/status`)
      .set(auth)
      .send({ status: 'SPOOLER_COMPLETE' })
      .expect(200);
    await h.http().post(`/api/shop/print-jobs/${jobB.printJob!.id}/lease`).set(auth).expect(200);
  });

  it('a failed print goes to the operator, never READY or auto-reprint', async () => {
    const { shop, auth } = await pairedShop();
    const created = await paidOrder(shop.id, 1);
    const job = (
      await h
        .http()
        .post(`/api/shop/jobs/${created.order.id}/accept`)
        .set(auth)
        .send({})
        .expect(200)
    ).body as ShopJob;
    await h.http().post(`/api/shop/print-jobs/${job.printJob!.id}/lease`).set(auth).expect(200);
    const failed = await h
      .http()
      .post(`/api/shop/print-jobs/${job.printJob!.id}/status`)
      .set(auth)
      .send({ status: 'FAILED', error: 'Paper out' })
      .expect(200);
    expect(failed.body).toMatchObject({
      status: 'NEEDS_OPERATOR_CHECK',
      printJob: { status: 'FAILED', error: 'Paper out' },
    });
    expect((await customerView(created)).status).toBe('NEEDS_OPERATOR_CHECK'); // never READY
    expect(await h.prisma.printJob.count({ where: { orderId: created.order.id } })).toBe(1);
  });
});

describe('tenant isolation (T09)', () => {
  it("shop B's device cannot see or act on shop A's orders", async () => {
    const a = await pairedShop();
    const b = await pairedShop();
    const created = await paidOrder(a.shop.id);

    const listB = await h.http().get('/api/shop/jobs').set(b.auth).expect(200);
    expect((listB.body.jobs as ShopJob[]).map((j) => j.orderId)).not.toContain(created.order.id);

    const id = created.order.id;
    await h.http().get(`/api/shop/jobs/${id}`).set(b.auth).expect(404);
    await h.http().post(`/api/shop/jobs/${id}/accept`).set(b.auth).send({}).expect(404);
    await h
      .http()
      .post(`/api/shop/jobs/${id}/reject`)
      .set(b.auth)
      .send({ reasonCode: 'OTHER' })
      .expect(404);

    const job = (
      await h.http().post(`/api/shop/jobs/${id}/accept`).set(a.auth).send({}).expect(200)
    ).body as ShopJob;
    await h.http().post(`/api/shop/print-jobs/${job.printJob!.id}/lease`).set(b.auth).expect(404);
    // B can't use A's printer for its own orders either.
    const bOrder = await paidOrder(b.shop.id);
    await h
      .http()
      .post(`/api/shop/jobs/${bOrder.order.id}/accept`)
      .set(b.auth)
      .send({ printerId: a.printerId })
      .expect(409);

    await h.http().post(`/api/shop/print-jobs/${job.printJob!.id}/lease`).set(a.auth).expect(200);
    await h
      .http()
      .post(`/api/shop/print-jobs/${job.printJob!.id}/status`)
      .set(a.auth)
      .send({ status: 'SUBMITTED' })
      .expect(200);
    // B can't report progress on A's print job.
    await h
      .http()
      .post(`/api/shop/print-jobs/${job.printJob!.id}/status`)
      .set(b.auth)
      .send({ status: 'SPOOLER_COMPLETE' })
      .expect(404);
    expect((await customerView(created)).status).toBe('PRINTING');
  });
});

describe('printer registration ("Use for Kagaz" set)', () => {
  it('enables listed printers and disables the ones this device no longer lists', async () => {
    const { shop, auth } = await pairedShop();
    const printer = (printerName: string, isDefault = false) => ({
      printerName,
      colourCapable: false,
      duplexCapable: false,
      capabilitiesConfirmed: true,
      isDefault,
    });
    const names = async () =>
      (
        await h.prisma.printer.findMany({
          where: { shopId: shop.id },
          orderBy: { printerName: 'asc' },
        })
      )
        .filter((p) => ['Old USB', 'New USB'].includes(p.printerName))
        .map((p) => `${p.printerName}:${p.enabled}:${p.isDefault}`);

    await h
      .http()
      .put('/api/shop/printers')
      .set(auth)
      .send({ printers: [printer('Old USB', true)] })
      .expect(200);
    expect(await names()).toEqual(['Old USB:true:true']);

    // Operator unplugs the old printer and picks the new one.
    await h
      .http()
      .put('/api/shop/printers')
      .set(auth)
      .send({ printers: [printer('New USB', true)] })
      .expect(200);
    expect(await names()).toEqual(['New USB:true:true', 'Old USB:false:false']);

    // Ticking the old one again re-enables it (even after an earlier disable).
    await h
      .http()
      .put('/api/shop/printers')
      .set(auth)
      .send({ printers: [printer('New USB', true), printer('Old USB')] })
      .expect(200);
    expect(await names()).toEqual(['New USB:true:true', 'Old USB:true:false']);

    // Another device's printers in the same shop are left alone.
    const other = await pairDevice(h, shop.id, { deviceName: 'Second PC' });
    await h
      .http()
      .put('/api/shop/printers')
      .set(other.opAuth)
      .send({ printers: [printer('Second PC printer')] })
      .expect(200);
    expect(await names()).toEqual(['New USB:true:true', 'Old USB:true:false']);
  });
});
