import { Inject, Injectable, Logger } from '@nestjs/common';
import { OrderStatus } from '@kagaz/shared';
import { type Actor, SYSTEM_ACTOR } from '../../common/actor.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { OrderStateMachine, type Tx } from '../orders/order-state-machine.js';
import { PAYMENT_PROVIDER, type PaymentProvider } from './payment-provider.js';

/**
 * Refund workflow for rejected paid orders (PRD §9.1, FR-PAY-07).
 * Phase 1: synchronous; demo refunds are recorded as simulated ("Demo refund — no money
 * moved"). Webhook-confirmed live refunds and reconciliation arrive in P3.4 / P3.7.
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
   * Inside the rejection transaction: if the order was paid, record a PENDING refund and
   * move REJECTED → REFUND_PENDING. Returns the refund id to execute after commit.
   */
  async openForRejectedOrder(tx: Tx, orderId: string, actor: Actor): Promise<string | null> {
    const payment = await tx.payment.findFirst({
      where: { orderId, status: 'PAID' },
      orderBy: { createdAt: 'desc' },
    });
    if (!payment) return null;

    const refund = await tx.refund.create({
      data: {
        paymentId: payment.id,
        amountPaise: payment.amountPaise,
        idempotencyKey: `refund:${payment.id}:1`,
        reason: 'Order rejected',
        isSimulated: payment.isSimulated,
      },
    });
    await tx.payment.update({ where: { id: payment.id }, data: { status: 'REFUND_PENDING' } });
    await this.stateMachine.transition(tx, {
      orderId,
      to: OrderStatus.REFUND_PENDING,
      from: OrderStatus.REJECTED,
      actor,
      reason: payment.isSimulated ? 'Demo refund requested' : 'Refund requested',
      metadata: { refundId: refund.id },
    });
    return refund.id;
  }

  /** After commit: ask the provider to refund and record the outcome. Safe to retry. */
  async execute(refundId: string): Promise<void> {
    const refund = await this.prisma.refund.findUniqueOrThrow({
      where: { id: refundId },
      include: { payment: true },
    });
    if (refund.status !== 'PENDING' || !refund.payment.providerPaymentId) return;

    let result;
    try {
      result = await this.provider.refund({
        providerPaymentId: refund.payment.providerPaymentId,
        amountPaise: refund.amountPaise,
        idempotencyKey: refund.idempotencyKey,
      });
    } catch (err) {
      // Stays REFUND_PENDING; reconciliation (P3.7) flags it for follow-up.
      this.logger.error({ err, refundId }, 'refund request failed');
      return;
    }
    if (result.state !== 'SUCCEEDED') {
      await this.prisma.refund.update({
        where: { id: refund.id },
        data: { providerRefundId: result.providerRefundId },
      });
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      const done = await tx.refund.updateMany({
        where: { id: refund.id, status: 'PENDING' },
        data: {
          status: 'SUCCEEDED',
          providerRefundId: result.providerRefundId,
          completedAt: new Date(),
        },
      });
      if (done.count !== 1) return;
      await tx.payment.update({ where: { id: refund.paymentId }, data: { status: 'REFUNDED' } });
      await this.stateMachine.transition(tx, {
        orderId: refund.payment.orderId,
        to: OrderStatus.REFUNDED,
        from: OrderStatus.REFUND_PENDING,
        actor: SYSTEM_ACTOR,
        reason: refund.isSimulated ? 'Demo refund — no money moved' : 'Refund confirmed',
        metadata: { refundId: refund.id, providerRefundId: result.providerRefundId },
      });
    });
  }
}
