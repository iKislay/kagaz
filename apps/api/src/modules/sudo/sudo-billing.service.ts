import { HttpStatus, Injectable } from '@nestjs/common';
import {
  OPEN_SUBSCRIPTION_STATUSES,
  type SudoPlan,
  type SudoPlanCreateRequest,
  type SudoPlanUpdateRequest,
  type SudoSubscription,
  type SudoSubscriptionCancelRequest,
  type SudoSubscriptionCreateRequest,
  type SudoSubscriptionPayment,
  type SudoSubscriptionPaymentCreateRequest,
  type SudoSubscriptionUpdateRequest,
} from '@kagaz/shared';
import { AppError } from '../../common/http/api-exception.filter.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { type Prisma } from '../../generated/prisma/client.js';
import { type StaffContext } from '../identity/staff-session.js';
import { type Tx } from '../orders/order-state-machine.js';
import { auditStaffAction } from '../admin/admin-audit.js';
import { isOpen, newSubscriptionTerms, nextPeriod } from './billing.js';
import { SUBSCRIPTION_INCLUDE, paymentView, subscriptionView } from './views.js';

const OPEN = [...OPEN_SUBSCRIPTION_STATUSES];

/**
 * Platform billing (/sudoadmin): the plan catalogue, each shop's subscription and the payments
 * Kagaz received for it. Bookkeeping only — no gateway, no PaymentProvider. Every change is
 * audited in the same transaction.
 *
 * Error codes: PLAN_NOT_FOUND, PLAN_CODE_TAKEN, PLAN_INACTIVE, PLAN_IN_USE, SHOP_NOT_FOUND,
 * SUBSCRIPTION_NOT_FOUND, SUBSCRIPTION_EXISTS, SUBSCRIPTION_CLOSED, SUBSCRIPTION_HAS_PAYMENTS,
 * PAYMENT_NOT_FOUND.
 */
@Injectable()
export class SudoBillingService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Plans ───

  async listPlans(): Promise<SudoPlan[]> {
    const plans = await this.prisma.subscriptionPlan.findMany({
      orderBy: [{ active: 'desc' }, { pricePaise: 'asc' }, { name: 'asc' }],
    });
    const counts = await this.prisma.shopSubscription.groupBy({
      by: ['planId'],
      where: { status: { in: OPEN } },
      _count: { id: true },
    });
    const byPlan = new Map(counts.map((c) => [c.planId, c._count.id]));
    return plans.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      description: p.description,
      pricePaise: p.pricePaise,
      interval: p.interval,
      trialDays: p.trialDays,
      maxPrinters: p.maxPrinters,
      maxMonthlyOrders: p.maxMonthlyOrders,
      active: p.active,
      subscriberCount: byPlan.get(p.id) ?? 0,
      createdAt: p.createdAt.toISOString(),
    }));
  }

  async createPlan(staff: StaffContext, req: SudoPlanCreateRequest): Promise<SudoPlan> {
    const id = await this.prisma.$transaction(async (tx) => {
      if (await tx.subscriptionPlan.findUnique({ where: { code: req.code } })) {
        throw new AppError('PLAN_CODE_TAKEN', 'A plan with this code exists', HttpStatus.CONFLICT);
      }
      const plan = await tx.subscriptionPlan.create({
        data: {
          code: req.code,
          name: req.name,
          description: req.description ?? null,
          pricePaise: req.pricePaise,
          interval: req.interval,
          trialDays: req.trialDays ?? 0,
          maxPrinters: req.maxPrinters ?? null,
          maxMonthlyOrders: req.maxMonthlyOrders ?? null,
        },
      });
      await auditStaffAction(tx, staff, 'sudo.plan.created', null, {
        planId: plan.id,
        code: plan.code,
        pricePaise: plan.pricePaise,
        interval: plan.interval,
      });
      return plan.id;
    });
    return this.plan(id);
  }

  async updatePlan(
    staff: StaffContext,
    planId: string,
    req: SudoPlanUpdateRequest,
  ): Promise<SudoPlan> {
    await this.prisma.$transaction(async (tx) => {
      const plan = await tx.subscriptionPlan.findUnique({ where: { id: planId } });
      if (!plan) throw planNotFound();
      await tx.subscriptionPlan.update({ where: { id: planId }, data: req });
      await auditStaffAction(tx, staff, 'sudo.plan.updated', null, {
        planId,
        code: plan.code,
        changes: req as Prisma.InputJsonValue,
      });
    });
    return this.plan(planId);
  }

  /** Only a plan no subscription ever used can be deleted; otherwise deactivate it. */
  async deletePlan(staff: StaffContext, planId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const plan = await tx.subscriptionPlan.findUnique({
        where: { id: planId },
        include: { _count: { select: { subscriptions: true } } },
      });
      if (!plan) throw planNotFound();
      if (plan._count.subscriptions > 0) {
        throw new AppError(
          'PLAN_IN_USE',
          'Shops have used this plan. Deactivate it instead of deleting.',
          HttpStatus.CONFLICT,
        );
      }
      await tx.subscriptionPlan.delete({ where: { id: planId } });
      await auditStaffAction(tx, staff, 'sudo.plan.deleted', null, { planId, code: plan.code });
    });
  }

  private async plan(id: string): Promise<SudoPlan> {
    return (await this.listPlans()).find((p) => p.id === id)!;
  }

  // ─── Subscriptions ───

  /** Closes subscriptions that were set to cancel at period end and whose period is over. */
  async settleEnded(now = new Date()): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE shop_subscriptions
         SET status = 'CANCELLED', cancelled_at = current_period_end, updated_at = now()
       WHERE cancel_at_period_end
         AND status IN ('TRIALING', 'ACTIVE', 'PAST_DUE')
         AND current_period_end <= ${now}`;
  }

  async createSubscription(
    staff: StaffContext,
    shopId: string,
    req: SudoSubscriptionCreateRequest,
  ): Promise<SudoSubscription> {
    await this.settleEnded();
    const id = await this.prisma.$transaction((tx) =>
      this.createSubscriptionTx(tx, staff, shopId, req),
    );
    return this.subscription(shopId, id);
  }

  /** Also used by onboarding, inside its transaction. */
  async createSubscriptionTx(
    tx: Tx,
    staff: StaffContext,
    shopId: string,
    req: SudoSubscriptionCreateRequest,
  ): Promise<string> {
    const shop = await tx.shop.findUnique({ where: { id: shopId }, select: { id: true } });
    if (!shop) throw shopNotFound();
    const plan = await tx.subscriptionPlan.findUnique({ where: { id: req.planId } });
    if (!plan) throw planNotFound();
    if (!plan.active) {
      throw new AppError('PLAN_INACTIVE', 'This plan is no longer offered', HttpStatus.CONFLICT);
    }
    const open = await tx.shopSubscription.findFirst({
      where: { shopId, status: { in: OPEN } },
      select: { id: true },
    });
    if (open) throw subscriptionExists();

    const start = req.startsAt ? new Date(req.startsAt) : new Date();
    const terms = newSubscriptionTerms(start, req.trialDays ?? plan.trialDays);
    const pricePaise = req.pricePaise ?? plan.pricePaise;
    const created = await tx.shopSubscription
      .create({
        data: {
          shopId,
          planId: plan.id,
          ...terms,
          pricePaise,
          interval: plan.interval,
          notes: req.notes ?? null,
        },
      })
      .catch((err: unknown) => {
        // Partial unique index: a concurrent request opened one first.
        if ((err as { code?: string }).code === 'P2002') throw subscriptionExists();
        throw err;
      });
    await auditStaffAction(tx, staff, 'sudo.subscription.created', shopId, {
      subscriptionId: created.id,
      plan: plan.code,
      pricePaise,
      interval: plan.interval,
      status: terms.status,
      currentPeriodEnd: terms.currentPeriodEnd.toISOString(),
    });
    return created.id;
  }

  async updateSubscription(
    staff: StaffContext,
    shopId: string,
    subscriptionId: string,
    req: SudoSubscriptionUpdateRequest,
  ): Promise<SudoSubscription> {
    await this.prisma.$transaction(async (tx) => {
      const sub = await this.findSub(tx, shopId, subscriptionId);
      if (!isOpen(sub.status)) throw subscriptionClosed();
      const data: Prisma.ShopSubscriptionUncheckedUpdateInput = {};
      const changes: Record<string, Prisma.InputJsonValue | null> = {};
      if (req.planId && req.planId !== sub.planId) {
        const plan = await tx.subscriptionPlan.findUnique({ where: { id: req.planId } });
        if (!plan) throw planNotFound();
        if (!plan.active) {
          throw new AppError(
            'PLAN_INACTIVE',
            'This plan is no longer offered',
            HttpStatus.CONFLICT,
          );
        }
        data.planId = plan.id;
        data.interval = plan.interval;
        // Switching plans moves to the new plan's price unless a price was agreed explicitly.
        data.pricePaise = req.pricePaise ?? plan.pricePaise;
        changes.plan = plan.code;
        changes.pricePaise = data.pricePaise;
      } else if (req.pricePaise !== undefined && req.pricePaise !== sub.pricePaise) {
        data.pricePaise = req.pricePaise;
        changes.pricePaise = req.pricePaise;
      }
      if (req.status && req.status !== sub.status) {
        data.status = req.status;
        changes.status = req.status;
      }
      if (req.currentPeriodEnd) {
        const end = new Date(req.currentPeriodEnd);
        if (end.getTime() !== sub.currentPeriodEnd.getTime()) {
          data.currentPeriodEnd = end;
          changes.currentPeriodEnd = end.toISOString();
        }
      }
      if (req.cancelAtPeriodEnd !== undefined && req.cancelAtPeriodEnd !== sub.cancelAtPeriodEnd) {
        data.cancelAtPeriodEnd = req.cancelAtPeriodEnd;
        changes.cancelAtPeriodEnd = req.cancelAtPeriodEnd;
      }
      if (req.notes !== undefined && req.notes !== sub.notes) {
        data.notes = req.notes;
        changes.notes = req.notes === null ? null : 'changed';
      }
      if (Object.keys(data).length === 0) return;
      await tx.shopSubscription.update({ where: { id: sub.id }, data });
      await auditStaffAction(tx, staff, 'sudo.subscription.updated', shopId, {
        subscriptionId: sub.id,
        changes,
      });
    });
    return this.subscription(shopId, subscriptionId);
  }

  async cancelSubscription(
    staff: StaffContext,
    shopId: string,
    subscriptionId: string,
    req: SudoSubscriptionCancelRequest,
  ): Promise<SudoSubscription> {
    await this.prisma.$transaction(async (tx) => {
      const sub = await this.findSub(tx, shopId, subscriptionId);
      if (!isOpen(sub.status)) throw subscriptionClosed();
      await tx.shopSubscription.update({
        where: { id: sub.id },
        data: req.atPeriodEnd
          ? { cancelAtPeriodEnd: true }
          : { status: 'CANCELLED', cancelledAt: new Date(), cancelAtPeriodEnd: false },
      });
      await auditStaffAction(tx, staff, 'sudo.subscription.cancelled', shopId, {
        subscriptionId: sub.id,
        atPeriodEnd: req.atPeriodEnd,
        reason: req.reason ?? null,
      });
    });
    await this.settleEnded();
    return this.subscription(shopId, subscriptionId);
  }

  /** A subscription with recorded payments is history and can't be deleted. */
  async deleteSubscription(
    staff: StaffContext,
    shopId: string,
    subscriptionId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const sub = await this.findSub(tx, shopId, subscriptionId);
      if (sub._count.payments > 0) {
        throw new AppError(
          'SUBSCRIPTION_HAS_PAYMENTS',
          'This subscription has recorded payments. Cancel it instead of deleting.',
          HttpStatus.CONFLICT,
        );
      }
      await tx.shopSubscription.delete({ where: { id: sub.id } });
      await auditStaffAction(tx, staff, 'sudo.subscription.deleted', shopId, {
        subscriptionId: sub.id,
        plan: sub.plan.code,
        status: sub.status,
      });
    });
  }

  async recordPayment(
    staff: StaffContext,
    shopId: string,
    subscriptionId: string,
    req: SudoSubscriptionPaymentCreateRequest,
  ): Promise<SudoSubscriptionPayment> {
    const extend = req.extendPeriod ?? true;
    const payment = await this.prisma.$transaction(async (tx) => {
      const sub = await this.findSub(tx, shopId, subscriptionId);
      if (extend && !isOpen(sub.status)) throw subscriptionClosed();
      const period = extend
        ? nextPeriod(sub.currentPeriodEnd, sub.interval)
        : { periodStart: sub.currentPeriodStart, periodEnd: sub.currentPeriodEnd };
      const created = await tx.subscriptionPayment.create({
        data: {
          subscriptionId: sub.id,
          shopId,
          amountPaise: req.amountPaise,
          method: req.method,
          reference: req.reference ?? null,
          note: req.note ?? null,
          ...period,
          paidAt: req.paidAt ? new Date(req.paidAt) : new Date(),
          recordedById: staff.userId,
        },
      });
      if (extend) {
        await tx.shopSubscription.update({
          where: { id: sub.id },
          data: {
            status: 'ACTIVE',
            currentPeriodStart: period.periodStart,
            currentPeriodEnd: period.periodEnd,
          },
        });
      }
      await auditStaffAction(tx, staff, 'sudo.subscription.payment_recorded', shopId, {
        subscriptionId: sub.id,
        paymentId: created.id,
        amountPaise: req.amountPaise,
        method: req.method,
        extendPeriod: extend,
        periodEnd: period.periodEnd.toISOString(),
      });
      return created;
    });
    const recorder = await this.prisma.user.findUnique({
      where: { id: staff.userId },
      select: { id: true, name: true },
    });
    return paymentView(payment, new Map(recorder ? [[recorder.id, recorder]] : []));
  }

  /** Removes a mistaken entry. The subscription's period is not rolled back (edit it if needed). */
  async deletePayment(staff: StaffContext, shopId: string, paymentId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const payment = await tx.subscriptionPayment.findFirst({ where: { id: paymentId, shopId } });
      if (!payment) {
        throw new AppError('PAYMENT_NOT_FOUND', 'Payment not found', HttpStatus.NOT_FOUND);
      }
      await tx.subscriptionPayment.delete({ where: { id: payment.id } });
      await auditStaffAction(tx, staff, 'sudo.subscription.payment_deleted', shopId, {
        subscriptionId: payment.subscriptionId,
        paymentId: payment.id,
        amountPaise: payment.amountPaise,
        method: payment.method,
        paidAt: payment.paidAt.toISOString(),
      });
    });
  }

  private async findSub(tx: Tx, shopId: string, subscriptionId: string) {
    const sub = await tx.shopSubscription.findFirst({
      where: { id: subscriptionId, shopId },
      include: SUBSCRIPTION_INCLUDE,
    });
    if (!sub) {
      throw new AppError('SUBSCRIPTION_NOT_FOUND', 'Subscription not found', HttpStatus.NOT_FOUND);
    }
    return sub;
  }

  private async subscription(shopId: string, id: string): Promise<SudoSubscription> {
    const sub = await this.findSub(this.prisma, shopId, id);
    return subscriptionView(sub, new Date());
  }
}

function planNotFound(): AppError {
  return new AppError('PLAN_NOT_FOUND', 'Plan not found', HttpStatus.NOT_FOUND);
}
function shopNotFound(): AppError {
  return new AppError('SHOP_NOT_FOUND', 'Shop not found', HttpStatus.NOT_FOUND);
}
function subscriptionExists(): AppError {
  return new AppError(
    'SUBSCRIPTION_EXISTS',
    'This shop already has an open subscription. Change or cancel it first.',
    HttpStatus.CONFLICT,
  );
}
function subscriptionClosed(): AppError {
  return new AppError(
    'SUBSCRIPTION_CLOSED',
    'This subscription is cancelled. Start a new one instead.',
    HttpStatus.CONFLICT,
  );
}
