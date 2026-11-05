import { OrderStatus } from './enums.js';

/**
 * Allowed order status transitions (docs/PRD.md §9.1).
 * The API's OrderStateMachine is the only code allowed to change an order's status,
 * and it must consult this table.
 */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  [OrderStatus.DRAFT]: [OrderStatus.AWAITING_PAYMENT, OrderStatus.CANCELLED],
  [OrderStatus.AWAITING_PAYMENT]: [
    OrderStatus.PENDING_REVIEW,
    OrderStatus.QUEUED,
    OrderStatus.CANCELLED,
  ],
  [OrderStatus.PENDING_REVIEW]: [OrderStatus.QUEUED, OrderStatus.REJECTED],
  [OrderStatus.QUEUED]: [OrderStatus.PRINTING, OrderStatus.REJECTED],
  [OrderStatus.PRINTING]: [OrderStatus.READY_FOR_PICKUP, OrderStatus.NEEDS_OPERATOR_CHECK],
  [OrderStatus.NEEDS_OPERATOR_CHECK]: [
    OrderStatus.READY_FOR_PICKUP,
    OrderStatus.QUEUED,
    OrderStatus.REJECTED,
  ],
  [OrderStatus.READY_FOR_PICKUP]: [OrderStatus.COLLECTED],
  [OrderStatus.COLLECTED]: [],
  [OrderStatus.REJECTED]: [OrderStatus.REFUND_PENDING],
  [OrderStatus.CANCELLED]: [],
  [OrderStatus.REFUND_PENDING]: [OrderStatus.REFUNDED],
  [OrderStatus.REFUNDED]: [],
};

export const TERMINAL_ORDER_STATUSES: readonly OrderStatus[] = [
  OrderStatus.COLLECTED,
  OrderStatus.CANCELLED,
  OrderStatus.REFUNDED,
];

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}
