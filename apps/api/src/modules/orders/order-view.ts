import {
  OrderStatus,
  type PrintOptions,
  PrintOptionsSchema,
  type PublicOrder,
  type Quote,
  QuoteSchema,
} from '@kagaz/shared';
import { type Prisma } from '../../generated/prisma/client.js';
import { type PickupCrypto } from '../pickup/pickup-crypto.js';

/** Everything needed to render the customer-safe order view. */
export const ORDER_VIEW_INCLUDE = {
  shop: { select: { id: true, name: true, address: true, isDemo: true } },
  files: {
    where: { kind: 'ORIGINAL', status: 'VALID' },
    orderBy: { createdAt: 'desc' },
    take: 1,
  },
  payments: { orderBy: { createdAt: 'desc' }, take: 1 },
  pickupCode: true,
  events: { orderBy: { createdAt: 'asc' } },
} as const satisfies Prisma.OrderInclude;

export type OrderWithView = Prisma.OrderGetPayload<{ include: typeof ORDER_VIEW_INCLUDE }>;

export function parseOptions(value: unknown): PrintOptions {
  return PrintOptionsSchema.parse(value);
}

export function parseQuote(value: unknown): Quote | null {
  return value === null || value === undefined ? null : QuoteSchema.parse(value);
}

/**
 * Customer-safe projection (PRD §11.1). The pickup code is decrypted only while the order is
 * READY_FOR_PICKUP (FR-CUST-11); no staff, device or printer internals are exposed.
 */
export function toPublicOrder(order: OrderWithView, pickup: PickupCrypto): PublicOrder {
  const file = order.files[0];
  const payment = order.payments[0];
  const showCode =
    order.status === OrderStatus.READY_FOR_PICKUP && order.pickupCode?.encryptedDisplayValue;

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
        }
      : null,
    pickupCode: showCode ? pickup.decrypt(order.pickupCode!.encryptedDisplayValue!) : null,
    rejection: order.rejectionCode
      ? { code: order.rejectionCode, note: order.rejectionNote }
      : null,
    timeline: order.events.map((e) => ({ status: e.toStatus, at: e.createdAt.toISOString() })),
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}
