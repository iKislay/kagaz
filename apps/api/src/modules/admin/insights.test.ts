import { describe, expect, it } from 'vitest';
import { istDateKey, istDayStart } from '@kagaz/shared';
import { deviceHealth } from './devices-admin.service.js';
import { compareVersions, hasVersionDrift } from './health.service.js';
import { turnaround } from './overview.service.js';
import { type ReconOrder, dateKeys, findOrderMismatches, median } from './reconciliation.js';
import { resolveRange } from './reconciliation.service.js';

const NOW = new Date('2026-11-07T10:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

function order(over: Partial<ReconOrder>): ReconOrder {
  return {
    id: 'o1',
    publicRef: 'KGZ-TEST01',
    shopId: 's1',
    status: 'COLLECTED',
    rejectionCode: null,
    createdAt: hoursAgo(10),
    paidAt: hoursAgo(9),
    payments: [{ status: 'PAID', verifiedAt: hoursAgo(9), refunds: [] }],
    ...over,
  };
}
const types = (o: ReconOrder, stuck = 2) => findOrderMismatches(o, NOW, stuck).map((m) => m.type);

describe('reconciliation rules (P3.7, T20)', () => {
  it('clean lifecycles show no mismatches', () => {
    expect(types(order({}))).toEqual([]);
    expect(
      types(
        order({
          status: 'REFUNDED',
          rejectionCode: 'OTHER',
          payments: [
            {
              status: 'REFUNDED',
              verifiedAt: hoursAgo(9),
              refunds: [{ status: 'SUCCEEDED', amountPaise: 500 }],
            },
          ],
        }),
      ),
    ).toEqual([]);
    // Unpaid drafts and recent paid orders are fine.
    expect(types(order({ status: 'AWAITING_PAYMENT', paidAt: null, payments: [] }))).toEqual([]);
    expect(types(order({ status: 'PENDING_REVIEW', paidAt: hoursAgo(1) }))).toEqual([]);
  });

  it('flags paid orders without progress after N hours', () => {
    expect(types(order({ status: 'PENDING_REVIEW', paidAt: hoursAgo(3) }))).toEqual([
      'PAID_NO_PROGRESS',
    ]);
    expect(types(order({ status: 'PENDING_REVIEW', paidAt: hoursAgo(3) }), 4)).toEqual([]);
    // Payment verified but the order never left AWAITING_PAYMENT.
    expect(types(order({ status: 'AWAITING_PAYMENT', paidAt: null }))).toEqual([
      'PAID_NO_PROGRESS',
    ]);
  });

  it('flags rejected-without-refund and refund-without-rejection', () => {
    expect(types(order({ status: 'REJECTED', rejectionCode: 'OTHER' }))).toEqual([
      'REJECTED_WITHOUT_REFUND',
    ]);
    expect(
      types(
        order({
          status: 'COLLECTED',
          payments: [
            {
              status: 'PAID',
              verifiedAt: hoursAgo(9),
              refunds: [{ status: 'PENDING', amountPaise: 500 }],
            },
          ],
        }),
      ),
    ).toEqual(['REFUND_WITHOUT_REJECTION']);
  });

  it('flags refund outcome vs order/payment state disagreements', () => {
    expect(
      types(
        order({
          status: 'REFUNDED',
          rejectionCode: 'OTHER',
          payments: [
            {
              status: 'REFUNDED',
              verifiedAt: null,
              refunds: [{ status: 'FAILED', amountPaise: 1 }],
            },
          ],
        }),
      ),
    ).toEqual(['REFUND_STATUS_MISMATCH']);
    expect(
      types(
        order({
          status: 'REFUND_PENDING',
          rejectionCode: 'OTHER',
          payments: [
            {
              status: 'REFUNDED',
              verifiedAt: null,
              refunds: [{ status: 'SUCCEEDED', amountPaise: 1 }],
            },
          ],
        }),
      ),
    ).toEqual(['REFUND_STATUS_MISMATCH']);
    expect(
      types(
        order({
          status: 'REFUNDED',
          rejectionCode: 'OTHER',
          payments: [
            {
              status: 'REFUND_PENDING',
              verifiedAt: null,
              refunds: [{ status: 'SUCCEEDED', amountPaise: 1 }],
            },
          ],
        }),
      ),
    ).toEqual(['REFUND_STATUS_MISMATCH']);
  });
});

describe('dates, medians, ranges', () => {
  it('median handles odd/even/empty', () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('IST date keys and ranges', () => {
    expect(istDateKey(new Date('2026-11-06T18:30:00Z'))).toBe('2026-11-07');
    expect(istDayStart('2026-11-07').toISOString()).toBe('2026-11-06T18:30:00.000Z');
    expect(dateKeys('2026-10-30', '2026-11-02')).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-02',
    ]);
    const r = resolveRange({}, 7, NOW);
    expect(r).toMatchObject({ from: '2026-11-01', to: '2026-11-07' });
    expect(() => resolveRange({ from: '2026-11-07', to: '2026-11-01' }, 7, NOW)).toThrow();
  });

  it('turnaround medians in seconds', () => {
    const t = turnaround([
      { paidAt: hoursAgo(3), readyAt: hoursAgo(2), collectedAt: hoursAgo(1) },
      { paidAt: hoursAgo(3), readyAt: hoursAgo(1), collectedAt: null },
      { paidAt: null, readyAt: null, collectedAt: null },
    ]);
    expect(t).toEqual({
      paidToReadyMedianSeconds: 5400,
      readyToCollectedMedianSeconds: 3600,
      paidToReadySamples: 2,
      readyToCollectedSamples: 1,
    });
  });
});

describe('device health + version drift (P4.4)', () => {
  it('ONLINE ≤ threshold, STALE ≤ 5 min, else OFFLINE; revoked wins', () => {
    const at = (s: number) => ({
      status: 'ACTIVE',
      lastHeartbeatAt: new Date(NOW.getTime() - s * 1000),
    });
    expect(deviceHealth(at(10), 45, NOW)).toBe('ONLINE');
    expect(deviceHealth(at(46), 45, NOW)).toBe('STALE');
    expect(deviceHealth(at(301), 45, NOW)).toBe('OFFLINE');
    expect(deviceHealth({ status: 'ACTIVE', lastHeartbeatAt: null }, 45, NOW)).toBe('OFFLINE');
    expect(deviceHealth({ ...at(1), status: 'REVOKED' }, 45, NOW)).toBe('REVOKED');
  });

  it('compares dotted versions numerically', () => {
    expect(compareVersions('0.10.0', '0.9.3')).toBe(1);
    expect(compareVersions('1.2', '1.2.0')).toBe(0);
    expect(compareVersions('0.2.9', '0.3.0')).toBe(-1);
    expect(hasVersionDrift('0.2.9', '0.3.0')).toBe(true);
    expect(hasVersionDrift(null, '0.3.0')).toBe(true);
    expect(hasVersionDrift('0.3.0', '0.3.0')).toBe(false);
    expect(hasVersionDrift(null, undefined)).toBe(false);
  });
});
