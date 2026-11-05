import { describe, expect, it } from 'vitest';
import { OrderStatus } from './enums.js';
import { ORDER_TRANSITIONS, TERMINAL_ORDER_STATUSES, canTransition } from './order-transitions.js';
import { PrintOptionsSchema } from './schemas.js';

describe('order transitions', () => {
  it('covers every status', () => {
    expect(Object.keys(ORDER_TRANSITIONS).sort()).toEqual(Object.values(OrderStatus).sort());
  });

  it('terminal statuses have no outgoing transitions', () => {
    for (const status of TERMINAL_ORDER_STATUSES) {
      expect(ORDER_TRANSITIONS[status]).toEqual([]);
    }
  });

  it('only allows READY after printing or an operator check', () => {
    const into = Object.entries(ORDER_TRANSITIONS)
      .filter(([, targets]) => targets.includes(OrderStatus.READY_FOR_PICKUP))
      .map(([from]) => from)
      .sort();
    expect(into).toEqual([OrderStatus.NEEDS_OPERATOR_CHECK, OrderStatus.PRINTING].sort());
  });

  it('never lets an unpaid order reach the print queue except via payment', () => {
    expect(canTransition(OrderStatus.DRAFT, OrderStatus.QUEUED)).toBe(false);
    expect(canTransition(OrderStatus.AWAITING_PAYMENT, OrderStatus.QUEUED)).toBe(true);
  });

  it('allows the happy path', () => {
    const path = [
      OrderStatus.DRAFT,
      OrderStatus.AWAITING_PAYMENT,
      OrderStatus.PENDING_REVIEW,
      OrderStatus.QUEUED,
      OrderStatus.PRINTING,
      OrderStatus.READY_FOR_PICKUP,
      OrderStatus.COLLECTED,
    ];
    for (let i = 1; i < path.length; i++) {
      expect(canTransition(path[i - 1]!, path[i]!)).toBe(true);
    }
  });
});

describe('PrintOptionsSchema', () => {
  it('defaults paper size to A4 and rejects unknown fields', () => {
    expect(PrintOptionsSchema.parse({ copies: 2, colour: false, duplex: true })).toEqual({
      copies: 2,
      colour: false,
      duplex: true,
      paperSize: 'A4',
    });
    expect(() =>
      PrintOptionsSchema.parse({ copies: 1, colour: false, duplex: false, amount: 1 }),
    ).toThrow();
    expect(() =>
      PrintOptionsSchema.parse({ copies: 1, colour: false, duplex: false, paperSize: 'A3' }),
    ).toThrow();
  });
});
