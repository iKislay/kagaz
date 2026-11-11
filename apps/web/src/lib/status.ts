import { OrderStatus } from '@kagaz/shared';

export type Tone = 'neutral' | 'accent' | 'green' | 'orange' | 'red';

/** Customer-facing wording for each order status. */
export const STATUS_COPY: Record<OrderStatus, { label: string; detail: string; tone: Tone }> = {
  DRAFT: { label: 'Draft', detail: 'Upload your PDF to continue.', tone: 'neutral' },
  AWAITING_PAYMENT: {
    label: 'Awaiting payment',
    detail: 'Review the price and pay to send it to the shop.',
    tone: 'orange',
  },
  PENDING_REVIEW: {
    label: 'Waiting for the shop',
    detail: 'Paid. The shop will accept your order shortly.',
    tone: 'accent',
  },
  QUEUED: {
    label: 'In the print queue',
    detail: 'The shop accepted your order. It prints in turn.',
    tone: 'accent',
  },
  PRINTING: { label: 'Printing', detail: 'Your pages are being printed now.', tone: 'accent' },
  NEEDS_OPERATOR_CHECK: {
    label: 'Being checked',
    detail: 'The shop is checking the printer. No action needed from you.',
    tone: 'orange',
  },
  READY_FOR_PICKUP: {
    label: 'Ready for pickup',
    detail: 'Your prints are waiting at the shop counter.',
    tone: 'green',
  },
  COLLECTED: { label: 'Collected', detail: 'Picked up. Thanks for using Kagaz!', tone: 'green' },
  REJECTED: { label: 'Rejected', detail: 'The shop couldn’t print this order.', tone: 'red' },
  CANCELLED: {
    label: 'Cancelled',
    detail: 'This order was cancelled before payment.',
    tone: 'neutral',
  },
  REFUND_PENDING: {
    label: 'Refund in progress',
    detail: 'The shop rejected this order; your refund is on its way.',
    tone: 'orange',
  },
  REFUNDED: {
    label: 'Refunded',
    detail: 'The shop rejected this order and your payment was refunded.',
    tone: 'neutral',
  },
};

/** The happy-path steps shown on the tracking timeline. */
export const TIMELINE_STEPS: { status: OrderStatus; label: string }[] = [
  { status: OrderStatus.PENDING_REVIEW, label: 'Paid' },
  { status: OrderStatus.QUEUED, label: 'Accepted by shop' },
  { status: OrderStatus.PRINTING, label: 'Printing' },
  { status: OrderStatus.READY_FOR_PICKUP, label: 'Printed — ready for pickup' },
];

/** No further updates expected (ADR-002: READY_FOR_PICKUP is the normal end state). */
export const TERMINAL: readonly OrderStatus[] = [
  OrderStatus.READY_FOR_PICKUP,
  OrderStatus.COLLECTED,
  OrderStatus.CANCELLED,
  OrderStatus.REFUNDED,
];

export const REJECT_REASONS: Record<string, string> = {
  FILE_UNREADABLE: 'The file couldn’t be printed correctly.',
  CONTENT_NOT_ALLOWED: 'The shop can’t print this content.',
  PRINTER_UNAVAILABLE: 'The shop’s printer is unavailable.',
  OPTION_UNSUPPORTED: 'The shop can’t print with these options.',
  SHOP_CLOSING: 'The shop is closing.',
  OUT_OF_SUPPLIES: 'The shop ran out of paper or ink.',
  PRINT_FAILED: 'Printing failed at the shop.',
  OTHER: 'The shop couldn’t complete this order.',
};
