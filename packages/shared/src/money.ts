/**
 * Money helpers. All amounts in Kaggaz are integer paise (1 INR = 100 paise). No floats.
 */

export class MoneyError extends Error {
  override name = 'MoneyError';
}

/** Throws unless value is a non-negative safe integer number of paise. */
export function assertPaise(value: number, label = 'amount'): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new MoneyError(`${label} must be a non-negative integer number of paise, got ${value}`);
  }
  return value;
}

/** Multiply integer paise by an integer count, guarding against overflow and floats. */
export function multiplyPaise(paise: number, count: number): number {
  assertPaise(paise, 'paise');
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new MoneyError(`count must be a non-negative integer, got ${count}`);
  }
  const result = paise * count;
  if (!Number.isSafeInteger(result)) {
    throw new MoneyError('amount overflow');
  }
  return result;
}

const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Format paise for display, e.g. 12345 -> "₹123.45". Display only; never parse this back. */
export function formatPaise(paise: number): string {
  assertPaise(paise);
  return inrFormatter.format(paise / 100);
}
