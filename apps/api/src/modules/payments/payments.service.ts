import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  COUNTER_PAYMENT_PROVIDER,
  OrderStatus,
  type PayAtCounterResponse,
  type PayResponse,
  QuoteSchema,
} from '@kagaz/shared';
import { type Actor, SYSTEM_ACTOR } from '../../common/actor.js';
import { DomainEvent, DomainEventBus } from '../../common/events/domain-events.js';
import { AppError } from '../../common/http/api-exception.filter.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { tenantWhere } from '../../common/prisma/tenant-scope.js';
import { type Order, type Payment } from '../../generated/prisma/client.js';
import { ApprovalService } from '../approval/approval.service.js';
import { OrderStateMachine, type Tx } from '../orders/order-state-machine.js';
import { parseOptions } from '../orders/order-view.js';
import { OrdersService } from '../orders/orders.service.js';
import { PickupNumberService, pickupDateValue } from '../pickup/pickup-number.service.js';
import { PricingService } from '../pricing/pricing.service.js';
import { calculateQuote } from '../pricing/quote.js';
import { ShopsService } from '../shops/shops.service.js';
import { isOnlinePaymentDisabled, onlinePaymentsUnavailable } from './disabled.provider.js';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
  type ProviderPaymentState,
} from './payment-provider.js';

const OPEN_PAYMENT = ['CREATED', 'PENDING'] as const;

/** A provider-reported payment state to apply (from a verified webhook or a status fetch). */
export interface ProviderPaymentUpdate {
  status: ProviderPaymentState;
  providerPaymentId: string | null;
  amountPaise: number | null;
  source: 'WEBHOOK' | 'STATUS_FETCH';
}

/** How a verified payment is recorded on the paid transition. */
export interface MarkPaidOptions {
  /** Who verified it: SYSTEM for gateways, the operator for counter payments (audited). */
  actor: Actor;
  reason: string;
  auditAction?: string;
}

/** What applying an update did — recorded on the webhook event. */
export type ApplyOutcome =
  | 'PAID'
  | 'ALREADY_PAID'
  | 'PENDING'
  | 'FAILED'
  | 'IGNORED_STALE'
  | 'AMOUNT_MISMATCH'
  | 'PAID_ORDER_NOT_PAYABLE';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly stateMachine: OrderStateMachine,
    private readonly pricing: PricingService,
    private readonly approval: ApprovalService,
    private readonly shops: ShopsService,
    private readonly pickupNumbers: PickupNumberService,
    private readonly events: DomainEventBus,
  ) {}

  /**
   * POST /api/orders/:id/pay. The amount always comes from the server-side quote — the client
   * never sends one (FR-CUST-08). Idempotent: repeated or concurrent calls reuse the open
   * payment and produce at most one paid transition (T04). With an open (PENDING) payment it
   * re-checks the provider server-to-server; after a FAILED payment it starts a new attempt.
   * A browser redirect is never proof of payment: only a verified webhook or status fetch is.
   */
  async pay(orderId: string): Promise<PayResponse> {
    // ADR-003: with PAYMENT_PROVIDER=none customers pay at the counter; refuse before any
    // payment row is created so nothing is left half-open.
    if (isOnlinePaymentDisabled(this.provider)) throw onlinePaymentsUnavailable();
    const before = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { payments: { select: { status: true } } },
    });
    if (!before) throw new AppError('ORDER_NOT_FOUND', 'Order not found', HttpStatus.NOT_FOUND);
    const startsNewAttempt = !before.payments.some((p) => p.status !== 'FAILED');
    if (startsNewAttempt && before.status === OrderStatus.AWAITING_PAYMENT) {
      // P3.6: no new checkout while the shop is closed, paused or outside opening hours.
      await this.shops.requireOrderableShop(before.shopId);
      await this.ensureQuoteCurrent(orderId);
    }

    const payment = await this.prisma.$transaction(async (tx) => {
      // Serialize pay attempts per order.
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
      const order = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { payments: { orderBy: { createdAt: 'desc' } } },
      });

      const existing = order.payments.find((p) => p.status !== 'FAILED');
      if (existing?.provider === COUNTER_PAYMENT_PROVIDER) throw counterPaymentChosen();
      if (existing) return existing;

      const total = await this.snapshotTotal(tx, order);
      return tx.payment.create({
        data: {
          orderId,
          provider: this.provider.name,
          amountPaise: total,
          currency: 'INR',
          status: 'CREATED',
          isSimulated: this.provider.simulated,
        },
      });
    });

    let mode: PayResponse['mode'] = 'DEMO_AUTO_APPROVED';
    if (payment.status === 'CREATED' || payment.status === 'PENDING') {
      if (!payment.providerOrderId) {
        const order = await this.prisma.order.findUniqueOrThrow({
          where: { id: orderId },
          include: { _count: { select: { payments: true } } },
        });
        const attempt = order._count.payments;
        const session = await this.provider.createPayment({
          orderId,
          publicRef: order.publicRef,
          receipt: attempt <= 1 ? order.publicRef : `${order.publicRef}-${attempt}`,
          amountPaise: payment.amountPaise,
          currency: 'INR',
        });
        await this.prisma.payment.updateMany({
          where: { id: payment.id, providerOrderId: null },
          data: { providerOrderId: session.providerOrderId, status: 'PENDING' },
        });
        if (session.checkout.kind === 'PROVIDER_CHECKOUT') mode = 'PROVIDER_CHECKOUT';
      }
      // Demo: the simulated gateway settles server-side, so confirm by status fetch now.
      // Live providers are confirmed by their webhook (or a later status fetch).
      if (mode === 'DEMO_AUTO_APPROVED') await this.confirmFromProvider(payment.id);
    }

    return { order: await this.orders.getPublic(orderId), mode };
  }

  /**
   * POST /api/orders/:id/pay-at-counter (ADR-003). Opens a PENDING counter payment for the
   * server's price snapshot and gives the order its ADR-002 daily pickup number now: the customer
   * shows that number at the counter to pay, and the same number later to collect the prints. A
   * signed-in operator approves the payment (CounterPaymentsService). Idempotent: a repeat
   * returns the same waiting payment and number. Refused while an online payment is in flight.
   * Nothing is marked paid here — only the operator's approval does that.
   */
  async payAtCounter(orderId: string): Promise<PayAtCounterResponse> {
    const before = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { payments: { select: { status: true } } },
    });
    if (!before) throw new AppError('ORDER_NOT_FOUND', 'Order not found', HttpStatus.NOT_FOUND);
    const startsNewAttempt = !before.payments.some((p) => p.status !== 'FAILED');
    if (startsNewAttempt && before.status === OrderStatus.AWAITING_PAYMENT) {
      await this.shops.requireOrderableShop(before.shopId);
      await this.ensureQuoteCurrent(orderId);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
      const order = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { payments: { orderBy: { createdAt: 'desc' } } },
      });
      const existing = order.payments.find((p) => p.status !== 'FAILED');
      if (existing?.provider === COUNTER_PAYMENT_PROVIDER) return; // idempotent
      if (existing) {
        throw new AppError(
          'PAYMENT_IN_PROGRESS',
          'An online payment for this order is already in progress',
          HttpStatus.CONFLICT,
        );
      }

      const total = await this.snapshotTotal(tx, order);
      // The number is taken now (not at approval) and never changes; if the customer leaves
      // without paying it is simply not used again (ADR-003: gaps are accepted).
      if (order.pickupNumber === null) {
        const pickup = await this.pickupNumbers.next(tx, order.shopId);
        const current = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
        await this.stateMachine.updateFields(tx, current, [OrderStatus.AWAITING_PAYMENT], {
          pickupNumber: pickup.pickupNumber,
          pickupDate: pickupDateValue(pickup.pickupDate),
        });
      }
      const payment = await tx.payment.create({
        data: {
          orderId,
          provider: COUNTER_PAYMENT_PROVIDER,
          amountPaise: total,
          currency: 'INR',
          status: 'PENDING',
          isSimulated: false,
        },
      });
      this.events.publish(tx, DomainEvent.COUNTER_PAYMENT_CHANGED, {
        orderId,
        shopId: order.shopId,
        orderStatus: OrderStatus.AWAITING_PAYMENT,
        at: payment.createdAt.toISOString(),
      });
    });
    return { order: await this.orders.getPublic(orderId) };
  }

  /**
   * Total to charge, in paise. The immutable price snapshot (FR-PRICE-04) is taken at the first
   * payment attempt (online or counter); a later attempt charges exactly the same snapshot.
   */
  private async snapshotTotal(tx: Tx, order: Order): Promise<number> {
    if (order.status !== OrderStatus.AWAITING_PAYMENT || !order.quote || !order.amountPaise) {
      throw new AppError(
        'ORDER_NOT_PAYABLE',
        'This order is not ready for payment',
        HttpStatus.CONFLICT,
        { status: order.status },
      );
    }
    if (order.priceSnapshot) return QuoteSchema.parse(order.priceSnapshot).totalPaise;
    const quote = QuoteSchema.parse(order.quote);
    await this.stateMachine.updateFields(tx, order, [OrderStatus.AWAITING_PAYMENT], {
      priceSnapshot: { ...quote, snapshotAt: new Date().toISOString() },
      amountPaise: quote.totalPaise,
    });
    return quote.totalPaise;
  }

  /**
   * P2.5: before the FIRST payment attempt the quote must come from the pricing row in effect
   * now. If the shop changed its prices since the customer was quoted, re-quote and answer
   * 409 PRICE_CHANGED so the customer confirms the new amount. Once a snapshot exists (retry
   * after a failed payment) it is kept as is.
   */
  private async ensureQuoteCurrent(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        payments: { select: { id: true } },
        files: { where: { kind: 'ORIGINAL', status: 'VALID' }, take: 1 },
      },
    });
    if (!order || order.status !== OrderStatus.AWAITING_PAYMENT) return;
    if (order.priceSnapshot !== null || order.payments.length > 0 || !order.quote) return;
    const pageCount = order.files[0]?.pageCount;
    if (!pageCount) return;
    const quote = QuoteSchema.parse(order.quote);
    const current = await this.pricing.getEffectivePricing(order.shopId);
    if (current.id === quote.pricingId) return;

    const fresh = calculateQuote(current, parseOptions(order.options), pageCount);
    await this.prisma.$transaction((tx) =>
      this.stateMachine.updateFields(tx, order, [OrderStatus.AWAITING_PAYMENT], {
        quote: fresh,
        amountPaise: fresh.totalPaise,
      }),
    );
    throw new AppError(
      'PRICE_CHANGED',
      'The shop updated its prices. Please check the new total and pay again.',
      HttpStatus.CONFLICT,
      { quote: fresh },
    );
  }

  /**
   * Ask the provider (server-to-server) whether the payment succeeded and apply the result.
   * Safe to call repeatedly — only the first PAID result transitions the order.
   */
  async confirmFromProvider(paymentId: string): Promise<ApplyOutcome | null> {
    const payment = await this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    if (!payment.providerOrderId || payment.provider === COUNTER_PAYMENT_PROVIDER) return null;
    const status = await this.provider.fetchPaymentStatus(payment.providerOrderId);
    const { outcome, paidOrderId } = await this.prisma.$transaction((tx) =>
      this.applyProviderUpdate(tx, payment.id, {
        status: status.state,
        providerPaymentId: status.providerPaymentId,
        amountPaise: status.amountPaise,
        source: 'STATUS_FETCH',
      }),
    );
    if (outcome === 'AMOUNT_MISMATCH') {
      throw new AppError('PAYMENT_AMOUNT_MISMATCH', 'Payment amount mismatch', HttpStatus.CONFLICT);
    }
    if (paidOrderId) await this.afterPaid(paidOrderId);
    return outcome;
  }

  /** Run after the paid transition has COMMITTED: guarded auto-accept (P2.6). */
  async afterPaid(orderId: string): Promise<void> {
    await this.approval.autoAcceptIfEligible(orderId);
  }

  /**
   * Apply a provider-reported state to one payment, monotonically (P3.3):
   * CREATED → PENDING → PAID | FAILED. A PENDING after PAID/FAILED, or FAILED after PAID, is
   * stale and ignored (out-of-order delivery). Must run inside a transaction.
   */
  async applyProviderUpdate(
    tx: Tx,
    paymentId: string,
    update: ProviderPaymentUpdate,
  ): Promise<{ outcome: ApplyOutcome; paidOrderId: string | null }> {
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    switch (update.status) {
      case 'PAID': {
        if (update.amountPaise !== null && update.amountPaise !== payment.amountPaise) {
          this.logger.error(
            { paymentId, orderId: payment.orderId, source: update.source },
            'provider amount mismatch — not marking paid',
          );
          return { outcome: 'AMOUNT_MISMATCH', paidOrderId: null };
        }
        return this.markPaid(tx, payment, update.providerPaymentId, {
          actor: SYSTEM_ACTOR,
          reason: payment.isSimulated
            ? 'Demo payment verified (no money moved)'
            : 'Payment verified',
        });
      }
      case 'PENDING': {
        const moved = await tx.payment.updateMany({
          where: { id: paymentId, status: 'CREATED' },
          data: { status: 'PENDING' },
        });
        return {
          outcome: moved.count === 1 || payment.status === 'PENDING' ? 'PENDING' : 'IGNORED_STALE',
          paidOrderId: null,
        };
      }
      case 'FAILED': {
        const moved = await tx.payment.updateMany({
          where: { id: paymentId, status: { in: [...OPEN_PAYMENT] } },
          data: { status: 'FAILED' },
        });
        return {
          outcome: moved.count === 1 || payment.status === 'FAILED' ? 'FAILED' : 'IGNORED_STALE',
          paidOrderId: null,
        };
      }
    }
  }

  /**
   * Exactly-once paid transition (PRD §9.4 rule 1): the conditional payment update succeeds
   * for one caller only; that caller moves the order AWAITING_PAYMENT → PENDING_REVIEW with
   * the auto-accept evaluation (P2.6) in the event metadata. A success that arrives after a
   * failure is still recorded (the money moved); if the order can no longer take it
   * (cancelled, already paid by another attempt) it is flagged for refund, never transitioned.
   * The ADR-002 daily pickup number is taken here, in the same transaction, exactly once.
   */
  async markPaid(
    tx: Tx,
    payment: Payment,
    providerPaymentId: string | null,
    opts: MarkPaidOptions,
  ): Promise<{ outcome: ApplyOutcome; paidOrderId: string | null }> {
    const updated = await tx.payment.updateMany({
      where: { id: payment.id, status: { in: [...OPEN_PAYMENT, 'FAILED'] } },
      data: {
        status: 'PAID',
        providerPaymentId: providerPaymentId ?? payment.providerPaymentId,
        verifiedAt: new Date(),
      },
    });
    if (updated.count !== 1) return { outcome: 'ALREADY_PAID', paidOrderId: null };

    const order = await tx.order.findUniqueOrThrow({
      where: { id: payment.orderId, ...tenantWhere() },
    });
    if (order.status !== OrderStatus.AWAITING_PAYMENT) {
      this.logger.error(
        { paymentId: payment.id, orderId: order.id, status: order.status },
        'payment succeeded for an order that cannot take it — flagged for refund',
      );
      await tx.auditLog.create({
        data: {
          actorType: 'SYSTEM',
          shopId: order.shopId,
          orderId: order.id,
          action: 'payment.paid_order_not_payable',
          metadata: { paymentId: payment.id, orderStatus: order.status },
        },
      });
      return { outcome: 'PAID_ORDER_NOT_PAYABLE', paidOrderId: null };
    }

    const autoAccept = await this.approval.evaluate(payment.orderId, tx);
    const pickup =
      order.pickupNumber === null ? await this.pickupNumbers.next(tx, order.shopId) : null;
    await this.stateMachine.transition(tx, {
      orderId: payment.orderId,
      to: OrderStatus.PENDING_REVIEW,
      from: OrderStatus.AWAITING_PAYMENT,
      actor: opts.actor,
      reason: opts.reason,
      ...(opts.auditAction
        ? {
            auditAction: opts.auditAction,
            auditMetadata: { paymentId: payment.id, amountPaise: payment.amountPaise },
          }
        : {}),
      metadata: {
        paymentId: payment.id,
        provider: payment.provider,
        simulated: payment.isSimulated,
        autoAccept: { eligible: autoAccept.eligible, reasons: autoAccept.reasons },
        ...(pickup ? { pickupNumber: pickup.pickupNumber, pickupDate: pickup.pickupDate } : {}),
      },
      data: {
        paidAt: new Date(),
        ...(pickup
          ? { pickupNumber: pickup.pickupNumber, pickupDate: pickupDateValue(pickup.pickupDate) }
          : {}),
      },
    });
    return { outcome: 'PAID', paidOrderId: payment.orderId };
  }
}

function counterPaymentChosen(): AppError {
  return new AppError(
    'COUNTER_PAYMENT_PENDING',
    'You chose to pay at the counter. Show your code at the shop counter to pay.',
    HttpStatus.CONFLICT,
  );
}
