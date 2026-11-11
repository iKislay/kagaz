import {
  type ShopLifecycle,
  type SudoSubscription,
  type SudoSubscriptionPayment,
} from '@kagaz/shared';
import { type ShopSubscription, type SubscriptionPayment } from '../../generated/prisma/client.js';
import { daysLeft, isOverdue } from './billing.js';

export type SubscriptionRow = ShopSubscription & {
  plan: { id: string; code: string; name: string };
  _count: { payments: number };
};

/** Prisma include for SubscriptionRow. */
export const SUBSCRIPTION_INCLUDE = {
  plan: { select: { id: true, code: true, name: true } },
  _count: { select: { payments: true } },
} as const;

export function subscriptionView(s: SubscriptionRow, now: Date): SudoSubscription {
  return {
    id: s.id,
    shopId: s.shopId,
    plan: s.plan,
    status: s.status,
    pricePaise: s.pricePaise,
    interval: s.interval,
    currentPeriodStart: s.currentPeriodStart.toISOString(),
    currentPeriodEnd: s.currentPeriodEnd.toISOString(),
    trialEndsAt: s.trialEndsAt?.toISOString() ?? null,
    cancelAtPeriodEnd: s.cancelAtPeriodEnd,
    cancelledAt: s.cancelledAt?.toISOString() ?? null,
    notes: s.notes,
    createdAt: s.createdAt.toISOString(),
    overdue: isOverdue(s, now),
    daysLeft: daysLeft(s.currentPeriodEnd, now),
    paymentCount: s._count.payments,
  };
}

export function paymentView(
  p: SubscriptionPayment,
  recorders: Map<string, { id: string; name: string | null }>,
): SudoSubscriptionPayment {
  return {
    id: p.id,
    subscriptionId: p.subscriptionId,
    amountPaise: p.amountPaise,
    method: p.method,
    reference: p.reference,
    note: p.note,
    periodStart: p.periodStart.toISOString(),
    periodEnd: p.periodEnd.toISOString(),
    paidAt: p.paidAt.toISOString(),
    recordedBy: recorders.get(p.recordedById) ?? null,
    createdAt: p.createdAt.toISOString(),
  };
}

export function lifecycleOf(shop: {
  suspendedAt: Date | null;
  archivedAt: Date | null;
}): ShopLifecycle {
  if (shop.archivedAt) return 'ARCHIVED';
  if (shop.suspendedAt) return 'SUSPENDED';
  return 'LIVE';
}
