import {
  COUNTER_PAYMENT_PROVIDER,
  OrderStatus,
  type PrintOptions,
  PrintOptionsSchema,
  type PublicOrder,
  type Quote,
  QuoteSchema,
  UPLOAD_SOURCE_TYPES,
  type UploadSourceType,
  sortByPosition,
  withFirstPages,
} from '@kagaz/shared';
import { type Prisma } from '../../generated/prisma/client.js';
import { pickupDateString } from '../pickup/pickup-number.service.js';

/**
 * The customer's printable files of an order (ADR-005): every VALID original, in print order.
 * Use with `printOrder()` — Prisma can't express "position, then createdAt" with nulls last.
 */
export const PRINTABLE_FILES = {
  where: { kind: 'ORIGINAL', status: 'VALID' },
  orderBy: [{ position: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
} as const satisfies Prisma.Order$filesArgs;

/** Files in print order, each with its first page in the combined document. */
export function printOrder<
  T extends { position: number | null; createdAt: Date; pageCount: number | null },
>(files: readonly T[]): Array<T & { pageCount: number; firstPage: number }> {
  const valid = files.filter((f): f is T & { pageCount: number } => (f.pageCount ?? 0) > 0);
  return withFirstPages(sortByPosition(valid));
}

/** Total pages of the combined document (what the price and page range count). */
export function totalPages(files: readonly { pageCount: number | null }[]): number {
  return files.reduce((sum, f) => sum + (f.pageCount ?? 0), 0);
}

function sourceTypeOf(value: string | null): UploadSourceType {
  return (UPLOAD_SOURCE_TYPES as readonly string[]).includes(value ?? '')
    ? (value as UploadSourceType)
    : 'PDF'; // files from before ADR-005 were always PDFs
}

/** Everything needed to render the customer-safe order view. */
export const ORDER_VIEW_INCLUDE = {
  shop: { select: { id: true, name: true, address: true, isDemo: true } },
  files: PRINTABLE_FILES,
  payments: {
    orderBy: { createdAt: 'desc' },
    include: { refunds: { orderBy: { createdAt: 'desc' }, take: 1 } },
  },
  events: { orderBy: { createdAt: 'asc' } },
} as const satisfies Prisma.OrderInclude;

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
}): boolean {
  return (
    (order.status === OrderStatus.DRAFT || order.status === OrderStatus.AWAITING_PAYMENT) &&
    !order.payments.some((p) => (PAYMENT_IN_FLIGHT as readonly string[]).includes(p.status))
  );
}

/**
 * Customer-safe projection (PRD §11.1). The ADR-002 pickup code (daily number + date) is
 * shown from payment verified onward; no staff, device or printer internals are exposed.
 */
export function toPublicOrder(order: OrderWithView): PublicOrder {
  const files = printOrder(order.files);
  const payment = order.payments[0];
  const refund = order.payments.flatMap((p) => p.refunds)[0];

  return {
    id: order.id,
    publicRef: order.publicRef,
    status: order.status,
    shop: order.shop,
    options: parseOptions(order.options),
    file: files.length
      ? {
          pageCount: totalPages(files),
          bytes: files.reduce((sum, f) => sum + (f.bytes ?? 0), 0),
        }
      : null,
    files: files.map((f) => ({
      id: f.id,
      firstPage: f.firstPage,
      pageCount: f.pageCount,
      bytes: f.bytes ?? 0,
      sourceType: sourceTypeOf(f.sourceType),
    })),
    quote: parseQuote(order.priceSnapshot ?? order.quote),
    amountPaise: order.amountPaise,
    payment: payment
      ? {
          status: payment.status,
          isSimulated: payment.isSimulated,
          atCounter: payment.provider === COUNTER_PAYMENT_PROVIDER,
          reference: payment.providerPaymentId,
        }
      : null,
    pickupNumber: order.pickupNumber,
    pickupDate: pickupDateString(order.pickupDate),
    rejection: order.rejectionCode
      ? { code: order.rejectionCode, note: order.rejectionNote }
      : null,
    refund: refund
      ? { status: refund.status, amountPaise: refund.amountPaise, isSimulated: refund.isSimulated }
      : null,
    canCancel: canCustomerCancel(order),
    timeline: order.events.map((e) => ({ status: e.toStatus, at: e.createdAt.toISOString() })),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}
