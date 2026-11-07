import { Injectable } from '@nestjs/common';
import { type AdminOverview, type AdminOverviewQuery, istDateKey } from '@kagaz/shared';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { dateKeys, median } from './reconciliation.js';
import { resolveRange } from './reconciliation.service.js';

const PAID_STATES = new Set([
  'PENDING_REVIEW',
  'QUEUED',
  'PRINTING',
  'NEEDS_OPERATOR_CHECK',
  'READY_FOR_PICKUP',
  'COLLECTED',
  'REJECTED',
  'REFUND_PENDING',
  'REFUNDED',
]);

interface Timed {
  paidAt: Date | null;
  readyAt: Date | null;
  collectedAt: Date | null;
}

export function turnaround(orders: Timed[]): AdminOverview['turnaround'] {
  const paidToReady = orders
    .filter((o) => o.paidAt && o.readyAt)
    .map((o) => (o.readyAt!.getTime() - o.paidAt!.getTime()) / 1000);
  const readyToCollected = orders
    .filter((o) => o.readyAt && o.collectedAt)
    .map((o) => (o.collectedAt!.getTime() - o.readyAt!.getTime()) / 1000);
  const round = (v: number | null) => (v === null ? null : Math.round(v));
  return {
    paidToReadyMedianSeconds: round(median(paidToReady)),
    readyToCollectedMedianSeconds: round(median(readyToCollected)),
    paidToReadySamples: paidToReady.length,
    readyToCollectedSamples: readyToCollected.length,
  };
}

/** Investor/ops overview (P4.8, FR-ADMIN-11): volume, turnaround, printer uptime. */
@Injectable()
export class OverviewService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(q: AdminOverviewQuery, now = new Date()): Promise<AdminOverview> {
    const { from, to, start, end } = resolveRange({}, q.days, now);
    const shopFilter = q.shopId ? { shopId: q.shopId } : {};
    const [shops, orders, uptimeRows, printers] = await Promise.all([
      this.prisma.shop.findMany({
        where: q.shopId ? { id: q.shopId } : {},
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.order.findMany({
        where: { createdAt: { gte: start, lt: end }, status: { not: 'DRAFT' }, ...shopFilter },
        select: {
          shopId: true,
          status: true,
          createdAt: true,
          paidAt: true,
          readyAt: true,
          collectedAt: true,
          amountPaise: true,
        },
      }),
      this.prisma.printerUptimeDaily.groupBy({
        by: ['printerId'],
        where: {
          day: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) },
          ...shopFilter,
        },
        _sum: { observedSamples: true, upSamples: true },
      }),
      this.prisma.printer.findMany({
        where: shopFilter,
        select: { id: true, shopId: true, displayName: true },
        orderBy: { displayName: 'asc' },
      }),
    ]);
    const shopName = new Map(shops.map((s) => [s.id, s.name]));

    const byStatus: Record<string, number> = {};
    const days = new Map(
      dateKeys(from, to).map((d) => [d, { total: 0, byStatus: {} as Record<string, number> }]),
    );
    const perShop = new Map(
      shops.map((s) => [
        s.id,
        { total: 0, byStatus: {} as Record<string, number>, timed: [] as Timed[] },
      ]),
    );
    let paidOrders = 0;
    let paidPaise = 0;
    for (const o of orders) {
      byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
      const day = days.get(istDateKey(o.createdAt));
      if (day) {
        day.total += 1;
        day.byStatus[o.status] = (day.byStatus[o.status] ?? 0) + 1;
      }
      const shop = perShop.get(o.shopId);
      if (shop) {
        shop.total += 1;
        shop.byStatus[o.status] = (shop.byStatus[o.status] ?? 0) + 1;
        shop.timed.push(o);
      }
      if (PAID_STATES.has(o.status)) {
        paidOrders += 1;
        paidPaise += o.amountPaise ?? 0;
      }
    }

    const uptime = new Map(uptimeRows.map((r) => [r.printerId, r._sum]));
    return {
      from,
      to,
      totals: {
        orders: orders.length,
        paidOrders,
        collected: byStatus.COLLECTED ?? 0,
        rejected:
          (byStatus.REJECTED ?? 0) + (byStatus.REFUND_PENDING ?? 0) + (byStatus.REFUNDED ?? 0),
        paidPaise,
      },
      byDay: [...days.entries()].map(([date, d]) => ({ date, ...d })),
      byShop: shops.map((s) => {
        const d = perShop.get(s.id)!;
        return {
          shopId: s.id,
          shopName: s.name,
          total: d.total,
          byStatus: d.byStatus,
          turnaround: turnaround(d.timed),
        };
      }),
      byStatus,
      turnaround: turnaround(orders),
      printerUptime: printers.map((p) => {
        const sums = uptime.get(p.id);
        const observed = sums?.observedSamples ?? 0;
        return {
          printerId: p.id,
          shopId: p.shopId,
          shopName: shopName.get(p.shopId) ?? '—',
          displayName: p.displayName,
          uptimeRatio: observed > 0 ? (sums?.upSamples ?? 0) / observed : null,
          observedSamples: observed,
        };
      }),
    };
  }
}
