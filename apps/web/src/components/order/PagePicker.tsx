'use client';

import { type PagePick } from '@kagaz/shared';
import { cx } from '@/components/ui';

export interface PreviewPage extends PagePick {
  /** Thumbnail data URL; null while it is still rendering. */
  thumb: string | null;
}

/**
 * The document as page thumbnails. Tap a page to skip or include it; with colour available,
 * each page has its own Colour | B/W switch, and B/W pages preview in greyscale.
 * `readOnly` shows the printed pages only, for the review step.
 */
export function PagePicker({
  pages,
  colourAvailable,
  readOnly = false,
  onTogglePrint,
  onToggleColour,
}: {
  pages: PreviewPage[];
  colourAvailable: boolean;
  readOnly?: boolean;
  onTogglePrint?: (index: number) => void;
  onToggleColour?: (index: number) => void;
}) {
  const shown = pages.flatMap((page, index) => (readOnly && !page.print ? [] : [{ page, index }]));
  return (
    <ul className="grid grid-cols-3 gap-3 p-4 sm:grid-cols-4">
      {shown.map(({ page, index }) => {
        const n = index + 1;
        return (
          <li key={index} className="min-w-0">
            <button
              type="button"
              disabled={readOnly}
              aria-pressed={readOnly ? undefined : page.print}
              aria-label={`Page ${n}: ${page.print ? 'will print' : 'skipped'}`}
              onClick={() => onTogglePrint?.(index)}
              className={cx(
                'relative block aspect-[1/1.414] w-full overflow-hidden rounded-lg border border-separator bg-surface shadow-sm transition',
                !readOnly && 'focus-visible:outline-2 focus-visible:outline-accent',
                !page.print && 'opacity-40',
              )}
            >
              {page.thumb ? (
                <img
                  src={page.thumb}
                  alt=""
                  className={cx('size-full object-contain', !page.colour && 'grayscale')}
                />
              ) : (
                <span className="block size-full animate-pulse bg-selection" />
              )}
              {!readOnly && (
                <span
                  aria-hidden
                  className={cx(
                    'absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full border text-[11px] font-bold',
                    page.print
                      ? 'border-accent bg-accent text-white'
                      : 'border-separator bg-surface text-transparent',
                  )}
                >
                  ✓
                </span>
              )}
            </button>
            <div className="mt-1 flex items-center justify-between gap-1">
              <span className="text-[12px] tabular-nums text-text-secondary">{n}</span>
              {colourAvailable && page.print && (
                <button
                  type="button"
                  disabled={readOnly}
                  aria-label={`Page ${n}: print in ${page.colour ? 'black & white' : 'colour'}`}
                  onClick={() => onToggleColour?.(index)}
                  className={cx(
                    'rounded-full px-2 py-0.5 text-[11px] font-semibold',
                    page.colour ? 'bg-accent/10 text-accent' : 'bg-selection text-text-secondary',
                    !readOnly && 'hover:opacity-80',
                  )}
                >
                  {page.colour ? 'Colour' : 'B/W'}
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
