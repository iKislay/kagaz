import { type OrderStatus } from '@kagaz/shared';
import { type ActorType } from '../actor.js';

/**
 * In-process domain events (EventEmitter2 via @nestjs/event-emitter). Emitted AFTER the DB
 * transaction commits; the realtime module turns them into Socket.IO hints. Any module may emit
 * these by name (inject EventEmitter2) or publish directly through RealtimePublisher.
 */
export const DomainEvent = {
  /** Every OrderStateMachine.transition() — payload OrderTransitionedEvent. */
  ORDER_TRANSITIONED: 'order.transitioned',
  /** Payload ShopModeChangedEvent. */
  SHOP_MODE_CHANGED: 'shop.mode_changed',
  /** Payload DeviceRevokedEvent. Live /shop sockets of that device are disconnected. */
  DEVICE_REVOKED: 'device.revoked',
  /** Payload PrinterStatusEvent (e.g. from heartbeat when a printer's status changes). */
  PRINTER_STATUS: 'printer.status',
  /** Payload DeviceStatusEvent (the realtime module also emits this on socket connect/drop). */
  DEVICE_STATUS: 'device.status',
} as const;

export interface OrderTransitionedEvent {
  orderId: string;
  shopId: string;
  from: OrderStatus;
  to: OrderStatus;
  actorType: ActorType;
  /** ISO-8601 UTC */
  at: string;
}

export interface ShopModeChangedEvent {
  shopId: string;
  approvalMode: 'MANUAL' | 'AUTO';
  autoPaused: boolean;
}

export interface DeviceRevokedEvent {
  shopId: string;
  deviceId: string;
}

export interface PrinterStatusEvent {
  shopId: string;
  printerId: string;
  status: string;
}

export interface DeviceStatusEvent {
  shopId: string;
  deviceId: string;
  online: boolean;
}
