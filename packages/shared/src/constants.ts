/** 32 symbols without visually confusing O/0/I/1 (enrollment codes, public refs). */
export const PICKUP_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const PAPER_SIZES = ['A4'] as const;

/** Payment.provider of pay-at-counter orders (ADR-003): no online payment, the shop collects. */
export const COUNTER_PAYMENT_PROVIDER = 'counter';

/** Shown on every customer page while payments are simulated (PRD FR-CUST-09). */
export const DEMO_PAYMENT_BANNER = 'DEMO PAYMENT — NO MONEY CHARGED';
export const DEMO_REFUND_NOTICE = 'Demo refund — no money moved';
