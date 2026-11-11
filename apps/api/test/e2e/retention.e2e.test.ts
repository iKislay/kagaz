import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RetentionService } from '../../src/modules/orders/retention.service.js';
import { MONO, type Harness, createHarness, createOrder, uploadPdf } from './harness.js';
import { makePdf } from '../fixtures/pdfs.js';
import { needsCheckOrder, pairedShop, readyOrder } from './shop-helpers.js';

/** P2.12 retention (PRD §14.3, T17). Durations are "shortened" by back-dating rows. */
let h: Harness;
let retention: RetentionService;
beforeAll(async () => {
  h = await createHarness();
  retention = h.app.get(RetentionService);
});
afterAll(async () => {
  await h.close();
});

const HOUR = 3_600_000;
const status = async (url: string) => (await fetch(url)).status;

describe('file retention (T17)', () => {
  it('T17: 24 h after READY (ADR-002 end state) the PDFs are deleted and old signed URLs stop working', async () => {
    const s = await pairedShop(h);
    const { created } = await readyOrder(h, s);
    const id = created.order.id;
    const detail = await h.http().get(`/api/shop/jobs/${id}`).set(s.auth).expect(200);
    const previewUrl = detail.body.previewUrl as string;
    expect(await status(previewUrl)).toBe(200);

    // Ready 23 h ago: still kept.
    await h.prisma.order.update({
      where: { id },
      data: { readyAt: new Date(Date.now() - 23 * HOUR) },
    });
    await retention.run();
    expect(await h.prisma.fileAsset.count({ where: { orderId: id, deletedAt: null } })).toBe(2);

    // Ready 25 h ago: original + packet deleted.
    await h.prisma.order.update({
      where: { id },
      data: { readyAt: new Date(Date.now() - 25 * HOUR) },
    });
    const result = await retention.run();
    expect(result.deletedFiles).toBeGreaterThanOrEqual(2);
    const files = await h.prisma.fileAsset.findMany({ where: { orderId: id } });
    expect(files).toHaveLength(2);
    for (const f of files) {
      expect(f.status).toBe('DELETED');
      expect(f.deletedAt).not.toBeNull();
    }
    expect([403, 404]).toContain(await status(previewUrl));
    // Metadata is retained; the shop detail no longer offers a preview.
    const after = await h.http().get(`/api/shop/jobs/${id}`).set(s.auth).expect(200);
    expect(after.body).toMatchObject({ status: 'READY_FOR_PICKUP', previewUrl: null });
    expect(await h.prisma.orderEvent.count({ where: { orderId: id } })).toBeGreaterThan(5);
  });

  it('REJECTED/REFUNDED orders keep files for the 7-day dispute window', async () => {
    const s = await pairedShop(h);
    const { created } = await needsCheckOrder(h, s);
    const id = created.order.id;
    await s.human(`jobs/${id}/resolve`, { action: 'MARK_FAILED' }).expect(200);

    await h.prisma
      .$executeRaw`UPDATE orders SET updated_at = ${new Date(Date.now() - 6 * 24 * HOUR)} WHERE id = ${id}::uuid`;
    await retention.run();
    expect(await h.prisma.fileAsset.count({ where: { orderId: id, deletedAt: null } })).toBe(2);

    await h.prisma
      .$executeRaw`UPDATE orders SET updated_at = ${new Date(Date.now() - 8 * 24 * HOUR)} WHERE id = ${id}::uuid`;
    await retention.run();
    expect(await h.prisma.fileAsset.count({ where: { orderId: id, deletedAt: null } })).toBe(0);
  });
});

describe('abandoned unpaid orders', () => {
  it('DRAFT / AWAITING_PAYMENT past expiry → CANCELLED (SYSTEM); files deleted 24 h later', async () => {
    const s = await pairedShop(h);
    const draft = await createOrder(h, s.shop.id, MONO);
    const awaiting = await createOrder(h, s.shop.id, MONO);
    expect((await uploadPdf(h, awaiting, await makePdf(1))).status).toBe(200);
    const fresh = await createOrder(h, s.shop.id, MONO);

    for (const o of [draft, awaiting]) {
      await h.prisma.order.update({
        where: { id: o.order.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
    }
    const result = await retention.run();
    expect(result.expiredOrders).toBeGreaterThanOrEqual(2);

    for (const o of [draft, awaiting]) {
      const order = await h.prisma.order.findUniqueOrThrow({ where: { id: o.order.id } });
      expect(order.status).toBe('CANCELLED');
      const event = await h.prisma.orderEvent.findFirstOrThrow({
        where: { orderId: o.order.id, toStatus: 'CANCELLED' },
      });
      expect(event).toMatchObject({ actorType: 'SYSTEM', reason: 'Unpaid order expired' });
    }
    expect((await h.prisma.order.findUniqueOrThrow({ where: { id: fresh.order.id } })).status).toBe(
      'DRAFT',
    );

    // The uploaded original of the cancelled order goes 24 h after cancellation.
    await retention.run();
    expect(
      await h.prisma.fileAsset.count({ where: { orderId: awaiting.order.id, deletedAt: null } }),
    ).toBe(1);
    await h.prisma
      .$executeRaw`UPDATE orders SET updated_at = ${new Date(Date.now() - 25 * HOUR)} WHERE id = ${awaiting.order.id}::uuid`;
    await retention.run();
    expect(
      await h.prisma.fileAsset.count({ where: { orderId: awaiting.order.id, deletedAt: null } }),
    ).toBe(0);
  });

  it('purges idempotency records older than 24 h', async () => {
    await h.prisma.idempotencyRecord.create({
      data: {
        scope: 'device:test',
        key: 'old-key-0001',
        requestHash: 'x',
        responseStatus: 200,
        responseBody: {},
        createdAt: new Date(Date.now() - 25 * HOUR),
      },
    });
    await retention.run();
    expect(await h.prisma.idempotencyRecord.count({ where: { key: 'old-key-0001' } })).toBe(0);
  });
});
