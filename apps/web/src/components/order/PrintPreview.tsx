'use client';

import type { PDFDocumentProxy } from 'pdfjs-dist';
import { useEffect, useMemo, useRef, useState } from 'react';
import { type PublicOrder, parsePageRange } from '@kagaz/shared';
import { Spinner, cx } from '@/components/ui';
import { fetchFilePdf } from '@/lib/api';
import { type OpenPdf, openPdf, renderPage } from '@/lib/pdf-render';

interface PageRef {
  /** 1-based page number in the combined document. */
  n: number;
  doc: PDFDocumentProxy;
  /** Page number inside its own file. */
  page: number;
  fileIndex: number;
}

/**
 * Print preview: every page of the combined document, in print order, rendered from the files
 * the API stored (a photo shows as the A4 page the shop will print). Pages outside the page
 * range are dimmed. The page count and price shown elsewhere come from the API's quote.
 */
export function PrintPreview({ order, token }: { order: PublicOrder; token: string }) {
  const [pages, setPages] = useState<PageRef[] | null>(null);
  const [failed, setFailed] = useState(false);
  const fileKey = order.files.map((f) => f.id).join(',');

  useEffect(() => {
    let cancelled = false;
    const docs: OpenPdf[] = [];
    setPages(null);
    setFailed(false);
    (async () => {
      const refs: PageRef[] = [];
      for (const [fileIndex, file] of order.files.entries()) {
        const pdf = await openPdf(await fetchFilePdf(order.id, file.id, token));
        docs.push(pdf);
        if (cancelled) return;
        const doc = pdf.doc;
        for (let p = 1; p <= doc.numPages; p++) {
          refs.push({ n: file.firstPage + p - 1, doc, page: p, fileIndex });
        }
      }
      if (!cancelled) setPages(refs);
    })().catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      for (const d of docs) void d.close();
    };
    // Re-render only when the set/order of files changes (fileKey), not on every order update.
  }, [order.id, fileKey, token]);

  const total = order.file?.pageCount ?? 0;
  const selected = useMemo(() => {
    try {
      return new Set(parsePageRange(order.options.pageRange, total));
    } catch {
      return new Set<number>();
    }
  }, [order.options.pageRange, total]);
  const quote = order.quote;

  return (
    <section className="mt-6">
      <div className="mb-1.5 flex items-baseline justify-between px-4">
        <h2 className="text-[12px] font-semibold uppercase tracking-wide text-text-secondary">
          Print preview
        </h2>
        {quote && (
          <span className="text-[12px] text-text-secondary">
            {quote.selectedPages} of {total} page{total === 1 ? '' : 's'} × {quote.copies} cop
            {quote.copies === 1 ? 'y' : 'ies'}
          </span>
        )}
      </div>
      <div className="mac-card max-h-[460px] overflow-y-auto p-3">
        {failed ? (
          <p className="px-2 py-6 text-center text-[14px] text-text-secondary">
            The preview couldn’t be loaded. Your files are fine; you can still place the order.
          </p>
        ) : !pages ? (
          <div className="flex items-center justify-center gap-2 py-10 text-[14px] text-text-secondary">
            <Spinner /> Preparing preview…
          </div>
        ) : (
          <ol className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5" aria-label="Pages">
            {pages.map((p) => (
              <PageThumb
                key={p.n}
                pageRef={p}
                printed={selected.has(p.n)}
                fileStart={p.page === 1 && order.files.length > 1}
              />
            ))}
          </ol>
        )}
      </div>
      {order.options.pageRange && (
        <p className="mt-1.5 px-4 text-[12px] text-text-secondary">
          Dimmed pages are outside your page range ({order.options.pageRange}) and won’t print.
        </p>
      )}
    </section>
  );
}

/** One page, rendered when it scrolls into view. */
function PageThumb({
  pageRef,
  printed,
  fileStart,
}: {
  pageRef: PageRef;
  printed: boolean;
  fileStart: boolean;
}) {
  const el = useRef<HTMLLIElement>(null);
  const [img, setImg] = useState<{ url: string; landscape: boolean } | null>(null);

  useEffect(() => {
    const node = el.current;
    if (!node) return;
    let url: string | null = null;
    let done = false;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting || done) return;
        done = true;
        io.disconnect();
        renderPage(pageRef.doc, pageRef.page, 140)
          .then((r) => {
            url = r.url;
            setImg(r);
          })
          .catch(() => undefined);
      },
      { rootMargin: '200px' },
    );
    io.observe(node);
    return () => {
      io.disconnect();
      if (url) URL.revokeObjectURL(url);
    };
  }, [pageRef]);

  return (
    <li ref={el} className="flex flex-col items-center">
      <div
        className={cx(
          'relative grid w-full place-items-center rounded-md bg-bg',
          img?.landscape ? 'aspect-[4/3]' : 'aspect-[3/4]',
          !printed && 'opacity-35',
        )}
      >
        {img ? (
          <img
            src={img.url}
            alt={`Page ${pageRef.n}`}
            className="max-h-full max-w-full border border-separator bg-white shadow-sm"
          />
        ) : (
          <Spinner />
        )}
        {fileStart && (
          <span className="absolute -top-1 -left-1 rounded-full bg-accent px-1.5 text-[10px] font-semibold text-white">
            File {pageRef.fileIndex + 1}
          </span>
        )}
      </div>
      <span
        className={cx(
          'mt-1 text-[11px] tabular-nums',
          printed ? 'text-text-secondary' : 'text-text-secondary line-through',
        )}
      >
        {pageRef.n}
      </span>
    </li>
  );
}
