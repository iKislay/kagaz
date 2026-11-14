import { describe, expect, it } from 'vitest';
import {
  type AutoAcceptOrder,
  AutoAcceptPolicy,
  type AutoAcceptPrinter,
  AutoAcceptReason,
  type AutoAcceptShop,
} from './auto-accept.policy.js';

const now = new Date('2026-11-07T06:30:00Z'); // Saturday 12:00 IST
const ctx = { now, onlineThresholdSeconds: 45 };
const shop: AutoAcceptShop = {
  status: 'OPEN',
  approvalMode: 'AUTO',
  autoPaused: false,
  autoLimits: { maxPages: 50, maxCopies: 5, maxSides: 250, maxQueueDepth: 10 },
};
const printer: AutoAcceptPrinter = {
  id: 'p1',
  enabled: true,
  capabilitiesConfirmed: true,
  colourCapable: true,
  duplexCapable: true,
  paperSizes: ['A4'],
  isDefault: true,
  status: 'READY',
  deviceLastHeartbeatAt: new Date(now.getTime() - 10_000),
};
const order: AutoAcceptOrder = {
  options: { colour: false, duplex: false, paperSize: 'A4', copies: 2 },
  pageCount: 10,
  printedSides: 20,
  fileValid: true,
};
const noQueue = { depthByPrinter: {} };

const evaluate = (
  o: Partial<AutoAcceptOrder> = {},
  s: Partial<AutoAcceptShop> = {},
  printers: AutoAcceptPrinter[] = [printer],
  queue = noQueue,
) => AutoAcceptPolicy.evaluate({ ...order, ...o }, { ...shop, ...s }, printers, queue, ctx);

describe('AutoAcceptPolicy.evaluate (PRD §8.4)', () => {
  it('eligible when every precondition holds; picks the printer', () => {
    expect(evaluate()).toEqual({ eligible: true, reasons: [], printerId: 'p1' });
  });

  describe('1. shop open, in hours, not maintenance', () => {
    it('closed shop', () => {
      expect(evaluate({}, { status: 'CLOSED' }).reasons).toEqual([AutoAcceptReason.SHOP_NOT_OPEN]);
    });
    it('maintenance', () => {
      expect(evaluate({}, { status: 'MAINTENANCE' }).reasons).toEqual([
        AutoAcceptReason.SHOP_MAINTENANCE,
      ]);
    });
  });

  describe('2. mode AUTO and not paused', () => {
    it('manual mode', () => {
      expect(evaluate({}, { approvalMode: 'MANUAL' }).reasons).toEqual([
        AutoAcceptReason.MANUAL_MODE,
      ]);
    });
    it('pay-at-counter orders always wait for the shop (ADR-003)', () => {
      expect(evaluate({ payAtCounter: true }).reasons).toEqual([AutoAcceptReason.PAY_AT_COUNTER]);
    });
    it('auto paused behaves as manual', () => {
      expect(evaluate({}, { autoPaused: true }).reasons).toEqual([AutoAcceptReason.AUTO_PAUSED]);
    });
  });

  describe('3. capable, confirmed, enabled printer', () => {
    it('no printer at all / only disabled printers', () => {
      expect(evaluate({}, {}, []).reasons).toEqual([AutoAcceptReason.NO_PRINTER]);
      expect(evaluate({}, {}, [{ ...printer, enabled: false }]).reasons).toEqual([
        AutoAcceptReason.NO_PRINTER,
      ]);
    });
    it('capabilities not confirmed by the operator', () => {
      expect(evaluate({}, {}, [{ ...printer, capabilitiesConfirmed: false }]).reasons).toEqual([
        AutoAcceptReason.CAPABILITIES_NOT_CONFIRMED,
      ]);
    });
    it('unsupported colour', () => {
      const r = evaluate({ options: { ...order.options, colour: true } }, {}, [
        { ...printer, colourCapable: false },
      ]);
      expect(r.reasons).toEqual([AutoAcceptReason.UNSUPPORTED_COLOUR]);
    });
    it('unsupported duplex', () => {
      const r = evaluate({ options: { ...order.options, duplex: true } }, {}, [
        { ...printer, duplexCapable: false },
      ]);
      expect(r.reasons).toEqual([AutoAcceptReason.UNSUPPORTED_DUPLEX]);
    });
    it('unsupported paper', () => {
      expect(evaluate({}, {}, [{ ...printer, paperSizes: ['Letter'] }]).reasons).toEqual([
        AutoAcceptReason.UNSUPPORTED_PAPER,
      ]);
    });
  });

  describe('4. printer online', () => {
    it('stale device heartbeat (> 45 s)', () => {
      const stale = { ...printer, deviceLastHeartbeatAt: new Date(now.getTime() - 46_000) };
      expect(evaluate({}, {}, [stale]).reasons).toEqual([AutoAcceptReason.PRINTER_OFFLINE]);
    });
    it('never heartbeated', () => {
      expect(evaluate({}, {}, [{ ...printer, deviceLastHeartbeatAt: null }]).reasons).toEqual([
        AutoAcceptReason.PRINTER_OFFLINE,
      ]);
    });
    it('printer status not READY (offline, paper out, error, unknown)', () => {
      for (const status of ['OFFLINE', 'PAPER_OUT', 'ERROR', 'UNKNOWN']) {
        expect(evaluate({}, {}, [{ ...printer, status }]).reasons).toEqual([
          AutoAcceptReason.PRINTER_OFFLINE,
        ]);
      }
    });
    it('falls back to another online capable printer', () => {
      const offline = { ...printer, id: 'p0', status: 'OFFLINE' };
      expect(evaluate({}, {}, [offline, { ...printer, isDefault: false }])).toMatchObject({
        eligible: true,
        printerId: 'p1',
      });
    });
  });

  describe('5. file validated and within limits', () => {
    it('file not validated', () => {
      expect(evaluate({ fileValid: false, pageCount: null }).reasons).toEqual([
        AutoAcceptReason.FILE_NOT_VALIDATED,
      ]);
    });
    it('too many pages', () => {
      expect(evaluate({ pageCount: 51 }).reasons).toEqual([AutoAcceptReason.TOO_MANY_PAGES]);
    });
    it('too many copies', () => {
      expect(
        evaluate({ options: { ...order.options, copies: 6 }, printedSides: 60 }).reasons,
      ).toEqual([AutoAcceptReason.TOO_MANY_COPIES]);
    });
    it('too many printed sides', () => {
      expect(evaluate({ printedSides: 251 }).reasons).toEqual([AutoAcceptReason.TOO_MANY_SIDES]);
    });
    it('exactly at the limits is allowed; missing limits use D10 defaults', () => {
      expect(
        evaluate({ pageCount: 50, printedSides: 250, options: { ...order.options, copies: 5 } })
          .eligible,
      ).toBe(true);
      expect(evaluate({ pageCount: 51 }, { autoLimits: {} }).reasons).toEqual([
        AutoAcceptReason.TOO_MANY_PAGES,
      ]);
    });
  });

  describe('6. printer queue depth', () => {
    it('queue full', () => {
      expect(evaluate({}, {}, [printer], { depthByPrinter: { p1: 10 } }).reasons).toEqual([
        AutoAcceptReason.QUEUE_FULL,
      ]);
    });
    it('prefers the shortest queue, then the default printer', () => {
      const a = { ...printer, id: 'a', isDefault: true };
      const b = { ...printer, id: 'b', isDefault: false };
      expect(evaluate({}, {}, [a, b], { depthByPrinter: { a: 3, b: 1 } }).printerId).toBe('b');
      expect(evaluate({}, {}, [b, a], { depthByPrinter: {} }).printerId).toBe('a');
    });
  });

  it('reports every failing precondition', () => {
    const r = evaluate({ pageCount: 99 }, { approvalMode: 'MANUAL', status: 'CLOSED' }, []);
    expect(r.eligible).toBe(false);
    expect(r.reasons).toEqual([
      AutoAcceptReason.SHOP_NOT_OPEN,
      AutoAcceptReason.MANUAL_MODE,
      AutoAcceptReason.TOO_MANY_PAGES,
      AutoAcceptReason.NO_PRINTER,
    ]);
    expect(r.printerId).toBeNull();
  });
});
