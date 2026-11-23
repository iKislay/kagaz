import { describe, expect, it } from 'vitest';
import { reorderPositions, sortByPosition, totalPageCount, withFirstPages } from './multi-file.js';
import { parsePageRange } from './page-range.js';

describe('multi-file page math (ADR-005)', () => {
  it('totals the pages of all files', () => {
    expect(totalPageCount([{ pageCount: 3 }, { pageCount: 1 }, { pageCount: 2 }])).toBe(6);
    expect(totalPageCount([])).toBe(0);
  });

  it('rejects a file without pages', () => {
    expect(() => totalPageCount([{ pageCount: 2 }, { pageCount: 0 }])).toThrow(RangeError);
  });

  it('numbers each file’s first page in the combined document', () => {
    const files = withFirstPages([
      { id: 'a', pageCount: 3 },
      { id: 'b', pageCount: 1 },
      { id: 'c', pageCount: 2 },
    ]);
    expect(files.map((f) => [f.id, f.firstPage])).toEqual([
      ['a', 1],
      ['b', 4],
      ['c', 5],
    ]);
  });

  it('a page range spans files: "3-4" = last page of the PDF + the photo', () => {
    const files = withFirstPages([{ pageCount: 3 }, { pageCount: 1 }, { pageCount: 2 }]);
    const total = totalPageCount(files);
    expect(parsePageRange('3-4', total)).toEqual([3, 4]);
    expect(() => parsePageRange('7', total)).toThrow();
    expect(files[1]!.firstPage).toBe(4);
  });

  it('sorts by position, then creation time', () => {
    const t = (s: number) => new Date(2026, 0, 1, 0, 0, s);
    const sorted = sortByPosition([
      { id: 'late', position: 1, createdAt: t(1) },
      { id: 'none', position: null, createdAt: t(0) },
      { id: 'first', position: 0, createdAt: t(5) },
      { id: 'tie', position: 1, createdAt: t(0) },
    ]);
    expect(sorted.map((f) => f.id)).toEqual(['first', 'tie', 'late', 'none']);
  });

  it('reorder puts requested ids first and keeps the rest in order', () => {
    const pos = reorderPositions(['a', 'b', 'c', 'd'], ['c', 'a', 'zzz', 'c']);
    expect([...pos.entries()]).toEqual([
      ['c', 0],
      ['a', 1],
      ['b', 2],
      ['d', 3],
    ]);
  });
});
