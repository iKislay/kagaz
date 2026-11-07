import { OrderStatus, type OrderStatusHint, RealtimeEvent, RealtimeNamespace } from '@kagaz/shared';
import { type OrderStatusChangedEvent } from '../../common/events/domain-events.js';

/** Statuses a shop works on (what GET /api/shop/jobs lists by default). */
export const SHOP_VISIBLE: ReadonlySet<OrderStatus> = new Set([
  OrderStatus.PENDING_REVIEW,
  OrderStatus.QUEUED,
  OrderStatus.PRINTING,
  OrderStatus.NEEDS_OPERATOR_CHECK,
  OrderStatus.READY_FOR_PICKUP,
]);

export interface Emission {
  namespace: RealtimeNamespace;
  room: string;
  event: string;
  payload: OrderStatusHint;
}

export const shopRoom = (shopId: string) => `shop:${shopId}`;
export const orderRoom = (orderId: string) => `order:${orderId}`;
export const ADMIN_ROOM = 'admin';

/**
 * Maps one committed order transition to the Socket.IO hints of contract §5:
 *  - customer `order:{id}` and `admin`: `order.updated` for every transition;
 *  - shop `shop:{shopId}`: `job.created` when the order first becomes visible to the shop
 *    (e.g. paid → PENDING_REVIEW, or straight to QUEUED in auto mode), `job.updated` for any
 *    other transition into, within or out of the shop's working set.
 * Payloads are ids + status only (no PII, no URLs).
 */
export function emissionsFor(
  e: Pick<OrderStatusChangedEvent, 'orderId' | 'shopId' | 'from' | 'to' | 'at'>,
): Emission[] {
  const payload: OrderStatusHint = { orderId: e.orderId, status: e.to, at: e.at };
  const out: Emission[] = [
    {
      namespace: RealtimeNamespace.CUSTOMER,
      room: orderRoom(e.orderId),
      event: RealtimeEvent.ORDER_UPDATED,
      payload,
    },
    {
      namespace: RealtimeNamespace.ADMIN,
      room: ADMIN_ROOM,
      event: RealtimeEvent.ORDER_UPDATED,
      payload,
    },
  ];
  const wasVisible = SHOP_VISIBLE.has(e.from);
  const isVisible = SHOP_VISIBLE.has(e.to);
  if (isVisible || wasVisible) {
    out.push({
      namespace: RealtimeNamespace.SHOP,
      room: shopRoom(e.shopId),
      event: !wasVisible && isVisible ? RealtimeEvent.JOB_CREATED : RealtimeEvent.JOB_UPDATED,
      payload,
    });
  }
  return out;
}
