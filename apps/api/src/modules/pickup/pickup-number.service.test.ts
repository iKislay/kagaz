import { describe, expect, it } from 'vitest';
import { Clock } from '../../common/clock.js';
import { type Tx } from '../orders/order-state-machine.js';
import { PickupNumberService, pickupDateString, pickupDateValue } from './pickup-number.service.js';

/** In-memory stand-in for `pickup_counters` that honours the upsert's semantics. */
function fakeTx() {
  const counters = new Map<string, number>();
  const statements: string[] = [];
  const tx = {
    $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
      statements.push(strings.join('?'));
      const [shopId, date] = values as [string, string];
      const key = `${shopId}|${date}`;
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      return Promise.resolve([{ last_number: next }]);
    },
  } as unknown as Tx;
  return { tx, counters, statements };
}

class FakeClock extends Clock {
  constructor(public at: Date) {
    super();
  }
  override now(): Date {
    return this.at;
  }
}

describe('ADR-002: PickupNumberService', () => {
  it('ADR-002: numbers count up per shop and business date, restarting at midnight IST', async () => {
    const clock = new FakeClock(new Date('2026-11-07T18:29:00Z')); // 23:59 IST, 7 Nov
    const service = new PickupNumberService(clock);
    const { tx, statements } = fakeTx();

    expect(await service.next(tx, 'shop-a')).toEqual({ pickupNumber: 1, pickupDate: '2026-11-07' });
    expect(await service.next(tx, 'shop-a')).toEqual({ pickupNumber: 2, pickupDate: '2026-11-07' });
    expect(await service.next(tx, 'shop-b')).toEqual({ pickupNumber: 1, pickupDate: '2026-11-07' });

    clock.at = new Date('2026-11-07T18:30:00Z'); // 00:00 IST, 8 Nov
    expect(await service.next(tx, 'shop-a')).toEqual({ pickupNumber: 1, pickupDate: '2026-11-08' });

    // One atomic upsert per number, starting at 1.
    expect(statements).toHaveLength(4);
    expect(statements[0]).toMatch(/ON CONFLICT \(shop_id, business_date\)/);
    expect(statements[0]).toMatch(/last_number = pickup_counters\.last_number \+ 1/);
    expect(statements[0]).toMatch(/RETURNING last_number/);
  });

  it('ADR-002: business dates round-trip through the DATE column', () => {
    expect(pickupDateString(pickupDateValue('2026-11-07'))).toBe('2026-11-07');
    expect(pickupDateString(null)).toBeNull();
  });
});
