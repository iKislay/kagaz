import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  type AdminBillingOverview,
  type AdminShopBilling,
  type AdminSubscription,
  type CancelSubscriptionRequest,
  type ChangeEndDateRequest,
  type ChangePlanRequest,
  type CreateSubscriptionRequest,
  type RecordSubscriptionPaymentRequest,
  type SubscriptionSnapshot,
  SubscriptionSnapshotSchema,
} from '@kagaz/shared';
import { APP_CONFIG } from '../../common/config/config.module.js';
import { type AppConfig } from '../../common/config/config.schema.js';
import { AppError } from '../../common/http/api-exception.filter.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import {
  type Subscription,
  type SubscriptionChange,
  type SubscriptionPayment,
} from '../../generated/prisma/client.js';
import { auditStaffAction } from '../admin/admin-audit.js';
import { shopNotFound } from '../admin/shop-settings.service.js';
import { type StaffContext } from '../identity/staff-session.js';
import { type Tx } from '../orders/order-state-machine.js';
import {
  addMonths,
  istDay,
  istMidnight,
  monthsAndDays,
  overlaps,
  periodTotal,
  shopBalance,
  summarize,
} from './billing-math.js';

type Full = Subscription & { payments: SubscriptionPayment[]; changes: SubscriptionChange[] };

const notFound = () =>
  new AppError('SUBSCRIPTION_NOT_FOUND', 'Subscription not found', HttpStatus.NOT_FOUND);
const conflict = (code: string, message: string) =>
  new AppError(code, message, HttpStatus.CONFLICT);

const snapshot = (
  s: Subscription,
  extra: Partial<SubscriptionSnapshot> = {},
): SubscriptionSnapshot => ({
  printerSeats: s.printerSeats,
  pricePerPrinterPaise: s.pricePerPrinterPaise,
  periodStart: s.periodStart.toISOString(),
  periodEnd: s.periodEnd.toISOString(),
  totalPaise: s.totalPaise,
  status: s.status,
  ...extra,
});

/** IST midnight of today. */
const todayStart = () => istMidnight(istDay(new Date()));

/**
 * Shop subscriptions (ADR-004): plans per connected-printer seat, an append-only payment ledger
 * and a revision row for every change (plan, end date, cancel). Kaggaz admins only; every write is
 * audited in its transaction, and plan changes for one shop are serialized by a shop row lock.
 */
@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async shopBilling(shopId: string): Promise<AdminShopBilling> {
    const shop = await this.prisma.shop.findUnique({ where: { id: shopId }, select: { id: true } });
    if (!shop) throw shopNotFound();
    const [subs, connectedPrinters] = await Promise.all([
      this.prisma.subscription.findMany({
        where: { shopId },
        orderBy: [{ periodStart: 'desc' }, { createdAt: 'desc' }],
        include: {
          payments: { orderBy: [{ receivedAt: 'desc' }, { createdAt: 'desc' }] },
          changes: { orderBy: { createdAt: 'desc' } },
        },
      }),
      this.prisma.printer.count({ where: { shopId, enabled: true } }),
    ]);
    const names = await this.userNames(
      subs.flatMap((s) => [
        s.createdById,
        ...s.payments.map((p) => p.recordedById),
        ...s.changes.map((c) => c.changedById),
      ]),
    );
    const now = new Date();
    return {
      summary: summarize(subs, now),
      connectedPrinters,
      enforced: this.config.BILLING_ENFORCED,
      balancePaise: shopBalance(subs),
      subscriptions: subs.map((s) => this.view(s, names, now)),
    };
  }

  async create(staff: StaffContext, shopId: string, req: CreateSubscriptionRequest) {
    const periodStart = istMidnight(req.startDate);
    const periodEnd = addMonths(req.startDate, req.months);
    await this.prisma.$transaction(async (tx) => {
      await this.lockShop(tx, shopId);
      await this.assertNoOverlap(tx, shopId, periodStart, periodEnd);
      const sub = await tx.subscription.create({
        data: {
          shopId,
          printerSeats: req.printerSeats,
          pricePerPrinterPaise: req.pricePerPrinterPaise,
          months: req.months,
          totalPaise: periodTotal(
            req.printerSeats,
            req.pricePerPrinterPaise,
            periodStart,
            periodEnd,
          ),
          periodStart,
          periodEnd,
          notes: req.notes || null,
          createdById: staff.userId,
        },
      });
      await auditStaffAction(tx, staff, 'subscription.created', shopId, {
        subscriptionId: sub.id,
        ...snapshot(sub),
      });
    });
    return this.shopBilling(shopId);
  }

  /**
   * New seats/price from `effectiveDate`: the subscription ends that day (its total recomputed for
   * the shorter period, payments kept) and a successor covers the rest of the original period.
   */
  async changePlan(
    staff: StaffContext,
    shopId: string,
    subscriptionId: string,
    req: ChangePlanRequest,
  ) {
    const effective = istMidnight(req.effectiveDate);
    await this.prisma.$transaction(async (tx) => {
      await this.lockShop(tx, shopId);
      const sub = await this.activeSub(tx, shopId, subscriptionId);
      if (!(sub.periodStart < effective && effective < sub.periodEnd)) {
        throw conflict(
          'INVALID_EFFECTIVE_DATE',
          `Pick a date after ${istDay(sub.periodStart)} and before ${istDay(sub.periodEnd)}.`,
        );
      }
      if (
        req.printerSeats === sub.printerSeats &&
        req.pricePerPrinterPaise === sub.pricePerPrinterPaise
      ) {
        throw conflict('NO_CHANGE', 'The seats and price are the same as the current plan.');
      }
      const ended = await tx.subscription.update({
        where: { id: sub.id },
        data: {
          periodEnd: effective,
          months: monthsAndDays(sub.periodStart, effective).months,
          totalPaise: periodTotal(
            sub.printerSeats,
            sub.pricePerPrinterPaise,
            sub.periodStart,
            effective,
          ),
        },
      });
      const successor = await tx.subscription.create({
        data: {
          shopId,
          printerSeats: req.printerSeats,
          pricePerPrinterPaise: req.pricePerPrinterPaise,
          months: monthsAndDays(effective, sub.periodEnd).months,
          totalPaise: periodTotal(
            req.printerSeats,
            req.pricePerPrinterPaise,
            effective,
            sub.periodEnd,
          ),
          periodStart: effective,
          periodEnd: sub.periodEnd,
          notes: `Plan change from ${req.effectiveDate}: ${req.reason}`,
          createdById: staff.userId,
        },
      });
      await this.revise(
        tx,
        staff,
        sub,
        'CHANGE_PLAN',
        req.reason,
        snapshot(ended, { successorId: successor.id }),
      );
      await auditStaffAction(tx, staff, 'subscription.plan_changed', shopId, {
        subscriptionId: sub.id,
        successorId: successor.id,
        effectiveDate: req.effectiveDate,
        printerSeats: req.printerSeats,
        pricePerPrinterPaise: req.pricePerPrinterPaise,
        reason: req.reason,
      });
    });
    return this.shopBilling(shopId);
  }

  /** Extend or shorten a period; the total is recomputed and the change kept as a revision. */
  async changeEndDate(
    staff: StaffContext,
    shopId: string,
    subscriptionId: string,
    req: ChangeEndDateRequest,
  ) {
    const end = istMidnight(req.endDate);
    await this.prisma.$transaction(async (tx) => {
      await this.lockShop(tx, shopId);
      const sub = await this.activeSub(tx, shopId, subscriptionId);
      if (end <= sub.periodStart) {
        throw conflict(
          'INVALID_END_DATE',
          `The end date must be after ${istDay(sub.periodStart)}.`,
        );
      }
      if (end < todayStart() && end < sub.periodEnd) {
        throw conflict('INVALID_END_DATE', 'An active plan can’t be shortened to before today.');
      }
      if (end.getTime() === sub.periodEnd.getTime()) {
        throw conflict('NO_CHANGE', 'That is already the end date.');
      }
      await this.assertNoOverlap(tx, shopId, sub.periodStart, end, sub.id);
      const updated = await tx.subscription.update({
        where: { id: sub.id },
        data: {
          periodEnd: end,
          months: monthsAndDays(sub.periodStart, end).months,
          totalPaise: periodTotal(sub.printerSeats, sub.pricePerPrinterPaise, sub.periodStart, end),
        },
      });
      await this.revise(tx, staff, sub, 'EXTEND', req.reason, snapshot(updated));
      await auditStaffAction(tx, staff, 'subscription.end_date_changed', shopId, {
        subscriptionId: sub.id,
        from: sub.periodEnd.toISOString(),
        to: end.toISOString(),
        totalPaise: updated.totalPaise,
        reason: req.reason,
      });
    });
    return this.shopBilling(shopId);
  }

  async recordPayment(
    staff: StaffContext,
    shopId: string,
    subscriptionId: string,
    req: RecordSubscriptionPaymentRequest,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const sub = await tx.subscription.findFirst({
        where: { id: subscriptionId, shopId },
        select: { id: true },
      });
      if (!sub) throw notFound();
      const payment = await tx.subscriptionPayment.create({
        data: {
          subscriptionId,
          shopId,
          amountPaise: req.amountPaise,
          method: req.method,
          reference: req.reference || null,
          receivedAt: istMidnight(req.receivedDate),
          note: req.note || null,
          recordedById: staff.userId,
        },
      });
      await auditStaffAction(tx, staff, 'subscription.payment_recorded', shopId, {
        subscriptionId,
        paymentId: payment.id,
        amountPaise: req.amountPaise,
        method: req.method,
        reference: req.reference ?? null,
      });
    });
    return this.shopBilling(shopId);
  }

  async cancel(
    staff: StaffContext,
    shopId: string,
    subscriptionId: string,
    req: CancelSubscriptionRequest,
  ) {
    await this.prisma.$transaction(async (tx) => {
      await this.lockShop(tx, shopId);
      const sub = await this.activeSub(tx, shopId, subscriptionId);
      const updated = await tx.subscription.update({
        where: { id: sub.id },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelledById: staff.userId,
          cancelReason: req.reason,
        },
      });
      await this.revise(tx, staff, sub, 'CANCEL', req.reason, snapshot(updated));
      await auditStaffAction(tx, staff, 'subscription.cancelled', shopId, {
        subscriptionId,
        reason: req.reason,
      });
    });
    return this.shopBilling(shopId);
  }

  async overview(): Promise<AdminBillingOverview> {
    const now = new Date();
    const monthStart = istMidnight(`${istDay(now).slice(0, 7)}-01`);
    const [shops, collected] = await Promise.all([
      this.prisma.shop.findMany({
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          subscriptions: { include: { payments: { select: { amountPaise: true } } } },
          _count: { select: { printers: { where: { enabled: true } } } },
        },
      }),
      this.prisma.subscriptionPayment.aggregate({
        where: { receivedAt: { gte: monthStart } },
        _sum: { amountPaise: true },
      }),
    ]);
    return {
      enforced: this.config.BILLING_ENFORCED,
      collectedThisMonthPaise: collected._sum.amountPaise ?? 0,
      shops: shops.map((shop) => {
        const summary = summarize(shop.subscriptions, now);
        return {
          shopId: shop.id,
          shopName: shop.name,
          status:
            summary.status === 'ACTIVE' && (summary.daysLeft ?? 0) <= 7
              ? 'EXPIRING'
              : summary.status,
          printerSeats: summary.printerSeats,
          connectedPrinters: shop._count.printers,
          periodEnd: summary.periodEnd,
          daysLeft: summary.daysLeft,
          balanceDuePaise: Math.max(0, shopBalance(shop.subscriptions)),
        };
      }),
    };
  }

  private async lockShop(tx: Tx, shopId: string) {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM shops WHERE id = ${shopId}::uuid FOR UPDATE`;
    if (locked.length === 0) throw shopNotFound();
  }

  private async activeSub(tx: Tx, shopId: string, id: string) {
    const sub = await tx.subscription.findFirst({ where: { id, shopId } });
    if (!sub) throw notFound();
    if (sub.status !== 'ACTIVE')
      throw conflict('SUBSCRIPTION_CANCELLED', 'This subscription is cancelled.');
    return sub;
  }

  /** Non-cancelled periods of a shop never overlap (renewals start where the last one ends). */
  private async assertNoOverlap(
    tx: Tx,
    shopId: string,
    periodStart: Date,
    periodEnd: Date,
    exceptId?: string,
  ) {
    const active = await tx.subscription.findMany({
      where: { shopId, status: 'ACTIVE', ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { periodStart: true, periodEnd: true },
    });
    const clash = active.find((s) => overlaps(s, { periodStart, periodEnd }));
    if (clash) {
      throw conflict(
        'SUBSCRIPTION_OVERLAP',
        `This shop already has a plan from ${istDay(clash.periodStart)} to ${istDay(clash.periodEnd)}. Start the renewal on ${istDay(clash.periodEnd)}, or change that plan instead.`,
      );
    }
  }

  private revise(
    tx: Tx,
    staff: StaffContext,
    before: Subscription,
    kind: 'CHANGE_PLAN' | 'EXTEND' | 'CANCEL',
    reason: string,
    after: SubscriptionSnapshot,
  ) {
    return tx.subscriptionChange.create({
      data: {
        subscriptionId: before.id,
        shopId: before.shopId,
        kind,
        reason,
        before: snapshot(before),
        after,
        changedById: staff.userId,
      },
    });
  }

  private view(s: Full, names: Map<string, string>, now: Date): AdminSubscription {
    const paidPaise = s.payments.reduce((sum, p) => sum + p.amountPaise, 0);
    return {
      id: s.id,
      printerSeats: s.printerSeats,
      pricePerPrinterPaise: s.pricePerPrinterPaise,
      months: s.months,
      totalPaise: s.totalPaise,
      paidPaise,
      balancePaise: s.totalPaise - paidPaise,
      periodStart: s.periodStart.toISOString(),
      periodEnd: s.periodEnd.toISOString(),
      status: s.status,
      phase:
        s.status === 'CANCELLED'
          ? 'CANCELLED'
          : s.periodStart > now
            ? 'UPCOMING'
            : s.periodEnd <= now
              ? 'ENDED'
              : 'CURRENT',
      source: s.source,
      notes: s.notes,
      createdBy: (s.createdById && names.get(s.createdById)) ?? null,
      createdAt: s.createdAt.toISOString(),
      cancelledAt: s.cancelledAt?.toISOString() ?? null,
      cancelReason: s.cancelReason,
      payments: s.payments.map((p) => ({
        id: p.id,
        amountPaise: p.amountPaise,
        method: p.method,
        reference: p.reference,
        receivedAt: p.receivedAt.toISOString(),
        note: p.note,
        recordedBy: (p.recordedById && names.get(p.recordedById)) ?? null,
        createdAt: p.createdAt.toISOString(),
      })),
      changes: s.changes.map((c) => ({
        id: c.id,
        kind: c.kind,
        reason: c.reason,
        before: SubscriptionSnapshotSchema.parse(c.before),
        after: SubscriptionSnapshotSchema.parse(c.after),
        changedBy: (c.changedById && names.get(c.changedById)) ?? null,
        createdAt: c.createdAt.toISOString(),
      })),
    };
  }

  private async userNames(ids: (string | null)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((id): id is string => !!id))];
    if (unique.length === 0) return new Map();
    const users = await this.prisma.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true, email: true, phone: true },
    });
    return new Map(users.map((u) => [u.id, u.name ?? u.email ?? u.phone ?? 'Admin']));
  }
}
