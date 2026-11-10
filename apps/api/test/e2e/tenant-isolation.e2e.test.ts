import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type ShopJob } from '@kagaz/shared';
import { type Harness, createHarness } from './harness.js';
import {
  acceptedOrder,
  needsCheckOrder,
  pairedShop,
  paidOrder,
  printingOrder,
  readyOrder,
} from './shop-helpers.js';

/**
 * P4.1 / T09: a Shop A device can't see or act on Shop B's orders, jobs, printers or files.
 * Everything cross-tenant is a 404 (never 403) so ids can't be enumerated.
 */
let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});

describe('T09: three-shop separation', () => {
  it('T09: Shop A device on Shop B orders → list excludes, every read/action 404', async () => {
    const a = await pairedShop(h);
    const b = await pairedShop(h);
    const c = await pairedShop(h);

    // Order matters: B has one printer, so finish the jobs that release it first.
    const check = await needsCheckOrder(h, b);
    const ready = await readyOrder(h, b);
    const printing = await printingOrder(h, b);
    const queued = await acceptedOrder(h, b);
    const pending = await paidOrder(h, b.shop.id);
    const bOrderIds = [pending, queued.created, printing.created, check.created, ready.created].map(
      (o) => o.order.id,
    );

    // List: A and C see none of B's jobs (any status filter).
    for (const other of [a, c]) {
      const all = await h
        .http()
        .get(
          '/api/shop/jobs?status=PENDING_REVIEW,QUEUED,PRINTING,NEEDS_OPERATOR_CHECK,READY_FOR_PICKUP',
        )
        .set(other.auth)
        .expect(200);
      const ids = (all.body.jobs as ShopJob[]).map((j) => j.orderId);
      for (const id of bOrderIds) expect(ids).not.toContain(id);
    }
    const bList = (await h.http().get('/api/shop/jobs').set(b.auth).expect(200)).body
      .jobs as ShopJob[];
    expect(bList.map((j) => j.orderId)).toEqual(expect.arrayContaining(bOrderIds));

    const notFound = async (
      res: Promise<{ status: number; body: { error?: { code: string } } }>,
    ) => {
      const r = await res;
      expect(r.status).toBe(404);
      expect(['ORDER_NOT_FOUND', 'PRINT_JOB_NOT_FOUND']).toContain(r.body.error!.code);
    };

    // Read + preview (the detail is the only way to get a preview URL).
    for (const id of bOrderIds) {
      await notFound(h.http().get(`/api/shop/jobs/${id}`).set(a.auth));
    }
    // Human actions.
    await notFound(a.human(`jobs/${pending.order.id}/accept`));
    await notFound(a.human(`jobs/${pending.order.id}/reject`, { reasonCode: 'OTHER' }));
    await notFound(a.human(`jobs/${queued.created.order.id}/reject`, { reasonCode: 'OTHER' }));
    for (const action of ['CONFIRM_PRINTED', 'REPRINT', 'MARK_FAILED']) {
      await notFound(a.human(`jobs/${check.created.order.id}/resolve`, { action, confirm: true }));
    }
    // Agent calls on B's print jobs.
    await notFound(a.agent(`print-jobs/${queued.printJobId}/lease`));
    await notFound(
      a.agent(`print-jobs/${printing.printJobId}/status`, { status: 'SPOOLER_COMPLETE' }),
    );
    await notFound(
      a.agent(`print-jobs/${printing.printJobId}/status`, { status: 'FAILED', error: 'x' }),
    );
    await notFound(a.agent(`print-jobs/${printing.printJobId}/status`, { status: 'UNCERTAIN' }));

    // Nothing of B changed.
    const statuses = await h.prisma.order.findMany({
      where: { id: { in: bOrderIds } },
      select: { id: true, status: true },
    });
    expect(Object.fromEntries(statuses.map((o) => [o.id, o.status]))).toEqual({
      [pending.order.id]: 'PENDING_REVIEW',
      [queued.created.order.id]: 'QUEUED',
      [printing.created.order.id]: 'PRINTING',
      [check.created.order.id]: 'NEEDS_OPERATOR_CHECK',
      [ready.created.order.id]: 'READY_FOR_PICKUP',
    });
    expect(
      await h.prisma.auditLog.count({
        where: { orderId: { in: bOrderIds }, actorId: a.device.device.id },
      }),
    ).toBe(0);
  });

  it("T09: printers are per shop — A can't list, use or heartbeat B's printers", async () => {
    const a = await pairedShop(h);
    const b = await pairedShop(h);
    const printers = await h.http().get('/api/shop/printers').set(a.auth).expect(200);
    expect(printers.body.map((p: { id: string }) => p.id)).toEqual([a.printerId]);

    const aOrder = await paidOrder(h, a.shop.id);
    const res = await a
      .human(`jobs/${aOrder.order.id}/accept`, { printerId: b.printerId })
      .expect(409);
    expect(res.body.error.code).toBe('NO_SUITABLE_PRINTER');

    await a
      .agent('heartbeat', { printers: [{ printerId: b.printerId, status: 'OFFLINE' }] })
      .expect(200);
    const bPrinter = await h.prisma.printer.findUniqueOrThrow({ where: { id: b.printerId } });
    expect(bPrinter.status).not.toBe('OFFLINE');
  });

  it('T09: idempotency keys are per device — a key cannot replay another shop’s response', async () => {
    const a = await pairedShop(h);
    const b = await pairedShop(h);
    const bOrder = await paidOrder(h, b.shop.id);
    const ok = await b
      .human(`jobs/${bOrder.order.id}/accept`, {}, { 'Idempotency-Key': 'cross-tenant-1' })
      .expect(200);
    expect(ok.body.orderId).toBe(bOrder.order.id);
    const replay = await a.human(
      `jobs/${bOrder.order.id}/accept`,
      {},
      { 'Idempotency-Key': 'cross-tenant-1' },
    );
    expect(replay.status).toBe(404);
  });
});
