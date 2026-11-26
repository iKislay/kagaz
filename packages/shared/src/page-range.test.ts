import { describe, expect, it } from 'vitest';
import {
  PageRangeError,
  formatPageRange,
  parsePageRange,
  resolvePageSelection,
} from './page-range.js';

describe('parsePageRange', () => {
  it('treats empty, blank, null and undefined as all pages', () => {
    expect(parsePageRange('', 3)).toEqual([1, 2, 3]);
    expect(parsePageRange('   ', 3)).toEqual([1, 2, 3]);
    expect(parsePageRange(null, 2)).toEqual([1, 2]);
    expect(parsePageRange(undefined, 1)).toEqual([1]);
  });

  it('parses single pages and ranges', () => {
    expect(parsePageRange('1-3,5,8-10', 12)).toEqual([1, 2, 3, 5, 8, 9, 10]);
  });

  it('tolerates whitespace', () => {
    expect(parsePageRange(' 1 - 2 ,  4 ', 5)).toEqual([1, 2, 4]);
  });

  it('de-duplicates overlaps and sorts', () => {
    expect(parsePageRange('5,1-3,2-4', 6)).toEqual([1, 2, 3, 4, 5]);
  });

  it('accepts a range ending on the last page', () => {
    expect(parsePageRange('2-4', 4)).toEqual([2, 3, 4]);
  });

  it.each([
    ['3-1', 'reversed'],
    ['0', 'start at 1'],
    ['0-2', 'start at 1'],
    ['1-6', 'beyond'],
    ['7', 'beyond'],
    ['1,,2', 'Empty segment'],
    ['1,', 'Empty segment'],
    ['a-b', 'Invalid'],
    ['1-2-3', 'Invalid'],
    ['-2', 'Invalid'],
    ['1.5', 'Invalid'],
  ])('rejects %s', (input, message) => {
    expect(() => parsePageRange(input, 5)).toThrow(PageRangeError);
    expect(() => parsePageRange(input, 5)).toThrow(message);
  });

  it('rejects an invalid page count', () => {
    expect(() => parsePageRange('1', 0)).toThrow(PageRangeError);
    expect(() => parsePageRange('1', 1.5)).toThrow(PageRangeError);
  });
});

describe('formatPageRange', () => {
  it('compacts runs and round-trips through parsePageRange', () => {
    expect(formatPageRange([5, 1, 2, 3, 3, 8, 9])).toBe('1-3, 5, 8-9');
    expect(parsePageRange(formatPageRange([1, 2, 4, 7, 8, 9]), 9)).toEqual([1, 2, 4, 7, 8, 9]);
  });

  it('gives an empty string for no pages', () => {
    expect(formatPageRange([])).toBe('');
  });
});

describe('resolvePageSelection', () => {
  it('prints nothing in colour for a B/W order', () => {
    const s = resolvePageSelection({ pageRange: '1-3', colour: false }, 5);
    expect(s.selected).toEqual([1, 2, 3]);
    expect([...s.colour]).toEqual([]);
  });

  it('prints every selected page in colour without colourPages', () => {
    const s = resolvePageSelection({ pageRange: '2,4', colour: true, colourPages: ' ' }, 5);
    expect([...s.colour]).toEqual([2, 4]);
  });

  it('prints only colourPages in colour', () => {
    const s = resolvePageSelection({ colour: true, colourPages: '1, 3' }, 4);
    expect(s.selected).toEqual([1, 2, 3, 4]);
    expect([...s.colour]).toEqual([1, 3]);
  });

  it('rejects a colour page that is not printed', () => {
    expect(() =>
      resolvePageSelection({ pageRange: '1-2', colour: true, colourPages: '3' }, 4),
    ).toThrow(PageRangeError);
  });
});
