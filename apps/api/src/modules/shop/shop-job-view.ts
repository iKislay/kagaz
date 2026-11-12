import { type ShopJob } from '@kagaz/shared';
import { type Prisma } from '../../generated/prisma/client.js';
import { parseOptions, parseQuote, paymentMethodOf } from '../orders/order-view.js';
import { pickupDateString } from '../pickup/pickup-number.service.js';

/** Everything needed to render an operator's view of an order. */
export const SHOP_JOB_INCLUDE = {
  files: { where: { kind: 'ORIGINAL', status: 'VALID' }, orderBy: { createdAt: 'desc' }, take: 1 },
  payments: { orderBy: { createdAt: 'desc' }, take: 1 },
  printJobs: { orderBy: { attempt: 'desc' }, take: 1 },
} as const satisfies Prisma.OrderInclude;

export type OrderWithShopView = Prisma.OrderGetPayload<{ include: typeof SHOP_JOB_INCLUDE }>;

/** Operator-safe projection: no customer phone, no tokens, no storage keys. */
export function toShopJob(order: OrderWithShopView): ShopJob {
  const quote = parseQuote(order.priceSnapshot ?? order.quote);
  const job = order.printJobs[0];
  return {
    orderId: order.id,
    publicRef: order.publicRef,
    status: order.status,
    options: parseOptions(order.options),
    pageCount: order.files[0]?.pageCount ?? null,
    printedSides: quote?.printedSides ?? null,
    amountPaise: order.amountPaise,
    simulatedPayment: order.payments[0]?.isSimulated ?? false,
    paymentMethod: order.payments[0] ? paymentMethodOf(order.payments[0].provider) : null,
    createdAt: order.createdAt.toISOString(),
    paidAt: order.paidAt?.toISOString() ?? null,
    pickupNumber: order.pickupNumber,
    pickupDate: pickupDateString(order.pickupDate),
    printJob: job
      ? {
          id: job.id,
          attempt: job.attempt,
          status: job.status,
          printerId: job.printerId,
          spoolerJobId: job.spoolerJobId,
          error: job.error,
        }
      : null,
    rejection: order.rejectionCode
      ? { code: order.rejectionCode, note: order.rejectionNote }
      : null,
  };
}
