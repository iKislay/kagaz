import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { COUNTER_PAYMENT_PROVIDER, OrderStatus } from '@kagaz/shared';
import { type Actor, SYSTEM_ACTOR } from '../../common/actor.js';
import { AppError } from '../../common/http/api-exception.filter.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { OrderStateMachine, type Tx } from '../orders/order-state-machine.js';
import { PAYMENT_PROVIDER, type PaymentProvider } from './payment-provider.js';
import { tenantWhere } from '../../common/prisma/tenant-scope.js';

export interface RefundSummary {
  id: string;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  amountPaise: number;
  isSimulated: boolean;
}

/** Result of RefundService.request — `refund` is null when the order was never paid. */
export interface RefundRequestResult {
  orderId: string;
  orderStatus: OrderStatus;
  refund: RefundSummary | null;
}

/** Payment statuses that mean "money was received for this order". */
const REFUNDABLE_PAYMENT = ['PAID', 'REFUND_PENDING', 'REFUNDED'] as const;

/**
 * Refund workflow (P3.4, PRD §9.1, FR-PAY-07): REJECTED → REFUND_PENDING → REFUNDED.
 * - idempotency key `refund:<paymentId>:<n>`; n grows only after a FAILED refund
 * - the provider call happens after commit; demo refunds succeed synchronously and are
 *   recorded as simulated ("Demo refund — no money moved"); live refunds are confirmed by a
 *   REFUND webhook (`applyProviderRefundState`)
 * Payment status and order status move together but stay separate fields (invariant 6).
 */
@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly prisma: PrismaService,
    private readonly stateMachine: OrderStateMachine,
  ) {}

  /**
   * STABLE API (used by needs-check MARK_FAILED, admin reject, admin refund retry).
   * Call AFTER the order has been moved to REJECTED (committed). Idempotent: repeated calls
   * return the same refund; a FAILED refund is retried with the next idempotency key.
   */
  async request(orderId: string, reason: string): Promise<RefundRequestResult> {
    const opened = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
      const order = await tx.order.findUnique({ where: { id: orderId, ...tenantWhere() } });
      if (!order) throw new AppError('ORDER_NOT_FOUND', 'Order not found', HttpStatus.NOT_FOUND);
      const refundable: OrderStatus[] = [
        OrderStatus.REJECTED,
        OrderStatus.REFUND_PENDING,
        OrderStatus.REFUNDED,
      ];
      if (!refundable.includes(order.status)) {
        throw new AppError(
          'INVALID_TRANSITION',
          `A ${order.status} order cannot be refunded; reject it first`,
          HttpStatus.CONFLICT,
          { status: order.status },
        );
      }
      return this.open(tx, orderId, SYSTEM_ACTOR, reason);
    });

    if (opened && opened.status === 'PENDING') await this.execute(opened.id);
    return this.summary(orderId);
  }

  /**
   * Inside the rejection transaction: if the order was paid, record (or reuse) a PENDING
   * refund and move REJECTED → REFUND_PENDING. Returns the refund id to execute after commit.
   */
  async openForRejectedOrder(tx: Tx, orderId: string, actor: Actor): Promise<string | null> {
    const refund = await this.open(tx, orderId, actor, 'Order rejected');
    return refund && refund.status === 'PENDING' ? refund.id : null;
  }

  private async open(
    tx: Tx,
    orderId: string,
    actor: Actor,
    reason: string,
  ): Promise<{ id: string; status: string } | null> {
    const payment = await tx.payment.findFirst({
      where: { orderId, status: { in: [...REFUNDABLE_PAYMENT] } },
      orderBy: { createdAt: 'desc' },
      include: { refunds: { orderBy: { createdAt: 'desc' } } },
    });
    if (!payment) return null;

    const live = payment.refunds.find((r) => r.status !== 'FAILED');
    const refund =
      live ??
      (await tx.refund.create({
        data: {
          paymentId: payment.id,
          amountPaise: payment.amountPaise,
          idempotencyKey: `refund:${payment.id}:${payment.refunds.length + 1}`,
          reason: reason.slice(0, 500),
          isSimulated: payment.isSimulated,
        },
      }));
    if (refund.status === 'PENDING') {
      await tx.payment.updateMany({
        where: { id: payment.id, status: 'PAID' },
        data: { status: 'REFUND_PENDING' },
      });
    }
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId, ...tenantWhere() } });
    if (order.status === OrderStatus.REJECTED) {
      await this.stateMachine.transition(tx, {
        orderId,
        to: OrderStatus.REFUND_PENDING,
        from: OrderStatus.REJECTED,
        actor,
        reason: payment.isSimulated ? 'Demo refund requested' : 'Refund requested',
        metadata: { refundId: refund.id, idempotencyKey: refund.idempotencyKey },
        auditAction: 'order.refund_requested',
      });
    }
    return { id: refund.id, status: refund.status };
  }

  /** After commit: ask the provider to refund and record the outcome. Safe to retry. */
  async execute(refundId: string): Promise<void> {
    const refund = await this.prisma.refund.findUniqueOrThrow({
      where: { id: refundId },
      include: { payment: true },
    });
    if (refund.status !== 'PENDING') return;
    // ADR-003: money taken at the counter goes back as cash at the counter. The operator who
    // rejects a counter-paid order hands it back (the shop app says so), so it completes here.
    if (refund.payment.provider === COUNTER_PAYMENT_PROVIDER) {
      await this.prisma.$transaction((tx) =>
        this.applyProviderRefundState(tx, refund.id, 'SUCCEEDED', `counter-cash:${refund.id}`),
      );
      return;
    }
    if (!refund.payment.providerPaymentId) return;

    let result;
    try {
      result = await this.provider.refund({
        providerPaymentId: refund.payment.providerPaymentId,
        amountPaise: refund.amountPaise,
        idempotencyKey: refund.idempotencyKey,
      });
    } catch (err) {
      // Stays PENDING; a retry (admin "retry refund") re-sends the same idempotency key.
      this.logger.error(
        { err, refundId, orderId: refund.payment.orderId },
        'refund request failed',
      );
      return;
    }
    await this.prisma.$transaction((tx) =>
      this.applyProviderRefundState(tx, refund.id, result.status, result.providerRefundId),
    );
  }

  /**
   * Apply the provider's refund state (sync result or REFUND webhook). SUCCEEDED completes the
   * refund once: refund SUCCEEDED, payment REFUNDED, order REFUND_PENDING → REFUNDED.
   */
  async applyProviderRefundState(
    tx: Tx,
    refundId: string,
    status: 'PENDING' | 'SUCCEEDED' | 'FAILED',
    providerRefundId: string,
  ): Promise<'SUCCEEDED' | 'FAILED' | 'PENDING' | 'ALREADY_FINAL'> {
    if (status === 'PENDING') {
      await tx.refund.updateMany({
        where: { id: refundId, status: 'PENDING' },
        data: { providerRefundId },
      });
      return 'PENDING';
    }
    if (status === 'FAILED') {
      const failed = await tx.refund.updateMany({
        where: { id: refundId, status: 'PENDING' },
        data: { status: 'FAILED', providerRefundId, completedAt: new Date() },
      });
      if (failed.count === 1) this.logger.error({ refundId }, 'provider reported refund FAILED');
      return failed.count === 1 ? 'FAILED' : 'ALREADY_FINAL';
    }
    const done = await tx.refund.updateMany({
      where: { id: refundId, status: 'PENDING' },
      data: { status: 'SUCCEEDED', providerRefundId, completedAt: new Date() },
    });
    if (done.count !== 1) return 'ALREADY_FINAL';
    const refund = await tx.refund.findUniqueOrThrow({
      where: { id: refundId },
      include: { payment: true },
    });
    await tx.payment.update({ where: { id: refund.paymentId }, data: { status: 'REFUNDED' } });
    const order = await tx.order.findUniqueOrThrow({
      where: { id: refund.payment.orderId, ...tenantWhere() },
    });
    if (order.status === OrderStatus.REFUND_PENDING) {
      await this.stateMachine.transition(tx, {
        orderId: order.id,
        to: OrderStatus.REFUNDED,
        from: OrderStatus.REFUND_PENDING,
        actor: SYSTEM_ACTOR,
        reason: refund.isSimulated
          ? 'Demo refund — no money moved'
          : refund.payment.provider === COUNTER_PAYMENT_PROVIDER
            ? 'Cash refunded at the counter'
            : 'Refund confirmed',
        metadata: { refundId: refund.id, providerRefundId, simulated: refund.isSimulated },
      });
    }
    return 'SUCCEEDED';
  }

  private async summary(orderId: string): Promise<RefundRequestResult> {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId, ...tenantWhere() },
      include: {
        payments: {
          include: { refunds: { orderBy: { createdAt: 'desc' }, take: 1 } },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    const latest = order.payments.flatMap((p) => p.refunds)[0];
    return {
      orderId,
      orderStatus: order.status,
      refund: latest
        ? {
            id: latest.id,
            status: latest.status,
            amountPaise: latest.amountPaise,
            isSimulated: latest.isSimulated,
          }
        : null,
    };
  }
}

/** Contract §2 name: `RefundService.request(orderId, reason)`. Same class, same DI token. */
export { RefundsService as RefundService };
