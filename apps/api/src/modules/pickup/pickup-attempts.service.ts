import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { type Tx } from '../orders/order-state-machine.js';

/** FR-PICK-05 defaults: 5 failures within 10 minutes → 10-minute lockout per device. */
export const PICKUP_MAX_FAILURES = 5;
export const PICKUP_FAILURE_WINDOW_MS = 10 * 60_000;
export const PICKUP_LOCKOUT_MS = 10 * 60_000;

export interface PickupFailureState {
  failuresInWindow: number;
  /** Set when this failure triggered a lockout. */
  lockedUntil: Date | null;
}

/**
 * Per-device pickup brute-force protection (P4.5, T16). The counter lives on ShopDevice and
 * is updated with single atomic statements, so concurrent wrong guesses all count.
 */
@Injectable()
export class PickupAttemptsService {
  constructor(private readonly prisma: PrismaService) {}

  /** The lockout end if this device is currently locked out, else null. */
  async lockedUntil(deviceId: string, now = new Date()): Promise<Date | null> {
    const device = await this.prisma.shopDevice.findUnique({
      where: { id: deviceId },
      select: { pickupLockUntil: true },
    });
    const until = device?.pickupLockUntil;
    return until && until > now ? until : null;
  }

  /** Count one failure in the device's current window; lock it out on the 5th. */
  async recordFailure(tx: Tx, deviceId: string, now = new Date()): Promise<PickupFailureState> {
    const windowStart = new Date(now.getTime() - PICKUP_FAILURE_WINDOW_MS);
    const rows = await tx.$queryRaw<{ pickup_failures: number }[]>`
      UPDATE shop_devices
         SET pickup_failures = CASE
               WHEN pickup_window_at IS NULL OR pickup_window_at < ${windowStart} THEN 1
               ELSE pickup_failures + 1 END,
             pickup_window_at = CASE
               WHEN pickup_window_at IS NULL OR pickup_window_at < ${windowStart} THEN ${now}
               ELSE pickup_window_at END
       WHERE id = ${deviceId}::uuid
   RETURNING pickup_failures`;
    const failuresInWindow = Number(rows[0]?.pickup_failures ?? 0);
    if (failuresInWindow < PICKUP_MAX_FAILURES) return { failuresInWindow, lockedUntil: null };

    const lockedUntil = new Date(now.getTime() + PICKUP_LOCKOUT_MS);
    await tx.shopDevice.update({
      where: { id: deviceId },
      data: { pickupLockUntil: lockedUntil, pickupFailures: 0, pickupWindowAt: null },
    });
    return { failuresInWindow, lockedUntil };
  }
}
