import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  type DeclinePaymentReportRequest,
  type DeclineReason,
  type PublicOrder,
  type ShopPaymentReport,
  formatPaise,
} from '@kagaz/shared';
import { type Actor, actorMetadata } from '../../common/actor.js';
import { APP_CONFIG } from '../../common/config/config.module.js';
import { type AppConfig } from '../../common/config/config.schema.js';
import { DomainEvent, DomainEventBus } from '../../common/events/domain-events.js';
import { AppError } from '../../common/http/api-exception.filter.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { paymentReportWindow, MAX_PAYMENT_REPORTS_PER_ORDER } from '../orders/order-view.js';
import { OrdersService } from '../orders/orders.service.js';
import { PaymentsService } from './payments.service.js';

const REPORT_SELECT = {
  id: true,
  orderId: true,
  amountPaise: true,
  utr: true,
  status: true,
  createdAt: true,
  decidedAt: true,
  declineReason: true,
  order: { select: { publicRef: true, customerPhone: true } },
} as const satisfies Prisma.PaymentReportSelect;

type ReportRow = Prisma.PaymentReportGetPayload<{ select: typeof REPORT_SELECT }>;

function toShopReport(r: ReportRow): ShopPaymentReport {
  return {
    id: r.id,
    orderId: r.orderId,
    publicRef: r.order.publicRef,
    amountPaise: r.amountPaise,
    utr: r.utr,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    decidedAt: r.decidedAt?.toISOString() ?? null,
    declineReason: (r.declineReason as DeclineReason | null) ?? null,
    customerPhoneLast4: r.order.customerPhone ? r.order.customerPhone.slice(-4) : null,
  };
}

const isUniqueViolation = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

const utrUsed = () =>
  new AppError(
    'PAYMENT_REPORT_UTR_USED',
    'This UPI reference was already used for another order.',
    HttpStatus.CONFLICT,
  );

/**
 * ADR-003 §4 fallback: "I paid but it isn't confirmed". The customer reports the UPI
 * reference; the shop checks its own UPI app and approves or declines. Approval goes through
 * the same exactly-once paid transition as a verified webhook (PaymentsService.applyProviderUpdate,
 * source MANUAL), with the operator as actor — so pickup number, auto-accept and audit are
 * identical. Guards: only after the automatic check had its chance, one open report per order
 * (DB partial unique), ≤ 3 per order, a UTR backs one non-declined report per shop (DB partial
 * unique) and can't reuse a reference already recorded on a paid payment.
 */
@Injectable()
export class PaymentReportsService {
  private readonly logger = new Logger(PaymentReportsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly orders: OrdersService,
    private readonly events: DomainEventBus,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** POST /api/orders/:id/payment-report (customer). */
  async report(orderId: string, utr: string, actor: Actor): Promise<PublicOrder> {
    let created: { id: string; shopId: string };
    try {
      created = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
        const order = await tx.order.findUnique({
          where: { id: orderId },
          include: {
            payments: { orderBy: { createdAt: 'desc' } },
            paymentReports: { orderBy: { createdAt: 'desc' } },
          },
        });
        if (!order) throw new AppError('ORDER_NOT_FOUND', 'Order not found', HttpStatus.NOT_FOUND);
        const payment = order.payments[0];
        if (order.paymentReports.some((r) => r.status === 'OPEN')) {
          throw new AppError(
            'PAYMENT_REPORT_OPEN',
            'You already reported a payment; the shop is checking it.',
            HttpStatus.CONFLICT,
          );
        }
        if (order.paymentReports.length >= MAX_PAYMENT_REPORTS_PER_ORDER) {
          throw new AppError(
            'PAYMENT_REPORT_LIMIT',
            'Too many payment reports for this order. Please talk to the shop.',
            HttpStatus.CONFLICT,
          );
        }
        const after = paymentReportWindow(order, this.config.PAYMENT_CLAIM_AFTER_SECONDS);
        if (!after || !payment) {
          throw new AppError(
            'ORDER_NOT_PAYABLE',
            'This order is not waiting for a payment.',
            HttpStatus.CONFLICT,
            { status: order.status },
          );
        }
        if (after.getTime() > Date.now()) {
          throw new AppError(
            'PAYMENT_REPORT_TOO_EARLY',
            'Your payment may still be confirmed automatically. Please wait a moment.',
            HttpStatus.CONFLICT,
            { after: after.toISOString() },
          );
        }
        const reused =
          (await tx.paymentReport.findFirst({
            where: { shopId: order.shopId, utr, status: { not: 'DECLINED' } },
            select: { id: true },
          })) ??
          (await tx.payment.findFirst({
            where: { provider: payment.provider, providerPaymentId: utr },
            select: { id: true },
          }));
        if (reused) throw utrUsed();

        const report = await tx.paymentReport.create({
          data: {
            shopId: order.shopId,
            orderId,
            paymentId: payment.id,
            utr,
            amountPaise: payment.amountPaise,
          },
          select: { id: true, shopId: true },
        });
        await tx.auditLog.create({
          data: {
            actorType: actor.type,
            actorId: actor.id,
            shopId: order.shopId,
            orderId,
            action: 'payment.report_opened',
            metadata: { reportId: report.id, paymentId: payment.id, utrLast4: utr.slice(-4) },
          },
        });
        return report;
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw utrUsed();
      throw err;
    }
    this.publish(created.shopId, created.id, orderId, 'OPEN');
    this.logger.log({ orderId, shopId: created.shopId, reportId: created.id }, 'payment reported');
    return this.orders.getPublic(orderId);
  }

  /** GET /api/shop/payment-reports */
  async list(shopId: string, status: 'OPEN' | 'ALL'): Promise<ShopPaymentReport[]> {
    const rows = await this.prisma.paymentReport.findMany({
      where: { shopId, ...(status === 'OPEN' ? { status: 'OPEN' } : {}) },
      orderBy: { createdAt: status === 'OPEN' ? 'asc' : 'desc' },
      take: status === 'OPEN' ? 200 : 50,
      select: REPORT_SELECT,
    });
    return rows.map(toShopReport);
  }

  /** POST /api/shop/payment-reports/:id/approve (operator): "I received ₹X". */
  async approve(shopId: string, reportId: string, actor: Actor): Promise<ShopPaymentReport> {
    let paidOrderId: string | null;
    let orderId: string;
    try {
      ({ paidOrderId, orderId } = await this.prisma.$transaction(async (tx) => {
        const report = await this.lockOpen(tx, shopId, reportId);
        const applied = await this.payments.applyProviderUpdate(tx, report.paymentId, {
          status: 'PAID',
          providerPaymentId: report.utr,
          amountPaise: report.amountPaise,
          source: 'MANUAL',
          actor,
          reason: `Payment confirmed by the shop (UPI ref …${report.utr.slice(-4)})`,
        });
        // ALREADY_PAID: the automatic check won the race — the report is simply superseded.
        const status = applied.outcome === 'ALREADY_PAID' ? 'SUPERSEDED' : 'APPROVED';
        await tx.paymentReport.update({
          where: { id: report.id, shopId },
          data: {
            status,
            decidedAt: new Date(),
            decidedByUserId: actor.type === 'STAFF' ? actor.id : null,
          },
        });
        await tx.auditLog.create({
          data: {
            actorType: actor.type,
            actorId: actor.id,
            shopId,
            orderId: report.orderId,
            action: 'payment.report_approved',
            metadata: {
              reportId: report.id,
              paymentId: report.paymentId,
              outcome: applied.outcome,
              amount: formatPaise(report.amountPaise),
              ...actorMetadata(actor),
            },
          },
        });
        return { paidOrderId: applied.paidOrderId, orderId: report.orderId };
      }));
    } catch (err) {
      // The UTR is already the reference of another paid payment (unique per provider).
      if (isUniqueViolation(err)) throw utrUsed();
      throw err;
    }
    if (paidOrderId) await this.payments.afterPaid(paidOrderId);
    const view = await this.get(shopId, reportId);
    this.publish(shopId, reportId, orderId, view.status);
    return view;
  }

  /** POST /api/shop/payment-reports/:id/decline (operator). */
  async decline(
    shopId: string,
    reportId: string,
    req: DeclinePaymentReportRequest,
    actor: Actor,
  ): Promise<ShopPaymentReport> {
    const orderId = await this.prisma.$transaction(async (tx) => {
      const report = await this.lockOpen(tx, shopId, reportId);
      await tx.paymentReport.update({
        where: { id: report.id, shopId },
        data: {
          status: 'DECLINED',
          declineReason: req.reason,
          declineNote: req.note ?? null,
          decidedAt: new Date(),
          decidedByUserId: actor.type === 'STAFF' ? actor.id : null,
        },
      });
      await tx.auditLog.create({
        data: {
          actorType: actor.type,
          actorId: actor.id,
          shopId,
          orderId: report.orderId,
          action: 'payment.report_declined',
          metadata: { reportId: report.id, reason: req.reason, ...actorMetadata(actor) },
        },
      });
      return report.orderId;
    });
    this.publish(shopId, reportId, orderId, 'DECLINED');
    return this.get(shopId, reportId);
  }

  private async lockOpen(tx: Prisma.TransactionClient, shopId: string, reportId: string) {
    // Row lock: approve/decline of one report never interleave.
    await tx.$queryRaw`SELECT id FROM payment_reports WHERE id = ${reportId}::uuid AND shop_id = ${shopId}::uuid FOR UPDATE`;
    const report = await tx.paymentReport.findFirst({ where: { id: reportId, shopId } });
    if (!report) {
      throw new AppError(
        'PAYMENT_REPORT_NOT_FOUND',
        'Payment report not found',
        HttpStatus.NOT_FOUND,
      );
    }
    if (report.status !== 'OPEN') {
      throw new AppError(
        'PAYMENT_REPORT_NOT_OPEN',
        'This payment report was already handled.',
        HttpStatus.CONFLICT,
        { status: report.status },
      );
    }
    return report;
  }

  private async get(shopId: string, reportId: string): Promise<ShopPaymentReport> {
    const row = await this.prisma.paymentReport.findFirstOrThrow({
      where: { id: reportId, shopId },
      select: REPORT_SELECT,
    });
    return toShopReport(row);
  }

  private publish(shopId: string, reportId: string, orderId: string, status: string): void {
    this.events.publish(this.prisma, DomainEvent.PAYMENT_REPORT_CHANGED, {
      shopId,
      reportId,
      orderId,
      status: status as 'OPEN' | 'APPROVED' | 'DECLINED' | 'SUPERSEDED',
    });
  }
}
