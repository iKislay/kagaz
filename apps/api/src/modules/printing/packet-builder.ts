import { createHash } from 'node:crypto';
import { PDFDocument, type PDFEmbeddedPage } from 'pdf-lib';
import { parsePageRange } from '@kagaz/shared';
import { A4_PORTRAIT, type SlipData, drawPickupSlip } from './slip.js';

const A4_LANDSCAPE: [number, number] = [A4_PORTRAIT[1], A4_PORTRAIT[0]];

export interface PacketOptions {
  pageRange?: string | undefined;
  copies: number;
  duplex: boolean;
}

export interface BuiltPacket {
  bytes: Uint8Array;
  sha256: string;
  pageCount: number;
  /** 0-based index of the pickup slip (always the last page). */
  slipIndex: number;
  /** Customer pages actually printed (= selected pages × copies). */
  contentPages: number;
  spacerPages: number;
}

/**
 * Build the single combined print packet — Appendix A.1, PRD §8.6:
 *   selected pages × copies (copies live in the PDF; driver copy count is always 1)
 *   + duplex spacers so each copy starts on a front side
 *   + exactly one pickup slip on its own physical sheet, always last.
 * Each selected page is embedded once and drawn per copy (small files), scaled to fit A4
 * in its own orientation. Form fields are flattened first so filled forms print.
 */
export async function buildPrintPacket(
  original: Uint8Array,
  options: PacketOptions,
  slip: SlipData,
): Promise<BuiltPacket> {
  const source = await PDFDocument.load(original, { updateMetadata: false });
  try {
    source.getForm().flatten();
  } catch {
    // No form / unflattenable form: print the page content as-is.
  }

  const selected = parsePageRange(options.pageRange, source.getPageCount());
  const packet = await PDFDocument.create();
  packet.setTitle(`Kaggaz ${slip.publicRef}`);
  packet.setCreator('Kaggaz');
  packet.setProducer('Kaggaz');

  const embedded = await packet.embedPages(selected.map((n) => source.getPage(n - 1)));

  let spacerPages = 0;
  for (let copy = 0; copy < options.copies; copy++) {
    for (const page of embedded) drawFitted(packet, page);
    if (options.duplex && selected.length % 2 === 1) {
      packet.addPage(A4_PORTRAIT);
      spacerPages++;
    }
  }
  // Safety net: the slip must start a new sheet (front side) when printing double-sided.
  if (options.duplex && packet.getPageCount() % 2 === 1) {
    packet.addPage(A4_PORTRAIT);
    spacerPages++;
  }

  await drawPickupSlip(packet, slip);

  const bytes = await packet.save();
  return {
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    pageCount: packet.getPageCount(),
    slipIndex: packet.getPageCount() - 1,
    contentPages: selected.length * options.copies,
    spacerPages,
  };
}

function drawFitted(doc: PDFDocument, src: PDFEmbeddedPage): void {
  const landscape = src.width > src.height;
  const [pw, ph] = landscape ? A4_LANDSCAPE : A4_PORTRAIT;
  const page = doc.addPage([pw, ph]);
  const scale = Math.min(pw / src.width, ph / src.height);
  const w = src.width * scale;
  const h = src.height * scale;
  page.drawPage(src, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
}
