/**
 * Sample PDFs for load runs: files from test-assets/pdfs/valid-*.pdf when present (Appendix C),
 * otherwise generated A4 documents. Never real personal documents.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { REPO_ROOT } from './common.js';

export interface SamplePdf {
  name: string;
  pages: number;
  bytes: Uint8Array;
}

export async function generatePdf(pages: number, label = 'Kagaz load test'): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) {
    const page = doc.addPage([595.28, 841.89]);
    page.drawText(`${label} — page ${i} of ${pages}`, {
      x: 56,
      y: 770,
      size: 18,
      font,
      color: rgb(0.1, 0.1, 0.1),
    });
  }
  return doc.save();
}

export async function samplePdfs(): Promise<SamplePdf[]> {
  const dir = join(REPO_ROOT, 'test-assets', 'pdfs');
  const out: SamplePdf[] = [];
  if (existsSync(dir)) {
    for (const name of readdirSync(dir).filter((n) => /^valid-.*\.pdf$/i.test(n))) {
      const bytes = new Uint8Array(readFileSync(join(dir, name)));
      const pages = (await PDFDocument.load(bytes)).getPageCount();
      if (pages <= 20) out.push({ name, pages, bytes });
    }
  }
  if (out.length === 0) {
    for (const pages of [1, 2, 3, 5, 8, 12]) {
      out.push({ name: `generated-${pages}p.pdf`, pages, bytes: await generatePdf(pages) });
    }
  }
  return out;
}
