/** 32 symbols without visually confusing O/0/I/1 — 8 chars ≈ 40 bits (PRD FR-PICK-01). */
export const PICKUP_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const PICKUP_CODE_LENGTH = 8;

export const PAPER_SIZES = ['A4'] as const;
export type PaperSize = (typeof PAPER_SIZES)[number];

/** Shown on every customer page while payments are simulated (PRD FR-CUST-09). */
export const DEMO_PAYMENT_BANNER = 'DEMO PAYMENT — NO MONEY CHARGED';
export const DEMO_REFUND_NOTICE = 'Demo refund — no money moved';
