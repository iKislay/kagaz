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
