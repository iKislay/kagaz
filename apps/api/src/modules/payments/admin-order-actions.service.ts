import { HttpStatus, Injectable } from '@nestjs/common';
import {
  type AdminOrderActionResult,
  type AdminRejectOrderRequest,
  type HeldOrder,
  OrderStatus,
} from '@kagaz/shared';
import { type Actor } from '../../common/actor.js';
import { AppError } from '../../common/http/api-exception.filter.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { OrderStateMachine } from '../orders/order-state-machine.js';
import { isWithinOpeningHours } from '../shops/opening-hours.js';
import { RefundsService } from './refunds.service.js';

/** Statuses an admin may reject from (before the stack is handed over). */
const ADMIN_REJECTABLE: OrderStatus[] = [
  OrderStatus.PENDING_REVIEW,
  OrderStatus.QUEUED,
  OrderStatus.NEEDS_OPERATOR_CHECK,
];

/** Admin business actions (P3.4 / P3.6): reject after payment → refund, refund retry, holds. */
@Injectable()
export class AdminOrderActionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stateMachine: OrderStateMachine,
    private readonly refunds: RefundsService,
  ) {}

  /** POST /api/admin/orders/:id/reject — REJECTED, unprinted jobs cancelled, then refund. */
  async reject(
    orderId: string,
    req: AdminRejectOrderRequest,
    actor: Actor,
  ): Promise<AdminOrderActionResult> {
    await this.requireOrder(orderId);
    await this.prisma.$transaction(async (tx) => {
      await this.stateMachine.transition(tx, {
        orderId,
        to: OrderStatus.REJECTED,
        from: ADMIN_REJECTABLE,
        actor,
        reason: req.note ?? req.reasonCode,
        auditAction: 'order.admin_rejected',
        metadata: { reasonCode: req.reasonCode },
        data: { rejectionCode: req.reasonCode, rejectionNote: req.note ?? null },
      });
      await tx.printJob.updateMany({
        where: { orderId, status: { in: ['PREPARING', 'READY'] } },
        data: { status: 'CANCELLED' },
      });
    });
    return this.toResult(await this.refunds.request(orderId, `Admin reject: ${req.reasonCode}`));
  }

  /** POST /api/admin/orders/:id/refund — (re)run the refund for a rejected paid order. */
  async retryRefund(orderId: string, actor: Actor): Promise<AdminOrderActionResult> {
    await this.requireOrder(orderId);
    const result = await this.refunds.request(orderId, 'Admin refund retry');
    await this.prisma.auditLog.create({
      data: {
        actorType: actor.type,
        actorId: actor.id,
        orderId,
        action: 'order.refund_retried',
        metadata: { refundId: result.refund?.id ?? null, status: result.refund?.status ?? null },
      },
    });
    return this.toResult(result);
  }

  /**
   * GET /api/admin/held-orders (T19): paid orders waiting in PENDING_REVIEW while their shop
   * is closed, in maintenance or outside opening hours — they are kept, never auto-printed,
   * and need an explicit decision (accept when the shop reopens, or reject → refund).
   */
  async heldOrders(now: Date = new Date()): Promise<HeldOrder[]> {
    const orders = await this.prisma.order.findMany({
      where: { status: OrderStatus.PENDING_REVIEW },
      include: { shop: true },
      orderBy: { paidAt: 'asc' },
      take: 500,
    });
    const held: HeldOrder[] = [];
    for (const o of orders) {
      const reason =
        o.shop.status === 'MAINTENANCE'
          ? 'SHOP_MAINTENANCE'
          : o.shop.status !== 'OPEN'
            ? 'SHOP_NOT_OPEN'
            : !isWithinOpeningHours(o.shop.openingHours, now)
              ? 'OUTSIDE_OPENING_HOURS'
              : null;
      if (!reason) continue;
      held.push({
        orderId: o.id,
        publicRef: o.publicRef,
        shopId: o.shopId,
        shopName: o.shop.name,
        shopStatus: o.shop.status,
        reason,
        amountPaise: o.amountPaise,
        paidAt: o.paidAt?.toISOString() ?? null,
      });
    }
    return held;
  }

  private async requireOrder(orderId: string): Promise<void> {
    const ok =
      /^[0-9a-f-]{36}$/i.test(orderId) &&
      (await this.prisma.order.count({ where: { id: orderId } })) === 1;
    if (!ok) throw new AppError('ORDER_NOT_FOUND', 'Order not found', HttpStatus.NOT_FOUND);
  }

  private toResult(r: Awaited<ReturnType<RefundsService['request']>>): AdminOrderActionResult {
    return { orderId: r.orderId, status: r.orderStatus, refund: r.refund };
  }
}
