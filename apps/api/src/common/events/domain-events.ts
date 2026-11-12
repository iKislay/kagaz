import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { type OrderStatus } from '@kagaz/shared';
import { type ActorType } from '../actor.js';

/**
 * In-process domain events (P2.1). They are queued while a transaction runs and emitted on
 * the EventEmitter2 bus only after it COMMITS (rolled-back work never produces events).
 * Subscribers (realtime gateway, admin health, ...) use `@OnEvent(DomainEvent.X)`.
 * Events are hints: everything they carry is also recoverable via REST (invariant 13).
 */
export const DomainEvent = {
  /** Every OrderStateMachine.transition(). */
  ORDER_STATUS_CHANGED: 'order.status_changed',
  /** A print attempt changed status (lease, submitted, spooler complete, failed, ...). */
  PRINT_JOB_STATUS_CHANGED: 'print_job.status_changed',
  /** A device came online (heartbeat after being offline) or went offline (sweeper). */
  DEVICE_STATUS_CHANGED: 'device.status_changed',
  /** A printer's reported status changed (heartbeat). */
  PRINTER_STATUS_CHANGED: 'printer.status_changed',
  /** A shop's approval mode or auto-pause changed (PATCH /api/shop/mode, admin). */
  SHOP_MODE_CHANGED: 'shop.mode_changed',
  /** A device token was revoked; live sockets of that device must be dropped. */
  DEVICE_REVOKED: 'device.revoked',
  /** ADR-003: a counter payment was requested, approved or abandoned (shop list changed). */
  COUNTER_PAYMENT_CHANGED: 'counter_payment.changed',
} as const;
export type DomainEventName = (typeof DomainEvent)[keyof typeof DomainEvent];

export interface OrderStatusChangedEvent {
  orderId: string;
  shopId: string;
  publicRef: string;
  from: OrderStatus;
  to: OrderStatus;
  actorType: ActorType;
  actorId: string | null;
  reason: string | null;
  /** ISO-8601 time of the transition. */
  at: string;
}

export interface PrintJobStatusChangedEvent {
  printJobId: string;
  orderId: string;
  shopId: string;
  printerId: string;
  attempt: number;
  status: string;
  at: string;
}

export interface DeviceStatusChangedEvent {
  deviceId: string;
  shopId: string;
  online: boolean;
  at: string;
}

export interface PrinterStatusChangedEvent {
  printerId: string;
  shopId: string;
  status: string;
  lastError: string | null;
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

export interface CounterPaymentChangedEvent {
  orderId: string;
  shopId: string;
  /** Order status after the change (AWAITING_PAYMENT while waiting, CANCELLED when abandoned). */
  orderStatus: OrderStatus;
  at: string;
}

export interface DomainEventPayloads {
  [DomainEvent.ORDER_STATUS_CHANGED]: OrderStatusChangedEvent;
  [DomainEvent.PRINT_JOB_STATUS_CHANGED]: PrintJobStatusChangedEvent;
  [DomainEvent.DEVICE_STATUS_CHANGED]: DeviceStatusChangedEvent;
  [DomainEvent.PRINTER_STATUS_CHANGED]: PrinterStatusChangedEvent;
  [DomainEvent.SHOP_MODE_CHANGED]: ShopModeChangedEvent;
  [DomainEvent.DEVICE_REVOKED]: DeviceRevokedEvent;
  [DomainEvent.COUNTER_PAYMENT_CHANGED]: CounterPaymentChangedEvent;
}

interface QueuedEvent {
  name: DomainEventName;
  payload: unknown;
}

/**
 * Post-commit outbox. PrismaService opens a queue for every interactive transaction and
 * flushes it after commit; `publish(tx, ...)` appends to that queue. Called with a
 * non-transactional client, the write has already committed, so the event goes out at once.
 */
@Injectable()
export class DomainEventBus {
  private readonly logger = new Logger(DomainEventBus.name);
  private readonly queues = new WeakMap<object, QueuedEvent[]>();

  constructor(private readonly emitter: EventEmitter2) {}

  publish<N extends DomainEventName>(
    client: object,
    name: N,
    payload: DomainEventPayloads[N],
  ): void {
    const queue = this.queues.get(client);
    if (queue) queue.push({ name, payload });
    else this.emit({ name, payload });
  }

  /** @internal PrismaService: a transaction client was created. */
  open(tx: object): QueuedEvent[] {
    const queue: QueuedEvent[] = [];
    this.queues.set(tx, queue);
    return queue;
  }

  /** @internal PrismaService: the transaction committed. */
  flush(queue: QueuedEvent[]): void {
    for (const event of queue.splice(0)) this.emit(event);
  }

  private emit(event: QueuedEvent): void {
    try {
      this.emitter.emit(event.name, event.payload);
    } catch (err) {
      // A broken subscriber must never fail the request whose work already committed.
      this.logger.error({ err, event: event.name }, 'domain event subscriber failed');
    }
  }
}
