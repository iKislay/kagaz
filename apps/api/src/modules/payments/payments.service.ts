import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { OrderStatus, type PayResponse, QuoteSchema } from '@kagaz/shared';
import { SYSTEM_ACTOR } from '../../common/actor.js';
import { AppError } from '../../common/http/api-exception.filter.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { OrderStateMachine, type Tx } from '../orders/order-state-machine.js';
import { parseOptions } from '../orders/order-view.js';
import { OrdersService } from '../orders/orders.service.js';
import { PricingService } from '../pricing/pricing.service.js';
import { calculateQuote } from '../pricing/quote.js';
import { PAYMENT_PROVIDER, type PaymentProvider } from './payment-provider.js';

const OPEN_PAYMENT = ['CREATED', 'PENDING'] as const;

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly stateMachine: OrderStateMachine,
    private readonly pricing: PricingService,
  ) {}

  /**
   * POST /api/orders/:id/pay. The amount always comes from the server-side quote — the
   * client never sends one (FR-CUST-08). Idempotent: repeated or concurrent calls reuse
   * the same payment and produce at most one paid transition (T04).
   */
  async pay(orderId: string): Promise<PayResponse> {
    await this.ensureQuoteCurrent(orderId);
    const payment = await this.prisma.$transaction(async (tx) => {
      // Serialize pay attempts per order.
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { payments: { orderBy: { createdAt: 'desc' } } },
      });
      if (!order) throw new AppError('ORDER_NOT_FOUND', 'Order not found', HttpStatus.NOT_FOUND);

      const existing = order.payments.find((p) => p.status !== 'FAILED');
      if (existing) return existing;

      if (order.status !== OrderStatus.AWAITING_PAYMENT || !order.quote || !order.amountPaise) {
        throw new AppError(
          'ORDER_NOT_PAYABLE',
          'This order is not ready for payment',
          HttpStatus.CONFLICT,
          { status: order.status },
        );
      }

      // Immutable price snapshot (FR-PRICE-04): later price changes never affect this order.
      const quote = QuoteSchema.parse(order.quote);
      await this.stateMachine.updateFields(tx, order, [OrderStatus.AWAITING_PAYMENT], {
        priceSnapshot: { ...quote, snapshotAt: new Date().toISOString() },
        amountPaise: quote.totalPaise,
      });
      return tx.payment.create({
        data: {
          orderId,
          provider: this.provider.name,
          amountPaise: quote.totalPaise,
          currency: 'INR',
          status: 'CREATED',
          isSimulated: this.provider.simulated,
        },
      });
    });

    let mode: PayResponse['mode'] = 'DEMO_AUTO_APPROVED';
    if (payment.status !== 'PAID') {
      let providerOrderId = payment.providerOrderId;
      if (!providerOrderId) {
        const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
        const session = await this.provider.createPayment({
          orderId,
          publicRef: order.publicRef,
          receipt: order.publicRef,
          amountPaise: payment.amountPaise,
          currency: 'INR',
        });
        providerOrderId = session.providerOrderId;
        await this.prisma.payment.updateMany({
          where: { id: payment.id, providerOrderId: null },
          data: { providerOrderId, status: 'PENDING' },
        });
        if (session.checkout.kind === 'PROVIDER_CHECKOUT') mode = 'PROVIDER_CHECKOUT';
      }
      // Demo approves immediately; live providers are confirmed by webhook/status fetch (P3.3).
      if (mode === 'DEMO_AUTO_APPROVED') await this.confirmFromProvider(payment.id);
    }

    return { order: await this.orders.getPublic(orderId), mode };
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
  async confirmFromProvider(paymentId: string): Promise<void> {
    const payment = await this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    if (!payment.providerOrderId) return;
    const status = await this.provider.fetchPaymentStatus(payment.providerOrderId);

    if (status.state === 'PAID') {
      if (status.amountPaise !== null && status.amountPaise !== payment.amountPaise) {
        this.logger.error(
          { paymentId, expected: payment.amountPaise, got: status.amountPaise },
          'provider amount mismatch — not marking paid',
        );
        throw new AppError('PAYMENT_AMOUNT_MISMATCH', 'Payment amount mismatch', 409);
      }
      await this.prisma.$transaction((tx) =>
        this.markPaid(tx, payment.id, status.providerPaymentId),
      );
    } else if (status.state === 'FAILED') {
      await this.prisma.payment.updateMany({
        where: { id: payment.id, status: { in: [...OPEN_PAYMENT] } },
        data: { status: 'FAILED' },
      });
    }
  }

  /**
   * Exactly-once paid transition (PRD §9.4 rule 1): the conditional payment update succeeds
   * for one caller only; that caller moves the order AWAITING_PAYMENT → PENDING_REVIEW.
   * (Guarded auto-accept straight to QUEUED arrives in P2.6.)
   */
  private async markPaid(tx: Tx, paymentId: string, providerPaymentId: string | null) {
    const updated = await tx.payment.updateMany({
      where: { id: paymentId, status: { in: [...OPEN_PAYMENT] } },
      data: { status: 'PAID', providerPaymentId, verifiedAt: new Date() },
    });
    if (updated.count !== 1) return; // already applied

    const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    await this.stateMachine.transition(tx, {
      orderId: payment.orderId,
      to: OrderStatus.PENDING_REVIEW,
      from: OrderStatus.AWAITING_PAYMENT,
      actor: SYSTEM_ACTOR,
      reason: payment.isSimulated ? 'Demo payment verified (no money moved)' : 'Payment verified',
      metadata: { paymentId, provider: payment.provider, simulated: payment.isSimulated },
      data: { paidAt: new Date() },
    });
  }
}
