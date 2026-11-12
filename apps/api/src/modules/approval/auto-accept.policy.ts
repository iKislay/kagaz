import { z } from 'zod';
import { type PrintOptions } from '@kagaz/shared';
import { isWithinOpeningHours } from '../shops/opening-hours.js';

/** Why an order was NOT auto-accepted (stored on the PENDING_REVIEW order event). */
export const AutoAcceptReason = {
  MANUAL_MODE: 'MANUAL_MODE',
  AUTO_PAUSED: 'AUTO_PAUSED',
  SHOP_NOT_OPEN: 'SHOP_NOT_OPEN',
  SHOP_MAINTENANCE: 'SHOP_MAINTENANCE',
  OUTSIDE_OPENING_HOURS: 'OUTSIDE_OPENING_HOURS',
  FILE_NOT_VALIDATED: 'FILE_NOT_VALIDATED',
  TOO_MANY_PAGES: 'TOO_MANY_PAGES',
  TOO_MANY_COPIES: 'TOO_MANY_COPIES',
  TOO_MANY_SIDES: 'TOO_MANY_SIDES',
  NO_PRINTER: 'NO_PRINTER',
  CAPABILITIES_NOT_CONFIRMED: 'CAPABILITIES_NOT_CONFIRMED',
  UNSUPPORTED_COLOUR: 'UNSUPPORTED_COLOUR',
  UNSUPPORTED_DUPLEX: 'UNSUPPORTED_DUPLEX',
  UNSUPPORTED_PAPER: 'UNSUPPORTED_PAPER',
  PRINTER_OFFLINE: 'PRINTER_OFFLINE',
  QUEUE_FULL: 'QUEUE_FULL',
  /** ADR-003: the shop confirms pay-at-counter orders itself. */
  PAY_AT_COUNTER: 'PAY_AT_COUNTER',
} as const;
export type AutoAcceptReason = (typeof AutoAcceptReason)[keyof typeof AutoAcceptReason];

/** Shop.auto_limits with the D10 working defaults (50 pages, 5 copies, 250 sides, depth 10). */
export const AutoLimitsSchema = z.object({
  maxPages: z.int().positive().default(50),
  maxCopies: z.int().positive().default(5),
  maxSides: z.int().positive().default(250),
  maxQueueDepth: z.int().positive().default(10),
});
export type AutoLimits = z.infer<typeof AutoLimitsSchema>;

export function parseAutoLimits(raw: unknown): AutoLimits {
  const parsed = AutoLimitsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : AutoLimitsSchema.parse({});
}

export interface AutoAcceptShop {
  status: 'OPEN' | 'CLOSED' | 'MAINTENANCE';
  approvalMode: 'MANUAL' | 'AUTO';
  autoPaused: boolean;
  autoLimits: unknown;
  openingHours: unknown;
}

export interface AutoAcceptOrder {
  options: Pick<PrintOptions, 'colour' | 'duplex' | 'paperSize' | 'copies'>;
  /** Page count of the validated original; null when no valid file. */
  pageCount: number | null;
  /** Printed sides from the price snapshot/quote. */
  printedSides: number | null;
  fileValid: boolean;
  /** Paid "at the counter" (ADR-003): never auto-accepted. */
  payAtCounter?: boolean;
}

export interface AutoAcceptPrinter {
  id: string;
  enabled: boolean;
  capabilitiesConfirmed: boolean;
  colourCapable: boolean;
  duplexCapable: boolean;
  paperSizes: string[];
  isDefault: boolean;
  /** Last reported printer status (READY = idle and able to print). */
  status: string;
  /** Last heartbeat of the shop device that hosts this printer. */
  deviceLastHeartbeatAt: Date | null;
}

export interface QueueStats {
  /** Active print jobs per printer id (PREPARING/READY/LEASED/SUBMITTED). */
  depthByPrinter: Record<string, number>;
}

export interface AutoAcceptContext {
  now: Date;
  /** DEVICE_ONLINE_THRESHOLD_SECONDS (PRD §8.4: 45 s). */
  onlineThresholdSeconds: number;
}

export interface AutoAcceptResult {
  eligible: boolean;
  reasons: AutoAcceptReason[];
  /** The printer the order would go to (shortest queue, then default) when eligible. */
  printerId: string | null;
}

/**
 * Guarded auto-accept (P2.6, PRD §8.4). Pure: all six preconditions must hold —
 * 1 shop OPEN, in opening hours, not maintenance · 2 mode AUTO and not paused ·
 * 3 an enabled, operator-confirmed printer supporting colour/duplex/A4 ·
 * 4 that printer online (device heartbeat ≤ threshold, status READY) ·
 * 5 file validated, pages/copies/sides within limits · 6 printer queue below the limit.
 * Every failing precondition is reported (not just the first), for the audit trail.
 */
export const AutoAcceptPolicy = {
  evaluate(
    order: AutoAcceptOrder,
    shop: AutoAcceptShop,
    printers: AutoAcceptPrinter[],
    queueStats: QueueStats,
    ctx: AutoAcceptContext,
  ): AutoAcceptResult {
    const reasons: AutoAcceptReason[] = [];
    const limits = parseAutoLimits(shop.autoLimits);

    // 1. Shop availability
    if (shop.status === 'MAINTENANCE') reasons.push(AutoAcceptReason.SHOP_MAINTENANCE);
    else if (shop.status !== 'OPEN') reasons.push(AutoAcceptReason.SHOP_NOT_OPEN);
    if (!isWithinOpeningHours(shop.openingHours, ctx.now)) {
      reasons.push(AutoAcceptReason.OUTSIDE_OPENING_HOURS);
    }

    // 2. Mode
    if (shop.approvalMode !== 'AUTO') reasons.push(AutoAcceptReason.MANUAL_MODE);
    else if (shop.autoPaused) reasons.push(AutoAcceptReason.AUTO_PAUSED);
    if (order.payAtCounter) reasons.push(AutoAcceptReason.PAY_AT_COUNTER);

    // 5. File and size limits
    if (!order.fileValid || order.pageCount === null) {
      reasons.push(AutoAcceptReason.FILE_NOT_VALIDATED);
    } else if (order.pageCount > limits.maxPages) {
      reasons.push(AutoAcceptReason.TOO_MANY_PAGES);
    }
    if (order.options.copies > limits.maxCopies) reasons.push(AutoAcceptReason.TOO_MANY_COPIES);
    if (order.printedSides === null || order.printedSides > limits.maxSides) {
      reasons.push(AutoAcceptReason.TOO_MANY_SIDES);
    }

    // 3. Capable printer → 4. online → 6. queue
    const enabled = printers.filter((p) => p.enabled);
    let candidates = enabled;
    const narrow = (keep: (p: AutoAcceptPrinter) => boolean, reason: AutoAcceptReason) => {
      if (candidates.length === 0) return;
      const next = candidates.filter(keep);
      if (next.length === 0) reasons.push(reason);
      candidates = next;
    };
    if (enabled.length === 0) reasons.push(AutoAcceptReason.NO_PRINTER);
    narrow((p) => p.capabilitiesConfirmed, AutoAcceptReason.CAPABILITIES_NOT_CONFIRMED);
    if (order.options.colour) narrow((p) => p.colourCapable, AutoAcceptReason.UNSUPPORTED_COLOUR);
    if (order.options.duplex) narrow((p) => p.duplexCapable, AutoAcceptReason.UNSUPPORTED_DUPLEX);
    narrow(
      (p) => p.paperSizes.includes(order.options.paperSize ?? 'A4'),
      AutoAcceptReason.UNSUPPORTED_PAPER,
    );
    const cutoff = ctx.now.getTime() - ctx.onlineThresholdSeconds * 1000;
    narrow(
      (p) =>
        p.status === 'READY' &&
        p.deviceLastHeartbeatAt !== null &&
        p.deviceLastHeartbeatAt.getTime() >= cutoff,
      AutoAcceptReason.PRINTER_OFFLINE,
    );
    const depth = (p: AutoAcceptPrinter) => queueStats.depthByPrinter[p.id] ?? 0;
    narrow((p) => depth(p) < limits.maxQueueDepth, AutoAcceptReason.QUEUE_FULL);

    const chosen =
      [...candidates].sort(
        (a, b) => depth(a) - depth(b) || Number(b.isDefault) - Number(a.isDefault),
      )[0] ?? null;
    const eligible = reasons.length === 0 && chosen !== null;
    return { eligible, reasons, printerId: eligible ? chosen.id : null };
  },
};
