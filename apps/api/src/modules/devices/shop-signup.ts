import { randomCode } from '../../common/crypto/tokens.js';

/** "Raju Xerox & Prints!" → "raju-xerox-prints-k7m2": lowercase, dashes, ≤ 45 chars, unique-ish. */
export function signupSlug(name: string, suffix = randomCode(4).toLowerCase()): string {
  const base =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/, '') || 'shop';
  return `${base}-${suffix}`;
}

/** Pricing a self-registered shop starts with (seed defaults): B/W ₹2, colour ₹10, minimum ₹5. */
export const SIGNUP_PRICING = {
  monoRatePaise: 200,
  colourRatePaise: 1000,
  minimumChargePaise: 500,
} as const;
