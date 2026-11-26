import {
  DuplexRule,
  type PrintOptions,
  type Quote,
  assertPaise,
  multiplyPaise,
  resolvePageSelection,
} from '@kagaz/shared';

/** The subset of a ShopPricing row the formula needs (all money in paise per printed side). */
export interface PricingRates {
  id: string;
  monoRatePaise: number;
  colourRatePaise: number;
  monoDuplexRatePaise: number | null;
  colourDuplexRatePaise: number | null;
  duplexRule: DuplexRule;
  minimumChargePaise: number;
}

/**
 * Server-side price calculation — docs/PRD.md §8.2. Pure function, integer paise only.
 *
 *   selectedPages = pages in range
 *   printedSides  = selectedPages × copies          (slip + blank spacers are never charged)
 *   rate          = per-side rate for colour/mono (duplex rate when DISCOUNTED_SIDE_RATE)
 *   subtotal      = colour sides × colour rate + B/W sides × B/W rate
 *   total         = max(subtotal, minimumCharge)
 *
 * Throws PageRangeError for an invalid range and MoneyError on bad rates/overflow.
 */
export function calculateQuote(
  rates: PricingRates,
  options: Pick<PrintOptions, 'pageRange' | 'copies' | 'colour' | 'colourPages' | 'duplex'>,
  pageCount: number,
): Quote {
  const { selected, colour } = resolvePageSelection(options, pageCount);
  const selectedPages = selected.length;
  const copies = options.copies;
  if (!Number.isSafeInteger(copies) || copies < 1) {
    throw new RangeError(`copies must be a positive integer, got ${copies}`);
  }

  const printedSides = selectedPages * copies;
  // Duplex: each copy starts on a fresh sheet (spacer pages), so sheets are counted per copy.
  const sheets = options.duplex ? Math.ceil(selectedPages / 2) * copies : printedSides;

  const mixed = colour.size > 0 && colour.size < selectedPages;
  // A mixed order quotes its B/W rate as `ratePaise` and breaks the colour sides out.
  const ratePaise = assertPaise(pickRate(rates, colour.size > 0 && !mixed, options.duplex), 'rate');
  const mixedColour = mixed
    ? {
        colourSides: colour.size * copies,
        colourRatePaise: assertPaise(pickRate(rates, true, options.duplex), 'colour rate'),
      }
    : undefined;
  const subtotalPaise = mixedColour
    ? assertPaise(
        multiplyPaise(mixedColour.colourRatePaise, mixedColour.colourSides) +
          multiplyPaise(ratePaise, printedSides - mixedColour.colourSides),
        'subtotal',
      )
    : multiplyPaise(ratePaise, printedSides);
  const minimum = assertPaise(rates.minimumChargePaise, 'minimumChargePaise');
  const minimumChargeApplied = subtotalPaise < minimum;

  return {
    selectedPages,
    copies,
    printedSides,
    sheets,
    ratePaise,
    ...(mixedColour ? { mixedColour } : {}),
    subtotalPaise,
    minimumChargeApplied,
    totalPaise: minimumChargeApplied ? minimum : subtotalPaise,
    pricingId: rates.id,
  };
}

function pickRate(rates: PricingRates, colour: boolean, duplex: boolean): number {
  if (duplex && rates.duplexRule === DuplexRule.DISCOUNTED_SIDE_RATE) {
    const discounted = colour ? rates.colourDuplexRatePaise : rates.monoDuplexRatePaise;
    if (discounted !== null) return discounted;
  }
  return colour ? rates.colourRatePaise : rates.monoRatePaise;
}
