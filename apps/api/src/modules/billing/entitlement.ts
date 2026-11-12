import { HttpStatus } from '@nestjs/common';
import { type AppConfig } from '../../common/config/config.schema.js';
import { AppError } from '../../common/http/api-exception.filter.js';
import { type PrismaService } from '../../common/prisma/prisma.service.js';
import { type Tx } from '../orders/order-state-machine.js';
import { type Summary, summarize } from './billing-math.js';

type Db = Tx | PrismaService;

/** Where-fragment: the shop's subscription covering `now` (ADR-004). */
export const currentSubscriptionWhere = (now: Date) => ({
  status: 'ACTIVE' as const,
  periodStart: { lte: now },
  periodEnd: { gt: now },
});

export async function subscriptionSummary(
  db: Db,
  shopId: string,
  now = new Date(),
): Promise<Summary> {
  const periods = await db.subscription.findMany({
    where: { shopId },
    select: { status: true, printerSeats: true, periodStart: true, periodEnd: true },
  });
  return summarize(periods, now);
}

/**
 * BILLING_ENFORCED: the shop's enabled printers must fit its seats. Call inside the transaction
 * that enables printers, after the change, so an over-limit change rolls back.
 */
export async function assertPrinterSeats(db: Db, config: AppConfig, shopId: string): Promise<void> {
  if (!config.BILLING_ENFORCED) return;
  const [current, enabled] = await Promise.all([
    db.subscription.findFirst({
      where: { shopId, ...currentSubscriptionWhere(new Date()) },
      select: { printerSeats: true },
    }),
    db.printer.count({ where: { shopId, enabled: true } }),
  ]);
  const seats = current?.printerSeats ?? 0;
  if (enabled <= seats) return;
  throw new AppError(
    'PRINTER_LIMIT_REACHED',
    seats === 0
      ? 'This shop has no active Kaggaz subscription, so printers can’t be turned on. Contact Kaggaz to subscribe.'
      : `Your plan covers ${seats} printer${seats === 1 ? '' : 's'}. Turn one off or ask Kaggaz to add printers to your plan.`,
    HttpStatus.CONFLICT,
    { seats, enabled },
  );
}
