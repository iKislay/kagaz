'use client';

/**
 * Browser-side PDF rendering (pdf.js) for file-card thumbnails and the print preview. Loaded on
 * demand so the rest of the site never downloads pdf.js. Rendering only: nothing here decides
 * page counts or prices — those come from the API.
 */
import type * as PdfJsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';

type PdfJs = typeof PdfJsLib;
let pdfjs: Promise<PdfJs> | null = null;

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

export interface OpenPdf {
  doc: PDFDocumentProxy;
  /** Frees the worker-side document. */
  close: () => Promise<void>;
}

export async function openPdf(data: ArrayBuffer): Promise<OpenPdf> {
  const lib = await loadPdfJs();
  // pdf.js takes ownership of the buffer; keep the caller's copy intact.
  const task = lib.getDocument({ data: new Uint8Array(data.slice(0)), verbosity: 0 });
  return { doc: await task.promise, close: () => task.destroy() };
}

/** Render one page (1-based) to an image URL about `width` CSS pixels wide (retina-sharp). */
export async function renderPage(
  doc: PDFDocumentProxy,
  pageNumber: number,
  width: number,
): Promise<{ url: string; landscape: boolean }> {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const viewport = page.getViewport({ scale: (width * dpr) / base.width });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport }).promise;
  page.cleanup();
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
  if (!blob) throw new Error('render failed');
  return { url: URL.createObjectURL(blob), landscape: base.width > base.height };
}

/** First page of a local PDF the customer picked, for its file card. */
export async function pdfThumbnail(file: File, width = 160): Promise<string> {
  const pdf = await openPdf(await file.arrayBuffer());
  try {
    return (await renderPage(pdf.doc, 1, width)).url;
  } finally {
    await pdf.close();
  }
}
