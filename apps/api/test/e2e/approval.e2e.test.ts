import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type PublicOrder } from '@kagaz/shared';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DomainEvent } from '../../src/common/events/domain-events.js';
import { MONO, type Harness, createHarness } from './harness.js';
import {
  type PairedShop,
  heartbeat,
  pairedShop,
  pay,
  payableOrder,
  shopAction,
} from './pay-helpers.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});

async function autoShop(caps: { colour?: boolean; duplex?: boolean } = {}): Promise<PairedShop> {
  const s = await pairedShop(h, caps);
  await shopAction(h, s.auth, 'patch', '/api/shop/mode', { approvalMode: 'AUTO' }).expect(200);
  return s;
}

async function paidEventMeta(orderId: string) {
  const ev = await h.prisma.orderEvent.findFirstOrThrow({
    where: { orderId, toStatus: 'PENDING_REVIEW' },
  });
  return ev.metadata as { autoAccept: { eligible: boolean; reasons: string[] } };
}

describe('T08: auto mode', () => {
  it('eligible paid order is queued without a manual accept (actor SYSTEM)', async () => {
    const s = await autoShop();
    const order = await payableOrder(h, s.shop.id, 3, { ...MONO, copies: 2 });
    const res = await pay(h, order).expect(200);
    expect((res.body.order as PublicOrder).status).toBe('QUEUED');

    const events = await h.prisma.orderEvent.findMany({
      where: { orderId: order.order.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(events.map((e) => e.toStatus)).toEqual([
      'DRAFT',
      'AWAITING_PAYMENT',
      'PENDING_REVIEW',
      'QUEUED',
    ]);
    expect(events[3]).toMatchObject({ actorType: 'SYSTEM' });
    expect((await paidEventMeta(order.order.id)).autoAccept).toEqual({
      eligible: true,
      reasons: [],
    });
    const jobs = await h.prisma.printJob.findMany({ where: { orderId: order.order.id } });
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ attempt: 1, status: 'READY', printerId: s.printerId });
    // The agent sees it in its queue like any accepted job.
    const list = await h.http().get('/api/shop/jobs?status=QUEUED').set(s.auth).expect(200);
    expect(list.body.jobs.map((j: { orderId: string }) => j.orderId)).toContain(order.order.id);
  });

  it('offline printer → held in PENDING_REVIEW with the reason', async () => {
    const s = await autoShop();
    await heartbeat(h, s.auth, s.printerId, 'OFFLINE');
    const order = await payableOrder(h, s.shop.id);
    expect((await pay(h, order).expect(200)).body.order.status).toBe('PENDING_REVIEW');
    expect((await paidEventMeta(order.order.id)).autoAccept.reasons).toEqual(['PRINTER_OFFLINE']);
    expect(await h.prisma.printJob.count({ where: { orderId: order.order.id } })).toBe(0);
  });

  it('stale device heartbeat counts as offline', async () => {
    const s = await autoShop();
    await h.prisma.shopDevice.update({
      where: { id: s.deviceId },
      data: { lastHeartbeatAt: new Date(Date.now() - 120_000) },
    });
    const order = await payableOrder(h, s.shop.id);
    expect((await pay(h, order).expect(200)).body.order.status).toBe('PENDING_REVIEW');
    expect((await paidEventMeta(order.order.id)).autoAccept.reasons).toEqual(['PRINTER_OFFLINE']);
  });

  it('unsupported colour → held', async () => {
    const s = await autoShop({ colour: true });
    const order = await payableOrder(h, s.shop.id, 2, { ...MONO, colour: true });
    // The operator re-declares the printer as mono after the order was placed.
    const printer = await h.prisma.printer.findUniqueOrThrow({ where: { id: s.printerId } });
    await h
      .http()
      .put('/api/shop/printers')
      .set(s.auth)
      .send({
        printers: [
          {
            printerName: printer.printerName,
            colourCapable: false,
            duplexCapable: false,
            capabilitiesConfirmed: true,
            isDefault: true,
          },
        ],
      })
      .expect(200);
    expect((await pay(h, order).expect(200)).body.order.status).toBe('PENDING_REVIEW');
    expect((await paidEventMeta(order.order.id)).autoAccept.reasons).toEqual([
      'UNSUPPORTED_COLOUR',
    ]);
  });

  it('over the auto limits → held', async () => {
    const s = await autoShop();
    const order = await payableOrder(h, s.shop.id, 3, { ...MONO, copies: 6 });
    expect((await pay(h, order).expect(200)).body.order.status).toBe('PENDING_REVIEW');
    expect((await paidEventMeta(order.order.id)).autoAccept.reasons).toEqual(['TOO_MANY_COPIES']);

    const many = await payableOrder(h, s.shop.id, 51);
    expect((await pay(h, many).expect(200)).body.order.status).toBe('PENDING_REVIEW');
    expect((await paidEventMeta(many.order.id)).autoAccept.reasons).toEqual(['TOO_MANY_PAGES']);

    const sides = await payableOrder(h, s.shop.id, 50, { ...MONO, copies: 5 }); // 250 sides: ok
    expect((await pay(h, sides).expect(200)).body.order.status).toBe('QUEUED');
  });

  it('paused auto mode and manual mode hold every order', async () => {
    const s = await autoShop();
    await shopAction(h, s.auth, 'patch', '/api/shop/mode', { autoPaused: true }).expect(200);
    const paused = await payableOrder(h, s.shop.id);
    expect((await pay(h, paused).expect(200)).body.order.status).toBe('PENDING_REVIEW');
    expect((await paidEventMeta(paused.order.id)).autoAccept.reasons).toEqual(['AUTO_PAUSED']);

    const manual = await pairedShop(h);
    const order = await payableOrder(h, manual.shop.id);
    expect((await pay(h, order).expect(200)).body.order.status).toBe('PENDING_REVIEW');
    expect((await paidEventMeta(order.order.id)).autoAccept.reasons).toEqual(['MANUAL_MODE']);
  });
});

describe('PATCH /api/shop/mode (contract §3)', () => {
  it('updates mode, audits SHOP_MODE_CHANGED and emits shop.mode_changed', async () => {
    const s = await pairedShop(h);
    const seen: unknown[] = [];
    const listener = (e: unknown) => seen.push(e);
    const bus = h.app.get(EventEmitter2);
    bus.on(DomainEvent.SHOP_MODE_CHANGED, listener);
    try {
      const res = await shopAction(h, s.auth, 'patch', '/api/shop/mode', {
        approvalMode: 'AUTO',
        autoPaused: true,
      }).expect(200);
      expect(res.body).toEqual({ approvalMode: 'AUTO', autoPaused: true, status: 'OPEN' });
    } finally {
      bus.off(DomainEvent.SHOP_MODE_CHANGED, listener);
    }
    expect(seen).toEqual([
      { shopId: s.shop.id, approvalMode: 'AUTO', autoPaused: true, status: 'OPEN' },
    ]);
    expect((await h.http().get('/api/shop/mode').set(s.auth).expect(200)).body).toEqual({
      approvalMode: 'AUTO',
      autoPaused: true,
      status: 'OPEN',
    });
    const audit = await h.prisma.auditLog.findFirstOrThrow({
      where: { shopId: s.shop.id, action: 'SHOP_MODE_CHANGED' },
    });
    expect(audit).toMatchObject({ actorType: 'STAFF' });
    expect(audit.metadata).toMatchObject({ deviceId: s.deviceId });

    // The shop opens and closes itself from its app.
    const closed = await shopAction(h, s.auth, 'patch', '/api/shop/mode', {
      status: 'CLOSED',
    }).expect(200);
    expect(closed.body.status).toBe('CLOSED');
    await shopAction(h, s.auth, 'patch', '/api/shop/mode', { status: 'GONE' }).expect(400);

    await shopAction(h, s.auth, 'patch', '/api/shop/mode', {}).expect(400);
    await shopAction(h, s.auth, 'patch', '/api/shop/mode', { approvalMode: 'YOLO' }).expect(400);
    await h.http().patch('/api/shop/mode').send({ autoPaused: false }).expect(401);
  });
});
