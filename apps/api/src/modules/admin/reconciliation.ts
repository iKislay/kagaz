import { type MismatchType } from '@kagaz/shared';

/** The slice of an order the reconciliation rules look at (pure, unit-tested). */
export interface ReconOrder {
  id: string;
  publicRef: string;
  shopId: string;
  status: string;
  rejectionCode: string | null;
  createdAt: Date;
  paidAt: Date | null;
  payments: {
    status: string;
    verifiedAt: Date | null;
    refunds: { status: string; amountPaise: number }[];
  }[];
}

export interface ReconMismatch {
  type: MismatchType;
  orderId: string;
  publicRef: string;
  shopId: string;
  detail: string;
  at: Date;
}

const PAID_PAYMENT = new Set(['PAID', 'REFUND_PENDING', 'REFUNDED']);
const REJECTED_ORDER = new Set(['REJECTED', 'REFUND_PENDING', 'REFUNDED']);
/** Statuses that mean "paid but the shop hasn't moved it along". */
const WAITING = new Set(['AWAITING_PAYMENT', 'PENDING_REVIEW', 'QUEUED', 'NEEDS_OPERATOR_CHECK']);

/**
 * Reconciliation rules (P3.7, FR-ADMIN-10, T20). Payment status and order status are stored
 * separately (invariant 6); these flag where they — or the refunds — disagree:
 * - PAID_NO_PROGRESS: paid, still waiting in an early state after `stuckHours`.
 * - REJECTED_WITHOUT_REFUND: rejected after payment, no refund record.
 * - REFUND_WITHOUT_REJECTION: a refund exists but the order was never rejected.
 * - REFUND_STATUS_MISMATCH: refund outcome and order/payment state disagree.
 */
export function findOrderMismatches(
  order: ReconOrder,
  now: Date,
  stuckHours: number,
): ReconMismatch[] {
  const out: ReconMismatch[] = [];
  const flag = (type: MismatchType, detail: string, at: Date) =>
    out.push({
      type,
      orderId: order.id,
      publicRef: order.publicRef,
      shopId: order.shopId,
      detail,
      at,
    });

  const paidPayments = order.payments.filter((p) => PAID_PAYMENT.has(p.status));
  const paid = paidPayments.length > 0;
  const refunds = order.payments.flatMap((p) => p.refunds);
  const rejected = order.rejectionCode !== null || REJECTED_ORDER.has(order.status);
  const paidAt = order.paidAt ?? paidPayments[0]?.verifiedAt ?? order.createdAt;

  if (
    paid &&
    WAITING.has(order.status) &&
    now.getTime() - paidAt.getTime() > stuckHours * 3_600_000
  ) {
    flag(
      'PAID_NO_PROGRESS',
      `Paid ${Math.floor((now.getTime() - paidAt.getTime()) / 3_600_000)} h ago, still ${order.status}`,
      paidAt,
    );
  }
  if (rejected && paid && refunds.length === 0) {
    flag(
      'REJECTED_WITHOUT_REFUND',
      `Rejected (${order.status}) with a paid payment and no refund`,
      order.createdAt,
    );
  }
  if (refunds.length > 0 && !rejected) {
    flag(
      'REFUND_WITHOUT_REJECTION',
      `Refund recorded but order is ${order.status}`,
      order.createdAt,
    );
  }
  const succeeded = refunds.some((r) => r.status === 'SUCCEEDED');
  if (order.status === 'REFUNDED' && !succeeded) {
    flag('REFUND_STATUS_MISMATCH', 'Order REFUNDED without a succeeded refund', order.createdAt);
  } else if (succeeded && order.status !== 'REFUNDED') {
    flag(
      'REFUND_STATUS_MISMATCH',
      `Refund succeeded but order is ${order.status}`,
      order.createdAt,
    );
  } else if (
    succeeded &&
    order.payments.some(
      (p) => p.refunds.some((r) => r.status === 'SUCCEEDED') && p.status !== 'REFUNDED',
    )
  ) {
    flag('REFUND_STATUS_MISMATCH', 'Refund succeeded but payment is not REFUNDED', order.createdAt);
  }
  return out;
}

/** Median of a list of numbers (null when empty). */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Inclusive list of YYYY-MM-DD keys from `from` to `to`. */
export function dateKeys(from: string, to: string): string[] {
  const out: string[] = [];
  for (
    let t = Date.parse(`${from}T00:00:00Z`);
    t <= Date.parse(`${to}T00:00:00Z`);
    t += 86_400_000
  ) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}
