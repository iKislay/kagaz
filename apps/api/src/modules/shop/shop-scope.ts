import { HttpStatus } from '@nestjs/common';
import { AppError } from '../../common/http/api-exception.filter.js';
import { type Prisma } from '../../generated/prisma/client.js';
import { type Tx } from '../orders/order-state-machine.js';

/**
 * Central tenant-scoped lookups for shop/device paths (CLAUDE.md invariant 10, P4.1).
 * Every shop-owned read goes through here with the shopId taken from the authenticated
 * device — never from a path or body. Another shop's row is indistinguishable from a
 * missing one (404, no enumeration). Never use an unscoped findUnique by id in shop code.
 */

/** Guards against an empty/undefined shopId sneaking into a scoped query. */
export function requireShopId(shopId: string | null | undefined): string {
  if (!shopId) throw new Error('Tenant scope missing: shopId is required for shop-owned queries');
  return shopId;
}

export function orderNotFound(): AppError {
  return new AppError('ORDER_NOT_FOUND', 'Order not found', HttpStatus.NOT_FOUND);
}

export function printJobNotFound(): AppError {
  return new AppError('PRINT_JOB_NOT_FOUND', 'Print job not found', HttpStatus.NOT_FOUND);
}

/** An order of this shop, or 404. */
export async function findShopOrder<I extends Prisma.OrderInclude>(
  client: Tx,
  shopId: string,
  orderId: string,
  include: I,
): Promise<Prisma.OrderGetPayload<{ include: I }>> {
  const order = await client.order.findFirst({
    where: { id: orderId, shopId: requireShopId(shopId) },
    include,
  });
  if (!order) throw orderNotFound();
  return order as Prisma.OrderGetPayload<{ include: I }>;
}

export const SCOPED_PRINT_JOB_INCLUDE = {
  order: true,
  printer: true,
  packetFile: true,
} as const satisfies Prisma.PrintJobInclude;

/** A print job whose order belongs to this shop, or 404. */
export async function findShopPrintJob(client: Tx, shopId: string, printJobId: string) {
  const job = await client.printJob.findFirst({
    where: { id: printJobId, order: { shopId: requireShopId(shopId) } },
    include: SCOPED_PRINT_JOB_INCLUDE,
  });
  if (!job) throw printJobNotFound();
  return job;
}

/** A printer of this shop (optionally a specific one), or null. */
export function shopPrinterWhere(shopId: string, printerId?: string): Prisma.PrinterWhereInput {
  return { shopId: requireShopId(shopId), ...(printerId ? { id: printerId } : {}) };
}
