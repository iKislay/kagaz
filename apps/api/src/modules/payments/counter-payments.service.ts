import { HttpStatus, Injectable } from '@nestjs/common';
import { COUNTER_PAYMENT_PROVIDER, type CounterPaymentRequest, OrderStatus } from '@kagaz/shared';
import { type Actor } from '../../common/actor.js';
import { DomainEvent, DomainEventBus } from '../../common/events/domain-events.js';
import { AppError } from '../../common/http/api-exception.filter.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { type Prisma } from '../../generated/prisma/client.js';
import { OrderStateMachine, type Tx } from '../orders/order-state-machine.js';
import { parseOptions, parseQuote } from '../orders/order-view.js';
import { pickupDateString } from '../pickup/pickup-number.service.js';
import { PaymentsService } from './payments.service.js';

/** A waiting counter payment = PENDING counter payment on an order still AWAITING_PAYMENT. */
const waitingWhere = (shopId: string): Prisma.PaymentWhereInput => ({
  provider: COUNTER_PAYMENT_PROVIDER,
  status: 'PENDING',
  order: { shopId, status: OrderStatus.AWAITING_PAYMENT },
});

const REQUEST_INCLUDE = {
  order: {
    include: {
      files: {
        where: { kind: 'ORIGINAL', status: 'VALID' },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  },
} as const satisfies Prisma.PaymentInclude;

type PaymentWithOrder = Prisma.PaymentGetPayload<{ include: typeof REQUEST_INCLUDE }>;

/**
 * Pay at counter, shop side (ADR-003). Choosing "pay at counter" gives the order its daily pickup
 * number (ADR-002) at once; the customer shows "#7" at the counter, a signed-in operator sees
 * "collect ₹X", takes the money and approves. Approval is the payment verification for counter
 * payments: it goes through the same exactly-once paid transition as a gateway payment
 * (auto-accept, printing), with the operator as actor and an audit row. Everything is scoped by
 * the device's shopId (invariant 10); another shop's order is indistinguishable from a missing one.
 */
@Injectable()
export class CounterPaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly stateMachine: OrderStateMachine,
    private readonly events: DomainEventBus,
  ) {}

  async list(shopId: string): Promise<CounterPaymentRequest[]> {
    const rows = await this.prisma.payment.findMany({
      where: waitingWhere(shopId),
      include: REQUEST_INCLUDE,
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    return rows.map(toRequest);
  }

  /**
   * The waiting order with this pickup number. Numbers restart daily, so if an unpaid order from
   * yesterday has the same number as today's, the most recent request wins.
   */
  async lookup(shopId: string, pickupNumber: number): Promise<CounterPaymentRequest> {
    const row = await this.prisma.payment.findFirst({
      where: {
        ...waitingWhere(shopId),
        order: { shopId, status: 'AWAITING_PAYMENT', pickupNumber },
      },
      include: REQUEST_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    if (!row) {
      throw new AppError(
        'COUNTER_PAYMENT_NOT_FOUND',
        `No one is waiting to pay at the counter with number #${pickupNumber}.`,
        HttpStatus.NOT_FOUND,
      );
    }
    return toRequest(row);
  }

  /**
   * The operator collected the money: check the number the customer shows still belongs to this
   * order (no stale selection) and mark it paid, exactly once.
   */
  async approve(
    shopId: string,
    orderId: string,
    pickupNumber: number,
    actor: Actor,
  ): Promise<void> {
    const paidOrderId = await this.prisma.$transaction(async (tx) => {
      const { order, payment } = await this.lockWaiting(tx, shopId, orderId);
      if (order.pickupNumber !== pickupNumber) {
        throw new AppError(
          'PICKUP_NUMBER_MISMATCH',
          `This order is #${order.pickupNumber ?? '?'}, not #${pickupNumber}. Check the number on the customer’s phone.`,
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      const { outcome, paidOrderId } = await this.payments.markPaid(tx, payment, null, {
        actor,
        reason: 'Paid at the counter',
        auditAction: 'payment.counter_collected',
      });
      if (outcome !== 'PAID') throw notPending();
      return paidOrderId;
    });
    if (paidOrderId) await this.payments.afterPaid(paidOrderId);
  }

  /** The customer left without paying: close the counter payment and cancel the order. */
  async cancel(shopId: string, orderId: string, actor: Actor): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const { payment } = await this.lockWaiting(tx, shopId, orderId);
      await tx.payment.updateMany({
        where: { id: payment.id, status: 'PENDING' },
        data: { status: 'FAILED' },
      });
      const order = await this.stateMachine.transition(tx, {
        orderId,
        to: OrderStatus.CANCELLED,
        from: OrderStatus.AWAITING_PAYMENT,
        actor,
        reason: 'Not paid at the counter',
        auditAction: 'payment.counter_cancelled',
        auditMetadata: { paymentId: payment.id },
      });
      this.events.publish(tx, DomainEvent.COUNTER_PAYMENT_CHANGED, {
        orderId,
        shopId,
        orderStatus: OrderStatus.CANCELLED,
        at: order.updatedAt.toISOString(),
      });
    });
  }

  /** Lock the order (same lock as pay/cancel) and return it with its waiting counter payment. */
  private async lockWaiting(tx: Tx, shopId: string, orderId: string) {
    await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
    const order = await tx.order.findFirst({
      where: { id: orderId, shopId },
      include: { payments: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!order) throw new AppError('ORDER_NOT_FOUND', 'Order not found', HttpStatus.NOT_FOUND);
    const payment = order.payments[0];
    if (
      order.status !== OrderStatus.AWAITING_PAYMENT ||
      payment?.provider !== COUNTER_PAYMENT_PROVIDER ||
      payment.status !== 'PENDING'
    ) {
      throw notPending();
    }
    return { order, payment };
  }
}

function notPending(): AppError {
  return new AppError(
    'COUNTER_PAYMENT_NOT_PENDING',
    'This order is not waiting for a counter payment (already paid or cancelled).',
    HttpStatus.CONFLICT,
  );
}

function toRequest(p: PaymentWithOrder): CounterPaymentRequest {
  const quote = parseQuote(p.order.priceSnapshot ?? p.order.quote);
  return {
    orderId: p.orderId,
    publicRef: p.order.publicRef,
    // Always set: pay-at-counter assigns the number in the same transaction as the payment.
    pickupNumber: p.order.pickupNumber ?? 0,
    pickupDate: pickupDateString(p.order.pickupDate) ?? '',
    amountPaise: p.amountPaise,
    options: parseOptions(p.order.options),
    pageCount: p.order.files[0]?.pageCount ?? null,
    printedSides: quote?.printedSides ?? null,
    requestedAt: p.createdAt.toISOString(),
  };
}
