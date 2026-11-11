import {
  type DeclineReason,
  OrderStatus,
  maskUtr,
  type PrintOptions,
  PrintOptionsSchema,
  type PublicOrder,
  type Quote,
  QuoteSchema,
} from '@kagaz/shared';
import { type Prisma } from '../../generated/prisma/client.js';
import { pickupDateString } from '../pickup/pickup-number.service.js';

/** Everything needed to render the customer-safe order view. */
export const ORDER_VIEW_INCLUDE = {
  shop: { select: { id: true, name: true, address: true, isDemo: true } },
  files: {
    where: { kind: 'ORIGINAL', status: 'VALID' },
    orderBy: { createdAt: 'desc' },
    take: 1,
  },
  payments: {
    orderBy: { createdAt: 'desc' },
    include: { refunds: { orderBy: { createdAt: 'desc' }, take: 1 } },
  },
  paymentReports: { orderBy: { createdAt: 'desc' } },
  events: { orderBy: { createdAt: 'asc' } },
} as const satisfies Prisma.OrderInclude;

/** ADR-003 fallback limits. */
export const MAX_PAYMENT_REPORTS_PER_ORDER = 3;

export interface PublicOrderOptions {
  /** PAYMENT_CLAIM_AFTER_SECONDS: how long the automatic check gets before reporting opens. */
  reportAfterSeconds: number;
  now?: Date;
}

/**
 * When may the customer report a payment for this order (ADR-003 §4)? `null` = not applicable
 * (nothing to report, demo payment, report open, limit reached). A FAILED (timed-out) attempt
 * can be reported at once; an open one after `reportAfterSeconds`.
 */
export function paymentReportWindow(
  order: {
    status: string;
    payments: readonly {
      status: string;
      isSimulated: boolean;
      createdAt: Date;
      updatedAt: Date;
    }[];
    paymentReports: readonly { status: string }[];
  },
  reportAfterSeconds: number,
): Date | null {
  if (order.status !== OrderStatus.AWAITING_PAYMENT) return null;
  const payment = order.payments[0];
  if (!payment || payment.isSimulated) return null;
  if (!['CREATED', 'PENDING', 'FAILED'].includes(payment.status)) return null;
  if (order.paymentReports.some((r) => r.status === 'OPEN')) return null;
  if (order.paymentReports.length >= MAX_PAYMENT_REPORTS_PER_ORDER) return null;
  if (payment.status === 'FAILED') return payment.updatedAt;
  return new Date(payment.createdAt.getTime() + reportAfterSeconds * 1000);
}

export type OrderWithView = Prisma.OrderGetPayload<{ include: typeof ORDER_VIEW_INCLUDE }>;

export function parseOptions(value: unknown): PrintOptions {
  return PrintOptionsSchema.parse(value);
}

export function parseQuote(value: unknown): Quote | null {
  return value === null || value === undefined ? null : QuoteSchema.parse(value);
}

/** Payment statuses that block a customer cancel: money may be (or is) on its way. */
export const PAYMENT_IN_FLIGHT = ['CREATED', 'PENDING', 'PAID'] as const;

/** FR-CUST-12 / P3.6: cancel only before payment, with no payment in flight. */
export function canCustomerCancel(order: {
  status: string;
  payments: readonly { status: string }[];
  /** ADR-003: an OPEN payment report means money may have moved — the shop decides first. */
  paymentReports?: readonly { status: string }[];
}): boolean {
  return (
    (order.status === OrderStatus.DRAFT || order.status === OrderStatus.AWAITING_PAYMENT) &&
    !order.payments.some((p) => (PAYMENT_IN_FLIGHT as readonly string[]).includes(p.status)) &&
    !(order.paymentReports ?? []).some((r) => r.status === 'OPEN')
  );
}

/**
 * Customer-safe projection (PRD §11.1). The ADR-002 pickup code (daily number + date) is
 * shown from payment verified onward; no staff, device or printer internals are exposed.
 */
export function toPublicOrder(
  order: OrderWithView,
  opts: PublicOrderOptions = { reportAfterSeconds: 90 },
): PublicOrder {
  const file = order.files[0];
  const payment = order.payments[0];
  const refund = order.payments.flatMap((p) => p.refunds)[0];
  const report = order.paymentReports[0];
  const reportAfter = paymentReportWindow(order, opts.reportAfterSeconds);
  const now = opts.now ?? new Date();
  const paymentOpen = payment && (payment.status === 'CREATED' || payment.status === 'PENDING');

  return {
    id: order.id,
    publicRef: order.publicRef,
    status: order.status,
    shop: order.shop,
    options: parseOptions(order.options),
    file: file?.pageCount ? { pageCount: file.pageCount, bytes: file.bytes ?? 0 } : null,
    quote: parseQuote(order.priceSnapshot ?? order.quote),
    amountPaise: order.amountPaise,
    payment: payment
      ? {
          status: payment.status,
          isSimulated: payment.isSimulated,
          reference: payment.providerPaymentId,
          checkoutUrl:
            paymentOpen && order.status === OrderStatus.AWAITING_PAYMENT
              ? payment.checkoutUrl
              : null,
        }
      : null,
    paymentReport: report
      ? {
          status: report.status,
          utr: maskUtr(report.utr),
          createdAt: report.createdAt.toISOString(),
          declineReason: (report.declineReason as DeclineReason | null) ?? null,
        }
      : null,
    canReportPayment: reportAfter !== null && reportAfter.getTime() <= now.getTime(),
    reportPaymentAfter: reportAfter?.toISOString() ?? null,
    pickupNumber: order.pickupNumber,
    pickupDate: pickupDateString(order.pickupDate),
    rejection: order.rejectionCode
      ? { code: order.rejectionCode, note: order.rejectionNote }
      : null,
    refund: refund
      ? {
          status: refund.status,
          amountPaise: refund.amountPaise,
          isSimulated: refund.isSimulated,
          manual: refund.isManual,
        }
      : null,
    canCancel: canCustomerCancel(order),
    timeline: order.events.map((e) => ({ status: e.toStatus, at: e.createdAt.toISOString() })),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}
