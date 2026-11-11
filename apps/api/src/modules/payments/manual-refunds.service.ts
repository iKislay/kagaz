import { HttpStatus, Injectable } from '@nestjs/common';
import { type ShopManualRefund, formatPaise } from '@kagaz/shared';
import { type Actor, actorMetadata } from '../../common/actor.js';
import { AppError } from '../../common/http/api-exception.filter.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { RefundsService } from './refunds.service.js';

/**
 * ADR-003 §5: with direct-to-shop UPI nobody but the shop can send money back. Pending manual
 * refunds are listed in the shop app; the operator sends the money from their UPI app and
 * confirms it here, which completes the refund (REFUND_PENDING → REFUNDED) and is audited.
 */
@Injectable()
export class ManualRefundsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly refunds: RefundsService,
  ) {}

  /** GET /api/shop/refunds */
  async listPending(shopId: string): Promise<ShopManualRefund[]> {
    const rows = await this.prisma.refund.findMany({
      where: { isManual: true, status: 'PENDING', payment: { order: { shopId } } },
      orderBy: { createdAt: 'asc' },
      take: 100,
      include: {
        payment: {
          select: {
            providerPaymentId: true,
            order: { select: { id: true, publicRef: true, customerPhone: true } },
          },
        },
      },
    });
    return rows.map((r) => ({
      refundId: r.id,
      orderId: r.payment.order.id,
      publicRef: r.payment.order.publicRef,
      amountPaise: r.amountPaise,
      paymentReference: r.payment.providerPaymentId,
      customerPhoneLast4: r.payment.order.customerPhone?.slice(-4) ?? null,
      reason: r.reason,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /** POST /api/shop/refunds/:id/confirm (operator): "I sent the money back". Idempotent. */
  async confirm(
    shopId: string,
    refundId: string,
    utr: string | undefined,
    actor: Actor,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM refunds WHERE id = ${refundId}::uuid FOR UPDATE`;
      const refund = await tx.refund.findFirst({
        where: { id: refundId, isManual: true, payment: { order: { shopId } } },
        include: { payment: { select: { orderId: true } } },
      });
      if (!refund) throw new AppError('REFUND_NOT_FOUND', 'Refund not found', HttpStatus.NOT_FOUND);
      if (refund.status === 'SUCCEEDED') return; // already confirmed — idempotent
      if (refund.status !== 'PENDING') {
        throw new AppError(
          'REFUND_NOT_PENDING',
          'This refund is not pending',
          HttpStatus.CONFLICT,
          {
            status: refund.status,
          },
        );
      }
      const providerRefundId = utr
        ? `manual-utr:${utr}`
        : (refund.providerRefundId ?? `manual:${refund.id}`);
      await this.refunds.applyProviderRefundState(tx, refund.id, 'SUCCEEDED', providerRefundId);
      await tx.auditLog.create({
        data: {
          actorType: actor.type,
          actorId: actor.id,
          shopId,
          orderId: refund.payment.orderId,
          action: 'refund.manual_confirmed',
          metadata: {
            refundId: refund.id,
            amount: formatPaise(refund.amountPaise),
            utrLast4: utr?.slice(-4) ?? null,
            ...actorMetadata(actor),
          },
        },
      });
    });
  }
}
