import { HttpStatus, Injectable, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { type OrderStatus, canTransition } from '@kagaz/shared';
import { type Actor, isHumanActor } from '../../common/actor.js';
import { DomainEvent, DomainEventBus } from '../../common/events/domain-events.js';
import { AppError } from '../../common/http/api-exception.filter.js';
import { type Order, type Prisma } from '../../generated/prisma/client.js';
import { AuditService } from '../audit/audit.service.js';

export type Tx = Prisma.TransactionClient;

export interface TransitionParams {
  orderId: string;
  to: OrderStatus;
  actor: Actor;
  /** Restrict the allowed source statuses further than the transition table. */
  from?: OrderStatus | readonly OrderStatus[];
  reason?: string;
  metadata?: Prisma.InputJsonValue;
  /** Extra columns to write in the same update (e.g. paidAt, quote, rejectionCode). */
  data?: Omit<Prisma.OrderUncheckedUpdateManyInput, 'id' | 'status' | 'version'>;
  /** Audit action name for human actors (defaults to order.<to lowercase>). */
  auditAction?: string;
  /** Extra audit metadata for human actors (merged with from/to/reason). */
  auditMetadata?: Record<string, Prisma.InputJsonValue | null>;
}

/**
 * The ONLY code allowed to change Order.status (CLAUDE.md invariant 5).
 * Must be called inside a transaction: checks the shared transition table, applies an
 * optimistic-lock update on (status, version), writes an OrderEvent, and an AuditLog row for
 * human actors — all atomically. An `order.status_changed` domain event is queued on the
 * transaction and emitted only after COMMIT (DomainEventBus, P2.1).
 */
@Injectable()
export class OrderStateMachine {
  constructor(
    private readonly audit: AuditService,
    private readonly events: DomainEventBus,
  ) {}

  async transition(tx: Tx, params: TransitionParams): Promise<Order> {
    const order = await tx.order.findUnique({ where: { id: params.orderId } });
    if (!order) {
      throw new AppError('ORDER_NOT_FOUND', 'Order not found', HttpStatus.NOT_FOUND);
    }

    const allowedFrom =
      params.from === undefined ? undefined : ([] as OrderStatus[]).concat(params.from);
    if (
      (allowedFrom && !allowedFrom.includes(order.status)) ||
      !canTransition(order.status, params.to)
    ) {
      throw new AppError(
        'INVALID_TRANSITION',
        `Order ${order.publicRef} cannot move from ${order.status} to ${params.to}`,
        HttpStatus.CONFLICT,
        { from: order.status, to: params.to },
      );
    }

    const updated = await tx.order.updateMany({
      where: { id: order.id, status: order.status, version: order.version },
      data: { ...params.data, status: params.to, version: { increment: 1 } },
    });
    if (updated.count !== 1) {
      throw new AppError(
        'CONCURRENT_MODIFICATION',
        'The order changed at the same time; please retry',
        HttpStatus.CONFLICT,
      );
    }

    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        fromStatus: order.status,
        toStatus: params.to,
        actorType: params.actor.type,
        actorId: params.actor.id,
        reason: params.reason ?? null,
        ...(params.metadata === undefined ? {} : { metadata: params.metadata }),
      },
    });

    if (isHumanActor(params.actor)) {
      await this.audit.record(
        tx,
        params.actor,
        params.auditAction ?? `order.${params.to.toLowerCase()}`,
        {
          shopId: order.shopId,
          orderId: order.id,
          metadata: {
            from: order.status,
            to: params.to,
            reason: params.reason ?? null,
            ...(params.auditMetadata ?? {}),
          },
        },
      );
    }

    const updatedOrder = await tx.order.findUniqueOrThrow({ where: { id: order.id } });
    this.events.publish(tx, DomainEvent.ORDER_STATUS_CHANGED, {
      orderId: order.id,
      shopId: order.shopId,
      publicRef: order.publicRef,
      from: order.status,
      to: params.to,
      actorType: params.actor.type,
      actorId: params.actor.id,
      reason: params.reason ?? null,
      at: updatedOrder.updatedAt.toISOString(),
    });
    return updatedOrder;
  }

  /** Records the initial DRAFT event for a freshly created order. */
  async recordCreated(tx: Tx, order: Order, actor: Actor): Promise<void> {
    await tx.orderEvent.create({
      data: {
        orderId: order.id,
        fromStatus: null,
        toStatus: order.status,
        actorType: actor.type,
        actorId: actor.id,
      },
    });
  }

  /**
   * Optimistic-locked update of non-status fields (options, quote) while the order is in one
   * of the given statuses. Bumps version so concurrent changes are detected.
   */
  async updateFields(
    tx: Tx,
    order: Pick<Order, 'id' | 'version'>,
    inStatuses: readonly OrderStatus[],
    data: Omit<Prisma.OrderUpdateManyMutationInput, 'status' | 'version'>,
  ): Promise<Order> {
    const updated = await tx.order.updateMany({
      where: { id: order.id, version: order.version, status: { in: [...inStatuses] } },
      data: { ...data, version: { increment: 1 } },
    });
    if (updated.count !== 1) {
      throw new AppError(
        'CONCURRENT_MODIFICATION',
        'The order changed at the same time; please retry',
        HttpStatus.CONFLICT,
      );
    }
    return tx.order.findUniqueOrThrow({ where: { id: order.id } });
  }
}
