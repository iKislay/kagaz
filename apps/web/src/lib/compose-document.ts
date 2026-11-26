/**
 * Turns what the customer picks (PDFs, photos, Word .docx) into PDFs, in the browser, and merges
 * them into the one PDF that is uploaded. The server still only accepts a PDF and validates it by
 * content (CLAUDE.md invariant 11); conversion here never replaces that check.
 */
import { PDFDocument } from 'pdf-lib';

/** `accept` for the file picker. */
export const ACCEPTED_FILES =
  'application/pdf,.pdf,image/*,.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export type SourceKind = 'pdf' | 'image' | 'docx';

/** A4 in PDF points. */
const A4: [number, number] = [595.28, 841.89];
/** Raster pages (photos, Word pages) are encoded at 150 dpi: sharp on paper, small to upload. */
const RASTER_DPI = 150;
const A4_LONG_EDGE_PX = Math.round((A4[1] / 72) * RASTER_DPI);
const PHOTO_MARGIN_PT = 18;
const JPEG_QUALITY = 0.85;

/** A problem with one of the customer's files, worded for the customer. */
export class ComposeError extends Error {
  override name = 'ComposeError';
}

/** One customer file as a standalone PDF. */
export interface ConvertedFile {
  kind: SourceKind;
  pdf: Uint8Array;
  pageCount: number;
}

function sourceKind(file: File): SourceKind | null {
  const name = file.name.toLowerCase();
  if (file.type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (file.type.startsWith('image/')) return 'image';
  if (name.endsWith('.docx')) return 'docx';
  return null;
}

/** Convert one customer file to a standalone PDF. Throws ComposeError, worded for the customer. */
export async function fileToPdf(file: File): Promise<ConvertedFile> {
  const kind = sourceKind(file);
  if (!kind) {
    throw new ComposeError(
      `${file.name}: choose a PDF, a photo or a Word (.docx) file. Older .doc files: save as .docx or PDF first.`,
    );
  }
  const doc =
    kind === 'pdf'
      ? await pdfFromPdf(file)
      : kind === 'image'
        ? await pdfFromImage(file)
        : await pdfFromDocx(file);
  return { kind, pdf: await doc.save(), pageCount: doc.getPageCount() };
}

/** Merge converted files, in order, into the one PDF to upload. */
export async function mergePdfs(parts: Uint8Array[]): Promise<Blob> {
  const merged = await PDFDocument.create();
  for (const part of parts) {
    const doc = await PDFDocument.load(part);
    const pages = await merged.copyPages(doc, doc.getPageIndices());
    for (const page of pages) merged.addPage(page);
  }
  // pdf-lib's bytes are typed over ArrayBufferLike; slice() gives the plain ArrayBuffer a Blob takes.
  return new Blob([(await merged.save()).slice()], { type: 'application/pdf' });
}

async function pdfFromPdf(file: File): Promise<PDFDocument> {
  try {
    // Loading proves the file parses and is not encrypted before it is merged.
    const doc = await PDFDocument.load(await file.arrayBuffer());
    if (doc.getPageCount() === 0) throw new ComposeError(`${file.name} has no pages.`);
    return doc;
  } catch (err) {
    if (err instanceof ComposeError) throw err;
    throw new ComposeError(
      /encrypt/i.test(String(err))
        ? `${file.name} is password-protected. Remove the password and try again.`
        : `${file.name} isn't a readable PDF.`,
    );
  }
}

async function pdfFromImage(file: File): Promise<PDFDocument> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file); // applies the photo's EXIF orientation
  } catch {
    throw new ComposeError(`${file.name}: this browser can't open that image. Try a JPG or PNG.`);
  }
  const scale = Math.min(1, A4_LONG_EDGE_PX / Math.max(bitmap.width, bitmap.height));
  const canvas = createCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale));
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  const doc = await PDFDocument.create();
  await addRasterPage(doc, canvas, PHOTO_MARGIN_PT);
  return doc;
}

async function pdfFromDocx(file: File): Promise<PDFDocument> {
  const [{ renderAsync }, { default: html2canvas }] = await Promise.all([
    import('docx-preview'),
    import('html2canvas-pro'),
  ]);
  // Laid out off-screen (not display:none, which would have no layout to capture).
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:fixed;left:-100000px;top:0;pointer-events:none;';
  document.body.append(host);
  try {
    try {
      await renderAsync(file, host, undefined, {
        inWrapper: false,
        breakPages: true,
        // Word records where its own pages ended; following it matches Word's pagination.
        ignoreLastRenderedPageBreak: false,
        useBase64URL: true,
        renderHeaders: true,
        renderFooters: true,
      });
    } catch {
      throw new ComposeError(`${file.name} isn't a readable Word document.`);
    }
    const sections = [...host.querySelectorAll<HTMLElement>('section.docx')];
    if (sections.length === 0) throw new ComposeError(`${file.name} has no pages.`);

    const doc = await PDFDocument.create();
    for (const section of sections) {
      const canvas = await html2canvas(section, {
        scale: RASTER_DPI / 96,
        backgroundColor: '#ffffff',
        logging: false,
      });
      for (const page of splitIntoPages(canvas, pageRatio(section))) {
        await addRasterPage(doc, page, 0);
      }
    }
    return doc;
  } finally {
    host.remove();
  }
}

/** Height ÷ width of a rendered Word page (docx-preview sets width and min-height from the page size). */
function pageRatio(section: HTMLElement): number {
  const width = parseFloat(section.style.width);
  const height = parseFloat(section.style.minHeight);
  return width > 0 && height > 0 ? height / width : A4[1] / A4[0];
}

/**
 * A Word section taller than its page (content docx-preview could not break) is cut into
 * page-high slices.
 * shortcut: slices can cut through a line of text; upgrade to real layout-based pagination if
 * customers report split lines.
 */
function splitIntoPages(canvas: HTMLCanvasElement, ratio: number): HTMLCanvasElement[] {
  const pageHeight = Math.round(canvas.width * ratio);
  // 2% tolerance: rounding in the rendered height must not produce a near-empty extra page.
  const count = Math.max(1, Math.ceil(canvas.height / pageHeight - 0.02));
  if (count === 1) return [canvas];
  return Array.from({ length: count }, (_, i) => {
    const slice = createCanvas(canvas.width, pageHeight);
    slice.getContext('2d')!.drawImage(canvas, 0, -i * pageHeight);
    return slice;
  });
}

/** A white canvas (JPEG has no transparency; transparent PNG areas must print white, not black). */
function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  return canvas;
}

/** Add an A4 page (portrait or landscape, whichever fits) with the canvas fitted and centred. */
async function addRasterPage(doc: PDFDocument, canvas: HTMLCanvasElement, marginPt: number) {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
  );
  if (!blob) throw new ComposeError('Your browser ran out of memory preparing the pages.');
  const image = await doc.embedJpg(new Uint8Array(await blob.arrayBuffer()));

  const [pw, ph] = canvas.width > canvas.height ? [A4[1], A4[0]] : A4;
  const scale = Math.min((pw - 2 * marginPt) / image.width, (ph - 2 * marginPt) / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  doc.addPage([pw, ph]).drawImage(image, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
}
