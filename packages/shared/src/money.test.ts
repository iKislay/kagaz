import { describe, expect, it } from 'vitest';
import { MoneyError, assertPaise, formatPaise, multiplyPaise } from './money.js';

describe('money helpers', () => {
  it('accepts non-negative integer paise', () => {
    expect(assertPaise(0)).toBe(0);
    expect(assertPaise(12345)).toBe(12345);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects %s',
    (value) => {
      expect(() => assertPaise(value)).toThrow(MoneyError);
    },
  );

  it('multiplies paise by integer counts', () => {
    expect(multiplyPaise(200, 24)).toBe(4800);
    expect(() => multiplyPaise(200, 1.5)).toThrow(MoneyError);
    expect(() => multiplyPaise(Number.MAX_SAFE_INTEGER, 2)).toThrow('overflow');
  });

  it('formats paise as INR', () => {
    expect(formatPaise(12345)).toBe('₹123.45');
    expect(formatPaise(500)).toBe('₹5.00');
    expect(formatPaise(10000000)).toBe('₹1,00,000.00');
  });
});
