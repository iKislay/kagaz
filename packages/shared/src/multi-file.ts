/**
 * Multi-file orders (ADR-005): the files of an order print as ONE combined document, in their
 * print order. Page ranges, the price and the print packet all count pages of that document.
 */

/** Total pages of the combined document. */
export function totalPageCount(files: readonly { pageCount: number }[]): number {
  let total = 0;
  for (const f of files) {
    if (!Number.isInteger(f.pageCount) || f.pageCount < 1) {
      throw new RangeError('Every file must have at least one page');
    }
    total += f.pageCount;
  }
  return total;
}

/**
 * Adds `firstPage` (1-based, in the combined document) to each file, keeping the given order.
 * e.g. [3 pages, 1 page, 2 pages] → firstPage 1, 4, 5.
 */
export function withFirstPages<T extends { pageCount: number }>(
  files: readonly T[],
): Array<T & { firstPage: number }> {
  let next = 1;
  return files.map((f) => {
    const firstPage = next;
    next += f.pageCount;
    return { ...f, firstPage };
  });
}

/**
 * Print order: files sorted by `position`, ties (and files without one) by creation time.
 * Pure so the API, the packet and the customer view can't disagree.
 */
export function sortByPosition<T extends { position: number | null; createdAt: Date | string }>(
  files: readonly T[],
): T[] {
  const time = (v: Date | string) => (typeof v === 'string' ? Date.parse(v) : v.getTime());
  return [...files].sort(
    (a, b) =>
      (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER) ||
      time(a.createdAt) - time(b.createdAt),
  );
}

/**
 * New positions after the customer reorders: `requested` ids first (in that order, unknown or
 * repeated ids ignored), then every other file in its current order. Returns id → position.
 */
export function reorderPositions(
  current: readonly string[],
  requested: readonly string[],
): Map<string, number> {
  const known = new Set(current);
  const order: string[] = [];
  for (const id of requested) if (known.has(id) && !order.includes(id)) order.push(id);
  for (const id of current) if (!order.includes(id)) order.push(id);
  return new Map(order.map((id, i) => [id, i]));
}
