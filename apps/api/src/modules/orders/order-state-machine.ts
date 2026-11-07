import { HttpStatus, Injectable } from '@nestjs/common';
import { type OrderStatus, canTransition } from '@kagaz/shared';
import { type Actor, actorMetadata, isHumanActor } from '../../common/actor.js';
import { AppError } from '../../common/http/api-exception.filter.js';
import { type Order, type Prisma } from '../../generated/prisma/client.js';

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
}

/**
 * The ONLY code allowed to change Order.status (CLAUDE.md invariant 5).
 * Must be called inside a transaction: checks the shared transition table, applies an
 * optimistic-lock update on (status, version), writes an OrderEvent, and an AuditLog row for
 * human actors — all atomically. Realtime notifications are emitted by callers after commit.
 */
@Injectable()
export class OrderStateMachine {
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
      await tx.auditLog.create({
        data: {
          actorType: params.actor.type,
          actorId: params.actor.id,
          shopId: order.shopId,
          orderId: order.id,
          action: params.auditAction ?? `order.${params.to.toLowerCase()}`,
          metadata: {
            from: order.status,
            to: params.to,
            reason: params.reason ?? null,
            ...actorMetadata(params.actor),
          },
        },
      });
    }

    return tx.order.findUniqueOrThrow({ where: { id: order.id } });
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
