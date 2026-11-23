/**
 * ADR-005: several files per order, PDFs and images (JPEG/PNG/WebP), printed as ONE document.
 * Everything goes over HTTP (customer routes with the tracking token, shop routes with a paired
 * device), so the tenant guard and the tracking guard run as in production.
 */
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type CreateOrderResponse,
  type LeaseResponse,
  type PublicOrder,
  type ShopJob,
  type UploadUrlResponse,
} from '@kagaz/shared';
import { makeHeicHeader, makeJpeg, makePng, makeZip } from '../fixtures/images.js';
import { makePdf } from '../fixtures/pdfs.js';
import {
  MONO,
  type Harness,
  createHarness,
  createOrder,
  createShop,
  uploadPdf,
} from './harness.js';
import { pairedShop, pay, view } from './pay-helpers.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});

const tok = (c: CreateOrderResponse) => ({ 'x-tracking-token': c.trackingToken });
const upload = (c: CreateOrderResponse, bytes: Buffer) => uploadPdf(h, c, bytes);
const order = async (c: CreateOrderResponse) => (await view(h, c).expect(200)).body as PublicOrder;

function removeFile(c: CreateOrderResponse, fileId: string): request.Test {
  return h.http().delete(`/api/orders/${c.order.id}/files/${fileId}`).set(tok(c));
}

async function pageCountOf(pdf: Buffer): Promise<number> {
  const task = getDocument({ data: new Uint8Array(pdf), verbosity: 0 });
  try {
    return (await task.promise).numPages;
  } finally {
    await task.destroy();
  }
}

describe('multi-file orders: PDF + image (ADR-005)', () => {
  it('a 3-page PDF + a JPEG + a PNG price as 5 pages, in upload order', async () => {
    const shop = await createShop(h.prisma);
    const created = await createOrder(h, shop.id, { ...MONO, copies: 2 });

    const first = await upload(created, await makePdf(3));
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ status: 'AWAITING_PAYMENT', file: { pageCount: 3 } });

    expect((await upload(created, await makeJpeg(800, 400))).status).toBe(200);
    const third = await upload(created, await makePng());
    expect(third.status).toBe(200);

    const o = third.body as PublicOrder;
    expect(o.files.map((f) => [f.sourceType, f.pageCount, f.firstPage])).toEqual([
      ['PDF', 3, 1],
      ['JPEG', 1, 4],
      ['PNG', 1, 5],
    ]);
    expect(o.file?.pageCount).toBe(5);
    // Server-side price over all pages (invariant 1): 5 pages × 2 copies × ₹2.
    expect(o.quote).toMatchObject({ selectedPages: 5, printedSides: 10, totalPaise: 2000 });
    expect(o.amountPaise).toBe(2000);
  });

  it('serves each stored file as a PDF for the preview (image = one A4 page), token required', async () => {
    const shop = await createShop(h.prisma);
    const created = await createOrder(h, shop.id);
    const res = await upload(created, await makeJpeg(400, 800));
    const fileId = (res.body as PublicOrder).files[0]!.id;
    const path = `/api/orders/${created.order.id}/files/${fileId}/content`;

    await h.http().get(path).expect(404); // no tracking token → looks like not found
    const content = await h
      .http()
      .get(path)
      .set(tok(created))
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(content.headers['content-type']).toContain('application/pdf');
    expect(content.headers['cache-control']).toContain('no-store');
    const pdf = content.body as Buffer;
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(await pageCountOf(pdf)).toBe(1);

    await h
      .http()
      .get(`/api/orders/${created.order.id}/files/not-a-uuid/content`)
      .set(tok(created))
      .expect(404);
  });

  it('removing a file re-quotes; with none left the order has no price and cannot be paid', async () => {
    const shop = await createShop(h.prisma);
    const created = await createOrder(h, shop.id);
    await upload(created, await makePdf(4));
    const both = (await upload(created, await makeJpeg())).body as PublicOrder;
    expect(both.quote?.selectedPages).toBe(5);

    const [pdfFile, photo] = both.files;
    const afterOne = (await removeFile(created, pdfFile!.id).expect(200)).body as PublicOrder;
    expect(afterOne.files.map((f) => f.id)).toEqual([photo!.id]);
    expect(afterOne.quote).toMatchObject({ selectedPages: 1, totalPaise: 500 }); // minimum charge
    await removeFile(created, pdfFile!.id).expect(200); // idempotent

    const empty = (await removeFile(created, photo!.id).expect(200)).body as PublicOrder;
    expect(empty).toMatchObject({ files: [], file: null, quote: null, amountPaise: null });
    expect((await pay(h, created).expect(409)).body.error.code).toBe('ORDER_NOT_PAYABLE');

    // Adding a file again brings the price back.
    const again = (await upload(created, await makePdf(2))).body as PublicOrder;
    expect(again).toMatchObject({ status: 'AWAITING_PAYMENT', quote: { selectedPages: 2 } });
  });

  it('a page range that no longer fits after a removal clears the price', async () => {
    const shop = await createShop(h.prisma);
    const created = await createOrder(h, shop.id, { ...MONO, pageRange: '4' });
    await upload(created, await makePdf(3));
    const o = (await upload(created, await makeJpeg())).body as PublicOrder;
    expect(o.quote?.selectedPages).toBe(1); // page 4 = the photo

    const after = (await removeFile(created, o.files[1]!.id).expect(200)).body as PublicOrder;
    expect(after.quote).toBeNull();
    const fix = await h
      .http()
      .patch(`/api/orders/${created.order.id}/options`)
      .set(tok(created))
      .send({ options: { ...MONO, pageRange: '4' } })
      .expect(400);
    expect(fix.body.error.code).toBe('PAGE_RANGE_INVALID');
  });

  it('reorders files; the page range then picks pages of the new order', async () => {
    const shop = await createShop(h.prisma);
    const created = await createOrder(h, shop.id);
    await upload(created, await makePdf(2));
    const o = (await upload(created, await makeJpeg())).body as PublicOrder;
    const [pdfFile, photo] = o.files;

    const res = await h
      .http()
      .put(`/api/orders/${created.order.id}/files/order`)
      .set(tok(created))
      .send({ fileIds: [photo!.id, pdfFile!.id] })
      .expect(200);
    const reordered = res.body as PublicOrder;
    expect(reordered.files.map((f) => [f.sourceType, f.firstPage])).toEqual([
      ['JPEG', 1],
      ['PDF', 2],
    ]);
    expect(reordered.quote?.selectedPages).toBe(3); // same total → same price

    await h
      .http()
      .put(`/api/orders/${created.order.id}/files/order`)
      .set(tok(created))
      .send({ fileIds: ['nope'] })
      .expect(400);
  });

  it('cancelling an upload in progress: the pending file is dropped and cannot complete', async () => {
    const shop = await createShop(h.prisma);
    const created = await createOrder(h, shop.id);
    await upload(created, await makePdf(1));
    const pdf = await makePdf(5);
    const url = (
      await h
        .http()
        .post(`/api/orders/${created.order.id}/upload-url`)
        .set(tok(created))
        .send({ bytes: pdf.length })
        .expect(200)
    ).body as UploadUrlResponse;

    await removeFile(created, url.fileId).expect(200);
    // The browser's PUT may still land after the cancel; completing it is refused.
    await fetch(url.uploadUrl, { method: 'PUT', headers: url.headers, body: new Uint8Array(pdf) });
    const late = await h
      .http()
      .post(`/api/orders/${created.order.id}/upload-complete`)
      .set(tok(created))
      .send({ fileId: url.fileId })
      .expect(409);
    expect(late.body.error.code).toBe('ORDER_NOT_EDITABLE');
    expect((await order(created)).quote?.selectedPages).toBe(1);
  });

  it('rejects a bad file by content (a .docx, a HEIC photo) without touching the good ones', async () => {
    const shop = await createShop(h.prisma);
    const created = await createOrder(h, shop.id);
    await upload(created, await makePdf(2));

    const docx = await upload(created, makeZip());
    expect(docx.status).toBe(422);
    expect(docx.body.error.code).toBe('FILE_TYPE_UNSUPPORTED');
    const heic = await upload(created, makeHeicHeader());
    expect(heic.status).toBe(422);
    expect(heic.body.error.code).toBe('FILE_HEIC_UNSUPPORTED');

    const o = await order(created);
    expect(o.files).toHaveLength(1);
    expect(o.quote?.selectedPages).toBe(2);
    const invalid = await h.prisma.fileAsset.count({
      where: { orderId: created.order.id, status: 'INVALID' },
    });
    expect(invalid).toBe(2);
  });

  it('caps the number of files per order', async () => {
    const shop = await createShop(h.prisma);
    const created = await createOrder(h, shop.id);
    const max = Number(process.env.MAX_FILES_PER_ORDER ?? 20);
    await h.prisma.fileAsset.createMany({
      data: Array.from({ length: max }, (_, i) => ({
        orderId: created.order.id,
        kind: 'ORIGINAL' as const,
        objectKey: `e2e/${created.order.id}/${i}`,
        status: 'PENDING_UPLOAD' as const,
      })),
    });
    const res = await h
      .http()
      .post(`/api/orders/${created.order.id}/upload-url`)
      .set(tok(created))
      .send({ bytes: 1000 })
      .expect(409);
    expect(res.body.error.code).toBe('TOO_MANY_FILES');
  });
});

describe('multi-file order at the shop: one document, one packet, one slip (invariant 7)', () => {
  it('paid PDF + photo: shop sees 3 pages, the packet is 3 pages × copies + 1 slip', async () => {
    const { shop, auth } = await pairedShop(h);
    const created = await createOrder(h, shop.id, { ...MONO, copies: 2 });
    await upload(created, await makePdf(2));
    const photo = await upload(created, await makeJpeg(800, 400));
    expect(photo.body.quote).toMatchObject({ selectedPages: 3, printedSides: 6 });

    const paid = (await pay(h, created).expect(200)).body.order as PublicOrder;
    // Files are frozen once a payment exists.
    const more = await h
      .http()
      .post(`/api/orders/${created.order.id}/upload-url`)
      .set(tok(created))
      .send({ bytes: 1000 })
      .expect(409);
    expect(more.body.error.code).toBe('ORDER_NOT_EDITABLE');
    await removeFile(created, paid.files[0]!.id).expect(409);

    const jobs = (await h.http().get('/api/shop/jobs').set(auth).expect(200)).body
      .jobs as ShopJob[];
    expect(jobs.find((j) => j.orderId === created.order.id)).toMatchObject({ pageCount: 3 });

    // The shop app's single preview link is the merged document.
    const detail = await h.http().get(`/api/shop/jobs/${created.order.id}`).set(auth).expect(200);
    const preview = Buffer.from(await (await fetch(detail.body.previewUrl)).arrayBuffer());
    expect(await pageCountOf(preview)).toBe(3);
    // Built once: a second detail call reuses it.
    await h.http().get(`/api/shop/jobs/${created.order.id}`).set(auth).expect(200);
    expect(
      await h.prisma.fileAsset.count({ where: { orderId: created.order.id, kind: 'COMBINED' } }),
    ).toBe(1);

    let job = jobs.find((j) => j.orderId === created.order.id)!;
    if (job.status === 'PENDING_REVIEW') {
      job = (
        await h
          .http()
          .post(`/api/shop/jobs/${created.order.id}/accept`)
          .set(auth)
          .send({})
          .expect(200)
      ).body as ShopJob;
    }
    const printJobId = job.printJob?.id ?? (await currentPrintJob(created.order.id));
    const lease = (
      await h.http().post(`/api/shop/print-jobs/${printJobId}/lease`).set(auth).expect(200)
    ).body as LeaseResponse;
    expect(lease.pageCount).toBe(3 * 2 + 1); // pages × copies + exactly one slip
    const packet = Buffer.from(await (await fetch(lease.downloadUrl)).arrayBuffer());
    expect(await pageCountOf(packet)).toBe(7);

    // Finish the job so no lease is left for the global lease sweeper in later suites.
    for (const body of [{ status: 'SUBMITTED', spoolerJobId: 7 }, { status: 'SPOOLER_COMPLETE' }]) {
      await h
        .http()
        .post(`/api/shop/print-jobs/${lease.printJobId}/status`)
        .set(auth)
        .send(body)
        .expect(200);
    }
    expect((await order(created)).status).toBe('READY_FOR_PICKUP');
  });
});

async function currentPrintJob(orderId: string): Promise<string> {
  const job = await h.prisma.printJob.findFirstOrThrow({
    where: { orderId },
    orderBy: { attempt: 'desc' },
  });
  return job.id;
}
