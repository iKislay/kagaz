import { describe, expect, it } from 'vitest';
import { MoneyError, PageRangeError } from '@kagaz/shared';
import { type PricingRates, calculateQuote } from './quote.js';

const rates: PricingRates = {
  id: 'pricing-1',
  monoRatePaise: 200, // ₹2 per side
  colourRatePaise: 1000, // ₹10 per side
  monoDuplexRatePaise: 150,
  colourDuplexRatePaise: 800,
  duplexRule: 'SAME_AS_SIMPLEX',
  minimumChargePaise: 500, // ₹5
};
const opts = { copies: 1, colour: false, duplex: false };

describe('calculateQuote (T03)', () => {
  it('charges mono per printed side across copies', () => {
    expect(calculateQuote(rates, { ...opts, copies: 2 }, 12)).toEqual({
      selectedPages: 12,
      copies: 2,
      printedSides: 24,
      sheets: 24,
      ratePaise: 200,
      subtotalPaise: 4800,
      minimumChargeApplied: false,
      totalPaise: 4800,
      pricingId: 'pricing-1',
    });
  });

  it('uses the colour rate', () => {
    const q = calculateQuote(rates, { ...opts, colour: true }, 3);
    expect(q.ratePaise).toBe(1000);
    expect(q.totalPaise).toBe(3000);
  });

  it('respects the page range', () => {
    const q = calculateQuote(rates, { ...opts, pageRange: '1-3,5', copies: 3 }, 10);
    expect(q.selectedPages).toBe(4);
    expect(q.printedSides).toBe(12);
    expect(q.totalPaise).toBe(2400);
  });

  it('applies the minimum charge', () => {
    const q = calculateQuote(rates, opts, 1);
    expect(q.subtotalPaise).toBe(200);
    expect(q.minimumChargeApplied).toBe(true);
    expect(q.totalPaise).toBe(500);
  });

  it('does not flag the minimum when subtotal equals it', () => {
    const q = calculateQuote({ ...rates, minimumChargePaise: 600 }, opts, 3);
    expect(q.minimumChargeApplied).toBe(false);
    expect(q.totalPaise).toBe(600);
  });

  it('duplex with SAME_AS_SIMPLEX charges the simplex rate and counts sheets per copy', () => {
    const q = calculateQuote(rates, { ...opts, duplex: true, copies: 2 }, 5);
    expect(q.ratePaise).toBe(200);
    expect(q.printedSides).toBe(10);
    expect(q.sheets).toBe(6); // ceil(5/2)=3 sheets per copy × 2
    expect(q.totalPaise).toBe(2000);
  });

  it('duplex with DISCOUNTED_SIDE_RATE uses the duplex rates', () => {
    const discounted = { ...rates, duplexRule: 'DISCOUNTED_SIDE_RATE' as const };
    expect(calculateQuote(discounted, { ...opts, duplex: true }, 4).ratePaise).toBe(150);
    expect(calculateQuote(discounted, { ...opts, duplex: true, colour: true }, 4).ratePaise).toBe(
      800,
    );
    // Simplex orders ignore the duplex rate.
    expect(calculateQuote(discounted, opts, 4).ratePaise).toBe(200);
  });

  it('falls back to the simplex rate when a discounted rate is missing', () => {
    const partial = {
      ...rates,
      duplexRule: 'DISCOUNTED_SIDE_RATE' as const,
      monoDuplexRatePaise: null,
    };
    expect(calculateQuote(partial, { ...opts, duplex: true }, 2).ratePaise).toBe(200);
  });

  it('rejects invalid input', () => {
    expect(() => calculateQuote(rates, { ...opts, pageRange: '9' }, 3)).toThrow(PageRangeError);
    expect(() => calculateQuote(rates, { ...opts, copies: 0 }, 3)).toThrow(RangeError);
    expect(() => calculateQuote({ ...rates, monoRatePaise: 1.5 }, opts, 3)).toThrow(MoneyError);
    expect(() => calculateQuote({ ...rates, minimumChargePaise: -1 }, opts, 3)).toThrow(MoneyError);
  });

  it('only ever produces integer paise', () => {
    for (let pages = 1; pages <= 9; pages++) {
      for (const duplex of [false, true]) {
        const q = calculateQuote(rates, { ...opts, duplex, copies: 3 }, pages);
        expect(Number.isInteger(q.totalPaise)).toBe(true);
        expect(Number.isInteger(q.sheets)).toBe(true);
      }
    }
  });
});
