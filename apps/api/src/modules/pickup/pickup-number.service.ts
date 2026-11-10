import { Injectable } from '@nestjs/common';
import { kolkataBusinessDate } from '@kagaz/shared';
import { Clock } from '../../common/clock.js';
import { type Tx } from '../orders/order-state-machine.js';

export interface AssignedPickupNumber {
  pickupNumber: number;
  /** Business date, `YYYY-MM-DD` (Asia/Kolkata). */
  pickupDate: string;
}

/** `YYYY-MM-DD` → the Date Prisma stores in a `@db.Date` column (UTC midnight). */
export function pickupDateValue(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

/** A `@db.Date` value read back from Prisma → `YYYY-MM-DD`. */
export function pickupDateString(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

/**
 * ADR-002 daily pickup code. The next number for a shop's business day is taken with ONE
 * atomic upsert on `pickup_counters` (row lock until the surrounding transaction ends), so
 * concurrent payments get distinct numbers and a rolled-back payment doesn't keep one.
 */
@Injectable()
export class PickupNumberService {
  constructor(private readonly clock: Clock) {}

  /** The next number for `shopId` today. Call inside the payment-verified transaction. */
  async next(tx: Tx, shopId: string): Promise<AssignedPickupNumber> {
    const pickupDate = kolkataBusinessDate(this.clock.now());
    const rows = await tx.$queryRaw<{ last_number: number }[]>`
      INSERT INTO pickup_counters (shop_id, business_date, last_number)
           VALUES (${shopId}::uuid, ${pickupDate}::date, 1)
      ON CONFLICT (shop_id, business_date)
        DO UPDATE SET last_number = pickup_counters.last_number + 1
        RETURNING last_number`;
    const pickupNumber = Number(rows[0]!.last_number);
    return { pickupNumber, pickupDate };
  }
}
