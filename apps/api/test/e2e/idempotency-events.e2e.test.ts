import { EventEmitter2 } from '@nestjs/event-emitter';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  DomainEvent,
  DomainEventBus,
  type OrderStatusChangedEvent,
} from '../../src/common/events/domain-events.js';
import { type Harness, createHarness } from './harness.js';
import { pairedShop, paidOrder, printingOrder, readyOrder } from './shop-helpers.js';

/** P2.1: post-commit domain events, Idempotency-Key replays, audit in the same transaction. */
let h: Harness;
let emitter: EventEmitter2;
let seen: OrderStatusChangedEvent[] = [];
const listener = (e: OrderStatusChangedEvent) => seen.push(e);

beforeAll(async () => {
  h = await createHarness();
  emitter = h.app.get(EventEmitter2);
  emitter.on(DomainEvent.ORDER_STATUS_CHANGED, listener);
});
afterEach(() => {
  seen = [];
});
afterAll(async () => {
  emitter.off(DomainEvent.ORDER_STATUS_CHANGED, listener);
  await h.close();
});

const counts = async (orderId: string) => ({
  events: await h.prisma.orderEvent.count({ where: { orderId } }),
  audits: await h.prisma.auditLog.count({ where: { orderId } }),
  jobs: await h.prisma.printJob.count({ where: { orderId } }),
});

describe('post-commit domain events (P2.1)', () => {
  it('emits order.status_changed after commit for every transition', async () => {
    const s = await pairedShop(h);
    const created = await paidOrder(h, s.shop.id);
    seen = [];
    await s.human(`jobs/${created.order.id}/accept`).expect(200);
    expect(seen).toEqual([
      expect.objectContaining({
        orderId: created.order.id,
        shopId: s.shop.id,
        publicRef: created.order.publicRef,
        from: 'PENDING_REVIEW',
        to: 'QUEUED',
        // The signed-in operator is the actor of human actions (contract §4).
        actorType: 'STAFF',
      }),
    ]);
    // Emitted after commit: the listener-visible state is already in the database.
    const order = await h.prisma.order.findUniqueOrThrow({ where: { id: created.order.id } });
    expect(order.status).toBe('QUEUED');
  });

  it('drops queued events when the transaction rolls back', async () => {
    const bus = h.app.get(DomainEventBus);
    await expect(
      h.prisma.$transaction(async (tx) => {
        bus.publish(tx, DomainEvent.ORDER_STATUS_CHANGED, {
          orderId: '00000000-0000-0000-0000-000000000000',
          shopId: '00000000-0000-0000-0000-000000000000',
          publicRef: 'KGZ-ROLLBK',
          from: 'QUEUED',
          to: 'PRINTING',
          actorType: 'SYSTEM',
          actorId: null,
          reason: null,
          at: new Date().toISOString(),
        });
        expect(seen).toHaveLength(0); // not before commit
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(seen).toHaveLength(0);
  });

  it('a failed transition (409) emits nothing', async () => {
    const s = await pairedShop(h);
    const created = await paidOrder(h, s.shop.id);
    seen = [];
    // Not in NEEDS_OPERATOR_CHECK → 409.
    await s.human(`jobs/${created.order.id}/resolve`, { action: 'CONFIRM_PRINTED' }).expect(409);
    expect(seen).toHaveLength(0);
  });
});

describe('Idempotency-Key (P2.1 done-when, P4.6)', () => {
  it('replaying accept / spooler-complete returns identical responses and no extra events', async () => {
    const s = await pairedShop(h);
    const created = await paidOrder(h, s.shop.id);
    const id = created.order.id;

    const accept1 = await s.human(`jobs/${id}/accept`, {}, { 'Idempotency-Key': 'accept-key-1' });
    expect(accept1.status).toBe(200);
    const after = await counts(id);
    seen = [];
    const accept2 = await s.human(`jobs/${id}/accept`, {}, { 'Idempotency-Key': 'accept-key-1' });
    expect(accept2.status).toBe(200);
    expect(accept2.body).toEqual(accept1.body);
    expect(await counts(id)).toEqual(after);
    expect(seen).toHaveLength(0);

    const printJobId = accept1.body.printJob.id as string;
    await s.agent(`print-jobs/${printJobId}/lease`).expect(200);
    await s.agent(`print-jobs/${printJobId}/status`, { status: 'SUBMITTED' }).expect(200);

    const complete = () =>
      s.agent(
        `print-jobs/${printJobId}/status`,
        { status: 'SPOOLER_COMPLETE' },
        { 'Idempotency-Key': 'complete-key-1' },
      );
    const c1 = await complete();
    expect(c1.status).toBe(200);
    expect(c1.body.status).toBe('READY_FOR_PICKUP');
    const afterReady = await counts(id);
    seen = [];
    const c2 = await complete();
    expect(c2.status).toBe(200);
    expect(c2.body).toEqual(c1.body);
    expect(await counts(id)).toEqual(afterReady);
    expect(seen).toHaveLength(0);
  });

  it('same key with a different body → 409 IDEMPOTENCY_KEY_REUSED', async () => {
    const s = await pairedShop(h);
    const a = await paidOrder(h, s.shop.id);
    const b = await paidOrder(h, s.shop.id);
    await s
      .human(`jobs/${a.order.id}/accept`, {}, { 'Idempotency-Key': 'shared-key-1' })
      .expect(200);
    const res = await s
      .human(`jobs/${b.order.id}/accept`, {}, { 'Idempotency-Key': 'shared-key-1' })
      .expect(409);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect((await h.prisma.order.findUniqueOrThrow({ where: { id: b.order.id } })).status).toBe(
      'PENDING_REVIEW',
    );
  });

  it('keys are per device, errors are not stored, malformed keys are refused', async () => {
    const s = await pairedShop(h);
    const other = await pairedShop(h);
    const created = await paidOrder(h, s.shop.id);
    // An error response is not stored: the same key can be retried after fixing the cause.
    await s
      .human(
        `jobs/${created.order.id}/resolve`,
        { action: 'CONFIRM_PRINTED' },
        { 'Idempotency-Key': 'k-err-001' },
      )
      .expect(409);
    expect(await h.prisma.idempotencyRecord.count({ where: { key: 'k-err-001' } })).toBe(0);
    // Another device may use the same key value independently.
    const otherOrder = await paidOrder(h, other.shop.id);
    await other
      .human(`jobs/${otherOrder.order.id}/accept`, {}, { 'Idempotency-Key': 'k-err-001' })
      .expect(200);

    const bad = await s
      .human(`jobs/${created.order.id}/accept`, {}, { 'Idempotency-Key': 'no spaces!' })
      .expect(400);
    expect(bad.body.error.code).toBe('IDEMPOTENCY_KEY_INVALID');
  });

  it('status reports with a key replay the stored result (P4.6)', async () => {
    const s = await pairedShop(h);
    const { created, printJobId } = await printingOrder(h, s);
    const report = () =>
      s.agent(
        `print-jobs/${printJobId}/status`,
        { status: 'FAILED', error: 'Paper jam' },
        { 'Idempotency-Key': 'report-fail-1' },
      );
    const r1 = await report();
    const r2 = await report();
    expect(r1.status).toBe(200);
    expect(r2.body).toEqual(r1.body);
    const events = await h.prisma.orderEvent.findMany({
      where: { orderId: created.order.id, toStatus: 'NEEDS_OPERATOR_CHECK' },
    });
    expect(events).toHaveLength(1);
  });

  it('paid → printed → ready flow works end to end with helpers (ADR-002)', async () => {
    const s = await pairedShop(h);
    const { pickupNumber } = await readyOrder(h, s);
    expect(pickupNumber).toBe(1);
  });
});
