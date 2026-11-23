import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';

export interface CombinedPdf {
  bytes: Uint8Array;
  sha256: string;
  pageCount: number;
}

/**
 * Merge an order's files, in print order, into one PDF (ADR-005) — what the shop previews and
 * what the print packet is built from, so a multi-file order is still one packet / one job
 * (invariant 7). Pages are copied unchanged (size, orientation); form fields are flattened per
 * file first because copied pages lose their AcroForm and filled forms must still print.
 */
export async function combinePdfs(sources: readonly Uint8Array[]): Promise<CombinedPdf> {
  if (sources.length === 0) throw new RangeError('Nothing to combine');
  const out = await PDFDocument.create();
  out.setCreator('Kaggaz');
  out.setProducer('Kaggaz');
  for (const bytes of sources) {
    const src = await PDFDocument.load(bytes, { updateMetadata: false });
    try {
      src.getForm().flatten();
    } catch {
      // No form / unflattenable form: copy the page content as is.
    }
    const pages = await out.copyPages(src, src.getPageIndices());
    for (const page of pages) out.addPage(page);
  }
  const bytes = await out.save();
  return {
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    pageCount: out.getPageCount(),
  };
}
