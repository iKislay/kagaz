/**
 * Page-range parsing for print options, e.g. "1-3, 5, 8-10".
 * Returns 1-based page numbers, ascending, de-duplicated.
 * An empty/blank range means "all pages".
 */

export class PageRangeError extends Error {
  override name = 'PageRangeError';
}

const SEGMENT = /^(\d+)(?:\s*-\s*(\d+))?$/;

export function parsePageRange(input: string | null | undefined, pageCount: number): number[] {
  if (!Number.isSafeInteger(pageCount) || pageCount < 1) {
    throw new PageRangeError(`pageCount must be a positive integer, got ${pageCount}`);
  }

  const trimmed = (input ?? '').trim();
  if (trimmed === '') {
    return Array.from({ length: pageCount }, (_, i) => i + 1);
  }

  const pages = new Set<number>();
  for (const rawSegment of trimmed.split(',')) {
    const segment = rawSegment.trim();
    if (segment === '') {
      throw new PageRangeError(`Empty segment in page range "${input}"`);
    }
    const match = SEGMENT.exec(segment);
    if (!match) {
      throw new PageRangeError(`Invalid page range segment "${segment}"`);
    }
    const start = Number(match[1]);
    const end = match[2] === undefined ? start : Number(match[2]);
    if (start < 1 || end < 1) {
      throw new PageRangeError(`Pages start at 1 ("${segment}")`);
    }
    if (start > end) {
      throw new PageRangeError(`Range "${segment}" is reversed`);
    }
    if (end > pageCount) {
      throw new PageRangeError(`Page ${end} is beyond the document's ${pageCount} pages`);
    }
    for (let p = start; p <= end; p++) pages.add(p);
  }

  return [...pages].sort((a, b) => a - b);
}

/** Inverse of {@link parsePageRange}: [5, 1, 2, 3, 3] → "1-3, 5". An empty list gives "". */
export function formatPageRange(pages: Iterable<number>): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  const segments: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i]!;
    while (i + 1 < sorted.length && sorted[i + 1] === sorted[i]! + 1) i++;
    segments.push(sorted[i] === start ? `${start}` : `${start}-${sorted[i]}`);
  }
  return segments.join(', ');
}

export interface PageSelection {
  /** Pages to print, 1-based ascending. */
  selected: number[];
  /** The selected pages printed in colour; every other selected page prints black & white. */
  colour: ReadonlySet<number>;
}

/**
 * Which pages print, and which of them in colour. A colour order without `colourPages` prints
 * every selected page in colour; a B/W order prints none. `colourPages` may only name selected
 * pages. Throws PageRangeError on an invalid range.
 */
export function resolvePageSelection(
  options: { pageRange?: string | undefined; colour: boolean; colourPages?: string | undefined },
  pageCount: number,
): PageSelection {
  const selected = parsePageRange(options.pageRange, pageCount);
  if (!options.colour) return { selected, colour: new Set() };
  if (!options.colourPages?.trim()) return { selected, colour: new Set(selected) };

  const chosen = new Set(selected);
  const colour = parsePageRange(options.colourPages, pageCount);
  const stray = colour.find((p) => !chosen.has(p));
  if (stray !== undefined) {
    throw new PageRangeError(`Colour page ${stray} is not one of the pages to print`);
  }
  return { selected, colour: new Set(colour) };
}
