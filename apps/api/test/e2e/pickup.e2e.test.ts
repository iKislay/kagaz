import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { type LeaseResponse, type ShopJob } from '@kagaz/shared';
import { Clock } from '../../src/common/clock.js';
import { makePdf } from '../fixtures/pdfs.js';
import { type Harness, createHarness, createOrder, uploadPdf } from './harness.js';
import {
  acceptedOrder,
  customerView,
  needsCheckOrder,
  pairedShop,
  paidOrder,
  printingOrder,
} from './shop-helpers.js';

/** ADR-002: daily pickup number per shop, assigned at payment; printing finished = ready. */
let h: Harness;
let clock: Clock;
beforeAll(async () => {
  h = await createHarness();
  clock = h.app.get(Clock);
});
afterAll(async () => {
  await h.close();
});
afterEach(() => {
  vi.restoreAllMocks();
});

const setNow = (iso: string) => vi.spyOn(clock, 'now').mockReturnValue(new Date(iso));

describe('ADR-002: daily pickup number', () => {
  it('ADR-002: numbers run 1, 2, 3 per shop and are independent per shop', async () => {
    setNow('2026-11-07T05:00:00Z'); // 10:30 IST
    const a = await pairedShop(h);
    const b = await pairedShop(h);

    const a1 = await paidOrder(h, a.shop.id);
    const b1 = await paidOrder(h, b.shop.id);
    const a2 = await paidOrder(h, a.shop.id);
    const a3 = await paidOrder(h, a.shop.id);
    const b2 = await paidOrder(h, b.shop.id);

    const n = async (c: typeof a1) => {
      const v = await customerView(h, c);
      return [v.pickupNumber, v.pickupDate];
    };
    expect(await n(a1)).toEqual([1, '2026-11-07']);
    expect(await n(a2)).toEqual([2, '2026-11-07']);
    expect(await n(a3)).toEqual([3, '2026-11-07']);
    expect(await n(b1)).toEqual([1, '2026-11-07']);
    expect(await n(b2)).toEqual([2, '2026-11-07']);

    // The shop app sees the same number + date.
    const jobs = (await h.http().get('/api/shop/jobs').set(a.auth).expect(200)).body
      .jobs as ShopJob[];
    expect(jobs.map((j) => j.pickupNumber).sort()).toEqual([1, 2, 3]);
    expect(jobs.every((j) => j.pickupDate === '2026-11-07')).toBe(true);
  });

  it('ADR-002: an unpaid order has no number; abandoned orders never use one', async () => {
    setNow('2026-11-07T05:00:00Z');
    const s = await pairedShop(h);
    const unpaid = await createOrder(h, s.shop.id);
    expect((await uploadPdf(h, unpaid, await makePdf(1))).status).toBe(200);
    expect(await customerView(h, unpaid)).toMatchObject({ pickupNumber: null, pickupDate: null });

    const paid = await paidOrder(h, s.shop.id);
    expect((await customerView(h, paid)).pickupNumber).toBe(1);
  });

  it('ADR-002: the next IST day restarts at 1 (midnight Asia/Kolkata, not UTC)', async () => {
    const s = await pairedShop(h);
    setNow('2026-11-07T18:29:00Z'); // 23:59 IST on 7 Nov
    const late1 = await paidOrder(h, s.shop.id);
    const late2 = await paidOrder(h, s.shop.id);
    setNow('2026-11-07T18:31:00Z'); // 00:01 IST on 8 Nov (still 7 Nov in UTC)
    const early1 = await paidOrder(h, s.shop.id);
    const early2 = await paidOrder(h, s.shop.id);

    const pick = async (c: typeof late1) => {
      const v = await customerView(h, c);
      return `${v.pickupNumber}@${v.pickupDate}`;
    };
    expect(await pick(late1)).toBe('1@2026-11-07');
    expect(await pick(late2)).toBe('2@2026-11-07');
    expect(await pick(early1)).toBe('1@2026-11-08');
    expect(await pick(early2)).toBe('2@2026-11-08');
  });

  it('ADR-002: concurrent payments get distinct numbers', async () => {
    setNow('2026-11-09T06:00:00Z');
    const s = await pairedShop(h);
    const orders = await Promise.all(Array.from({ length: 8 }, () => paidOrder(h, s.shop.id)));
    const numbers = await Promise.all(
      orders.map(async (c) => (await customerView(h, c)).pickupNumber),
    );
    expect([...numbers].sort((x, y) => x! - y!)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const counter = await h.prisma.pickupCounter.findFirstOrThrow({
      where: { shopId: s.shop.id },
    });
    expect(counter.lastNumber).toBe(8);
  });

  it('ADR-002: repeated pay calls keep the one number', async () => {
    setNow('2026-11-09T06:00:00Z');
    const s = await pairedShop(h);
    const created = await paidOrder(h, s.shop.id);
    await h
      .http()
      .post(`/api/orders/${created.order.id}/pay`)
      .set('x-tracking-token', created.trackingToken)
      .expect(200);
    expect((await customerView(h, created)).pickupNumber).toBe(1);
    const next = await paidOrder(h, s.shop.id);
    expect((await customerView(h, next)).pickupNumber).toBe(2);
  });
});

describe('ADR-002: printing finished = ready', () => {
  it('ADR-002: SPOOLER_COMPLETE moves PRINTING → READY_FOR_PICKUP automatically (SYSTEM)', async () => {
    const s = await pairedShop(h);
    const { created, printJobId } = await printingOrder(h, s);
    const res = await s
      .agent(`print-jobs/${printJobId}/status`, { status: 'SPOOLER_COMPLETE' })
      .expect(200);
    expect(res.body).toMatchObject({ status: 'READY_FOR_PICKUP', pickupNumber: 1 });

    const order = await h.prisma.order.findUniqueOrThrow({ where: { id: created.order.id } });
    expect(order.readyAt).not.toBeNull();
    const event = await h.prisma.orderEvent.findFirstOrThrow({
      where: { orderId: created.order.id, toStatus: 'READY_FOR_PICKUP' },
    });
    expect(event).toMatchObject({
      fromStatus: 'PRINTING',
      actorType: 'SYSTEM',
      reason: 'Printing finished',
    });
    // Lease released: the printer is free for the next job.
    const printer = await h.prisma.printer.findUniqueOrThrow({ where: { id: s.printerId } });
    expect(printer.activeJobId).toBeNull();
    // The customer sees READY with the same pickup number.
    expect(await customerView(h, created)).toMatchObject({
      status: 'READY_FOR_PICKUP',
      pickupNumber: 1,
    });

    // A retried report is a no-op.
    await s.agent(`print-jobs/${printJobId}/status`, { status: 'SPOOLER_COMPLETE' }).expect(200);
    expect(
      await h.prisma.orderEvent.count({
        where: { orderId: created.order.id, toStatus: 'READY_FOR_PICKUP' },
      }),
    ).toBe(1);
  });

  it('ADR-002: SPOOLER_COMPLETE straight from LEASED also completes the order', async () => {
    const s = await pairedShop(h);
    const { created, printJobId } = await acceptedOrder(h, s);
    await s.agent(`print-jobs/${printJobId}/lease`).expect(200);
    await s.agent(`print-jobs/${printJobId}/status`, { status: 'SPOOLER_COMPLETE' }).expect(200);
    expect((await customerView(h, created)).status).toBe('READY_FOR_PICKUP');
  });

  it.each([
    ['FAILED', { status: 'FAILED', error: 'Paper jam' }],
    ['UNCERTAIN', { status: 'UNCERTAIN', reason: 'PC restarted' }],
  ])('ADR-002: %s never becomes READY', async (_name, report) => {
    const s = await pairedShop(h);
    const { created, printJobId } = await printingOrder(h, s);
    const res = await s.agent(`print-jobs/${printJobId}/status`, report).expect(200);
    expect(res.body.status).toBe('NEEDS_OPERATOR_CHECK');
    // A late "complete" for the same attempt can't turn it into READY.
    await s.agent(`print-jobs/${printJobId}/status`, { status: 'SPOOLER_COMPLETE' }).expect(409);
    expect((await customerView(h, created)).status).toBe('NEEDS_OPERATOR_CHECK');
    expect(
      await h.prisma.orderEvent.count({
        where: { orderId: created.order.id, toStatus: 'READY_FOR_PICKUP' },
      }),
    ).toBe(0);
  });

  it('ADR-002: a reprint keeps the pickup number and completes on its own', async () => {
    const s = await pairedShop(h);
    const { created } = await needsCheckOrder(h, s);
    const before = await customerView(h, created);
    expect(before.pickupNumber).toBe(1);

    const resolved = await s
      .human(`jobs/${created.order.id}/resolve`, { action: 'REPRINT', confirm: true })
      .expect(200);
    const attempt2 = resolved.body.printJob.id as string;
    const lease = (await s.agent(`print-jobs/${attempt2}/lease`).expect(200)).body as LeaseResponse;
    expect(lease.attempt).toBe(2);
    await s.agent(`print-jobs/${attempt2}/status`, { status: 'SUBMITTED' }).expect(200);
    await s.agent(`print-jobs/${attempt2}/status`, { status: 'SPOOLER_COMPLETE' }).expect(200);

    const after = await customerView(h, created);
    expect(after).toMatchObject({
      status: 'READY_FOR_PICKUP',
      pickupNumber: before.pickupNumber,
      pickupDate: before.pickupDate,
    });
    const counter = await h.prisma.pickupCounter.findFirstOrThrow({
      where: { shopId: s.shop.id },
    });
    expect(counter.lastNumber).toBe(1);
  });

  it('ADR-002: Mark Ready and pickup verification endpoints are gone (404)', async () => {
    const s = await pairedShop(h);
    const { created } = await printingOrder(h, s);
    await s.human(`jobs/${created.order.id}/ready`, { confirmed: true }).expect(404);
    await s.human('pickups/verify', { code: 'ABCD2345' }).expect(404);
    expect((await customerView(h, created)).status).toBe('PRINTING');
  });
});
