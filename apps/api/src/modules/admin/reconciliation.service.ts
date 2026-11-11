import { HttpStatus, Injectable } from '@nestjs/common';
import {
  type AdminReconciliation,
  type AdminReconciliationQuery,
  istDateKey,
  istDayStart,
} from '@kagaz/shared';
import { AppError } from '../../common/http/api-exception.filter.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { findOrderMismatches } from './reconciliation.js';

const DAY_MS = 86_400_000;
const MAX_RANGE_DAYS = 92;
/** A verified webhook older than this and still unprocessed is a mismatch. */
const WEBHOOK_GRACE_MS = 5 * 60_000;

/** Resolve an inclusive IST date range (default: the last 7 days including today). */
export function resolveRange(
  q: { from?: string; to?: string },
  defaultDays: number,
  now = new Date(),
): { from: string; to: string; start: Date; end: Date } {
  const to = q.to ?? istDateKey(now);
  const from =
    q.from ?? istDateKey(new Date(istDayStart(to).getTime() - (defaultDays - 1) * DAY_MS));
  const start = istDayStart(from);
  const end = new Date(istDayStart(to).getTime() + DAY_MS);
  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    start >= end ||
    (end.getTime() - start.getTime()) / DAY_MS > MAX_RANGE_DAYS
  ) {
    throw new AppError(
      'INVALID_RANGE',
      `Pick a range of 1–${MAX_RANGE_DAYS} days with from ≤ to`,
      HttpStatus.BAD_REQUEST,
    );
  }
  return { from, to, start, end };
}

/** Payments vs. orders vs. refunds per IST day and shop (P3.7, FR-ADMIN-10, T20). */
@Injectable()
export class ReconciliationService {
  constructor(private readonly prisma: PrismaService) {}

  async report(q: AdminReconciliationQuery, now = new Date()): Promise<AdminReconciliation> {
    const { from, to, start, end } = resolveRange(q, 7, now);
    const shopFilter = q.shopId ? { shopId: q.shopId } : {};
    const shops = await this.prisma.shop.findMany({ select: { id: true, name: true } });
    const shopName = new Map(shops.map((s) => [s.id, s.name]));

    type Row = AdminReconciliation['rows'][number];
    const rows = new Map<string, Row>();
    const row = (date: string, shopId: string): Row => {
      const key = `${date}|${shopId}`;
      let r = rows.get(key);
      if (!r) {
        r = {
          date,
          shopId,
          shopName: shopName.get(shopId) ?? '—',
          paidCount: 0,
          paidPaise: 0,
          simulatedPaidPaise: 0,
          refundCount: 0,
          refundedPaise: 0,
          ordersByStatus: {},
        };
        rows.set(key, r);
      }
      return r;
    };

    // Money in: payments verified in range (still counted after a refund — refunds are separate).
    const payments = await this.prisma.payment.findMany({
      where: {
        status: { in: ['PAID', 'REFUND_PENDING', 'REFUNDED'] },
        verifiedAt: { gte: start, lt: end },
        order: shopFilter,
      },
      select: {
        amountPaise: true,
        isSimulated: true,
        verifiedAt: true,
        order: { select: { shopId: true } },
      },
    });
    for (const p of payments) {
      const r = row(istDateKey(p.verifiedAt!), p.order.shopId);
      r.paidCount += 1;
      r.paidPaise += p.amountPaise;
      if (p.isSimulated) r.simulatedPaidPaise += p.amountPaise;
    }

    // Money out: refunds that succeeded in range.
    const refunds = await this.prisma.refund.findMany({
      where: {
        status: 'SUCCEEDED',
        completedAt: { gte: start, lt: end },
        payment: { order: shopFilter },
      },
      select: {
        amountPaise: true,
        completedAt: true,
        payment: { select: { order: { select: { shopId: true } } } },
      },
    });
    for (const rf of refunds) {
      const r = row(istDateKey(rf.completedAt!), rf.payment.order.shopId);
      r.refundCount += 1;
      r.refundedPaise += rf.amountPaise;
    }

    // Orders created in range: final-state counts + mismatch rules.
    // Plus orders still stuck now that were created before the range (they need action today).
    const orders = await this.prisma.order.findMany({
      where: {
        ...shopFilter,
        OR: [
          { createdAt: { gte: start, lt: end } },
          {
            createdAt: { lt: start },
            status: { in: ['PENDING_REVIEW', 'QUEUED', 'NEEDS_OPERATOR_CHECK'] },
            paidAt: { lt: new Date(now.getTime() - q.stuckHours * 3_600_000) },
          },
        ],
      },
      select: {
        id: true,
        publicRef: true,
        shopId: true,
        status: true,
        rejectionCode: true,
        createdAt: true,
        paidAt: true,
        payments: {
          select: {
            status: true,
            verifiedAt: true,
            refunds: { select: { status: true, amountPaise: true } },
          },
        },
      },
    });
    const mismatches: AdminReconciliation['mismatches'] = [];
    for (const o of orders) {
      if (o.status !== 'DRAFT' && o.createdAt >= start) {
        const r = row(istDateKey(o.createdAt), o.shopId);
        r.ordersByStatus[o.status] = (r.ordersByStatus[o.status] ?? 0) + 1;
      }
      for (const m of findOrderMismatches(o, now, q.stuckHours)) {
        mismatches.push({
          type: m.type,
          orderId: m.orderId,
          publicRef: m.publicRef,
          shopId: m.shopId,
          shopName: shopName.get(m.shopId) ?? null,
          detail: m.detail,
          at: m.at.toISOString(),
        });
      }
    }

    // Verified webhooks never processed (not tied to a shop until processed).
    if (!q.shopId) {
      const webhooks = await this.prisma.webhookEvent.findMany({
        where: {
          signatureValid: true,
          processedAt: null,
          receivedAt: {
            gte: start,
            lt: new Date(Math.min(end.getTime(), now.getTime() - WEBHOOK_GRACE_MS)),
          },
        },
        orderBy: { receivedAt: 'asc' },
      });
      for (const w of webhooks) {
        mismatches.push({
          type: 'WEBHOOK_UNPROCESSED',
          orderId: null,
          publicRef: null,
          shopId: null,
          shopName: null,
          detail: `${w.provider} event ${w.providerEventId} received but not processed${w.error ? `: ${w.error}` : ''}`,
          at: w.receivedAt.toISOString(),
        });
      }
    }

    const sorted = [...rows.values()].sort(
      (a, b) => b.date.localeCompare(a.date) || a.shopName.localeCompare(b.shopName),
    );
    const paidPaise = sorted.reduce((s, r) => s + r.paidPaise, 0);
    const refundedPaise = sorted.reduce((s, r) => s + r.refundedPaise, 0);
    mismatches.sort((a, b) => a.at.localeCompare(b.at));
    return {
      from,
      to,
      stuckHours: q.stuckHours,
      rows: sorted,
      totals: {
        paidPaise,
        refundedPaise,
        netPaise: paidPaise - refundedPaise,
        mismatches: mismatches.length,
      },
      mismatches,
    };
  }
}
