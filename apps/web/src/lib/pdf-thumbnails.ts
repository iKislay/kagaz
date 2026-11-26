/** Page thumbnails for the order preview, rendered in the browser with pdf.js. */

import type * as PdfJsModule from 'pdfjs-dist';

type PdfJs = typeof PdfJsModule;
let pdfjs: Promise<PdfJs> | null = null;

/** Load pdf.js once, with its parser in a module worker so the page stays responsive. */
function loadPdfJs(): Promise<PdfJs> {
  pdfjs ??= import('pdfjs-dist').then((lib) => {
    lib.GlobalWorkerOptions.workerPort = new Worker(
      new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url),
      { type: 'module' },
    );
    return lib;
  });
  return pdfjs;
}

/**
 * Render every page of `pdf` to a JPEG data URL `width` CSS pixels wide (sharp on 2× screens).
 * Pages arrive in order through `onPage`; stops early once `signal` is aborted.
 */
export async function renderThumbnails(
  pdf: Uint8Array,
  width: number,
  onPage: (index: number, url: string) => void,
  signal: AbortSignal,
): Promise<void> {
  const lib = await loadPdfJs();
  // pdf.js transfers the buffer to its worker: hand it a copy so the caller's bytes stay usable.
  const task = lib.getDocument({ data: pdf.slice(), verbosity: 0 });
  try {
    const doc = await task.promise;
    for (let i = 1; i <= doc.numPages && !signal.aborted; i++) {
      const page = await doc.getPage(i);
      const viewport = page.getViewport({
        scale: (2 * width) / page.getViewport({ scale: 1 }).width,
      });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      await page.render({ canvas, viewport }).promise;
      if (!signal.aborted) onPage(i - 1, canvas.toDataURL('image/jpeg', 0.75));
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
}
