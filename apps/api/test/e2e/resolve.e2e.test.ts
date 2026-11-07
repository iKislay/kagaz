import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type LeaseResponse, type ShopJobDetail } from '@kagaz/shared';
import { sha256Hex } from '../../src/common/crypto/tokens.js';
import { type Harness, createHarness } from './harness.js';
import { acceptedOrder, customerView, needsCheckOrder, pairedShop } from './shop-helpers.js';

/** P2.11 needs-check resolution + safe reprint (contract §2, T14, P4.6). */
let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});

const auditActions = async (orderId: string) =>
  (await h.prisma.auditLog.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } })).map(
    (a) => a.action,
  );

describe('POST /api/shop/jobs/:orderId/resolve (T14)', () => {
  it('REPRINT: attempt 2 with the same packet + pickup code, old attempt SUPERSEDED, audited', async () => {
    const s = await pairedShop(h);
    const { created, printJobId } = await needsCheckOrder(h, s);
    const id = created.order.id;
    const codeBefore = await h.prisma.pickupCode.findUniqueOrThrow({ where: { orderId: id } });
    const attempt1 = await h.prisma.printJob.findUniqueOrThrow({ where: { id: printJobId } });

    // Without explicit confirmation → refused, nothing changes (P4.6).
    const noConfirm = await s.human(`jobs/${id}/resolve`, { action: 'REPRINT' }).expect(400);
    expect(noConfirm.body.error.code).toBe('REPRINT_CONFIRM_REQUIRED');
    await s.human(`jobs/${id}/resolve`, { action: 'REPRINT', confirm: false }).expect(400);
    expect(await h.prisma.printJob.count({ where: { orderId: id } })).toBe(1);

    const res = await s
      .human(`jobs/${id}/resolve`, { action: 'REPRINT', confirm: true, note: 'Tray was empty' })
      .expect(200);
    const detail = res.body as ShopJobDetail;
    expect(detail).toMatchObject({ status: 'QUEUED', printJob: { attempt: 2, status: 'READY' } });
    expect(detail.previewUrl).toMatch(/^http/);

    const jobs = await h.prisma.printJob.findMany({
      where: { orderId: id },
      orderBy: { attempt: 'asc' },
    });
    expect(jobs.map((j) => [j.attempt, j.status])).toEqual([
      [1, 'SUPERSEDED'],
      [2, 'READY'],
    ]);
    expect(jobs[1]).toMatchObject({
      packetFileId: attempt1.packetFileId,
      checksum: attempt1.checksum,
      printerId: attempt1.printerId,
    });
    const codeAfter = await h.prisma.pickupCode.findUniqueOrThrow({ where: { orderId: id } });
    expect(codeAfter.codeHmac).toBe(codeBefore.codeHmac);

    const audit = await h.prisma.auditLog.findFirstOrThrow({
      where: { orderId: id, action: 'ORDER_RESOLVE_REPRINT' },
    });
    expect(audit.metadata).toMatchObject({ attempt: 2, note: 'Tray was empty', to: 'QUEUED' });

    // Attempt 2 prints as a NEW document name; attempt 1 is never resubmitted.
    const lease = (await s.agent(`print-jobs/${jobs[1]!.id}/lease`).expect(200))
      .body as LeaseResponse;
    expect(lease.documentName).toBe(`KAGAZ-${created.order.publicRef}-A2`);
    const packet = Buffer.from(await (await fetch(lease.downloadUrl)).arrayBuffer());
    expect(sha256Hex(packet)).toBe(attempt1.checksum);
    await s.agent(`print-jobs/${printJobId}/lease`).expect(409);
  });

  it('a duplicate reprint (replayed click) creates only one new attempt', async () => {
    const s = await pairedShop(h);
    const { created } = await needsCheckOrder(h, s);
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        s.human(`jobs/${created.order.id}/resolve`, { action: 'REPRINT', confirm: true }),
      ),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await h.prisma.printJob.count({ where: { orderId: created.order.id } })).toBe(2);
    expect(
      await h.prisma.auditLog.count({
        where: { orderId: created.order.id, action: 'ORDER_RESOLVE_REPRINT' },
      }),
    ).toBe(1);
  });

  it('CONFIRM_PRINTED → READY_FOR_PICKUP; the customer sees the code; it expires in 7 days', async () => {
    const s = await pairedShop(h);
    const { created } = await needsCheckOrder(h, s);
    const res = await s
      .human(`jobs/${created.order.id}/resolve`, { action: 'CONFIRM_PRINTED', confirm: true })
      .expect(200);
    expect(res.body.status).toBe('READY_FOR_PICKUP');
    const view = await customerView(h, created);
    expect(view.pickupCode).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    const code = await h.prisma.pickupCode.findUniqueOrThrow({
      where: { orderId: created.order.id },
    });
    const days = (code.expiresAt!.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
    expect(await auditActions(created.order.id)).toContain('ORDER_RESOLVE_CONFIRM_PRINTED');
    await s.human('pickups/verify', { code: view.pickupCode }).expect(200);
  });

  it('MARK_FAILED → REJECTED → simulated refund', async () => {
    const s = await pairedShop(h);
    const { created } = await needsCheckOrder(h, s);
    const res = await s
      .human(`jobs/${created.order.id}/resolve`, { action: 'MARK_FAILED', note: 'Printer broken' })
      .expect(200);
    expect(res.body).toMatchObject({
      status: 'REFUNDED',
      rejection: { code: 'PRINT_FAILED', note: 'Printer broken' },
    });
    const view = await customerView(h, created);
    expect(view.timeline.map((e) => e.status).slice(-4)).toEqual([
      'NEEDS_OPERATOR_CHECK',
      'REJECTED',
      'REFUND_PENDING',
      'REFUNDED',
    ]);
    expect(await auditActions(created.order.id)).toContain('ORDER_RESOLVE_MARK_FAILED');
    const refund = await h.prisma.refund.findFirstOrThrow({
      where: { payment: { orderId: created.order.id } },
    });
    expect(refund).toMatchObject({ status: 'SUCCEEDED', isSimulated: true });
  });

  it('only from NEEDS_OPERATOR_CHECK → otherwise 409 INVALID_TRANSITION', async () => {
    const s = await pairedShop(h);
    const { created } = await acceptedOrder(h, s);
    const res = await s
      .human(`jobs/${created.order.id}/resolve`, { action: 'CONFIRM_PRINTED', confirm: true })
      .expect(409);
    expect(res.body.error.code).toBe('INVALID_TRANSITION');
    await s.human(`jobs/${created.order.id}/resolve`, { action: 'NOPE' }).expect(400);
  });
});
