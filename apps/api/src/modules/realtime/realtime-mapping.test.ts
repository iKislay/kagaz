import { describe, expect, it } from 'vitest';
import { OrderStatus, RealtimeEvent, RealtimeNamespace } from '@kagaz/shared';
import { emissionsFor } from './realtime-mapping.js';

const base = {
  orderId: '0190c5f2-0000-7000-8000-000000000001',
  shopId: '0190c5f2-0000-7000-8000-0000000000aa',
  actorType: 'SYSTEM' as const,
  at: '2026-11-07T10:00:00.000Z',
};

const shopEvents = (from: OrderStatus, to: OrderStatus) =>
  emissionsFor({ ...base, from, to }).filter((e) => e.namespace === RealtimeNamespace.SHOP);

describe('realtime mapping (PRD §12, contract §5)', () => {
  it('paid order → job.created in the shop room, order.updated for customer and admin', () => {
    const out = emissionsFor({
      ...base,
      from: OrderStatus.AWAITING_PAYMENT,
      to: OrderStatus.PENDING_REVIEW,
    });
    expect(out).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          namespace: RealtimeNamespace.SHOP,
          room: `shop:${base.shopId}`,
          event: RealtimeEvent.JOB_CREATED,
          payload: { orderId: base.orderId, status: 'PENDING_REVIEW', at: base.at },
        }),
        expect.objectContaining({
          namespace: RealtimeNamespace.CUSTOMER,
          room: `order:${base.orderId}`,
          event: RealtimeEvent.ORDER_UPDATED,
        }),
        expect.objectContaining({
          namespace: RealtimeNamespace.ADMIN,
          room: 'admin',
          event: RealtimeEvent.ORDER_UPDATED,
        }),
      ]),
    );
  });

  it('auto-accepted order (straight to QUEUED) is also job.created', () => {
    expect(shopEvents(OrderStatus.AWAITING_PAYMENT, OrderStatus.QUEUED)[0]?.event).toBe(
      RealtimeEvent.JOB_CREATED,
    );
  });

  it('progress and exits from the working set are job.updated', () => {
    expect(shopEvents(OrderStatus.QUEUED, OrderStatus.PRINTING)[0]?.event).toBe('job.updated');
    expect(shopEvents(OrderStatus.READY_FOR_PICKUP, OrderStatus.COLLECTED)[0]?.event).toBe(
      'job.updated',
    );
    expect(shopEvents(OrderStatus.PENDING_REVIEW, OrderStatus.REJECTED)[0]?.event).toBe(
      'job.updated',
    );
  });

  it('pre-payment transitions are not sent to the shop', () => {
    expect(shopEvents(OrderStatus.DRAFT, OrderStatus.AWAITING_PAYMENT)).toEqual([]);
    expect(shopEvents(OrderStatus.AWAITING_PAYMENT, OrderStatus.CANCELLED)).toEqual([]);
  });

  it('payloads carry ids and status only', () => {
    for (const e of emissionsFor({
      ...base,
      from: OrderStatus.PRINTING,
      to: OrderStatus.READY_FOR_PICKUP,
    })) {
      expect(Object.keys(e.payload).sort()).toEqual(['at', 'orderId', 'status']);
    }
  });
});
