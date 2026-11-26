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
  const byPage = new Map(selected.map((n, i) => [n, embedded[i]!]));

  const layout = packetLayout(selected, options.copies, options.duplex);
  for (const entry of layout) {
    if (entry === SPACER) packet.addPage(A4_PORTRAIT);
    else drawFitted(packet, byPage.get(entry)!);
  }
  await drawPickupSlip(packet, slip);

  const bytes = await packet.save();
  return {
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    pageCount: packet.getPageCount(),
    slipIndex: packet.getPageCount() - 1,
    contentPages: selected.length * options.copies,
    spacerPages: layout.filter((entry) => entry === SPACER).length,
  };
}

/** A blank page in the packet layout. */
export const SPACER = null;
/** One packet page before the slip: a customer page number (1-based) or a blank spacer. */
export type PacketEntry = number | typeof SPACER;

/**
 * Packet page order before the pickup slip (which is always the next, last page): the selected
 * pages once per copy, a spacer after each odd-length copy when double-sided so every copy starts
 * on a front side, and a final spacer if needed so the slip also starts a new sheet.
 */
export function packetLayout(selected: number[], copies: number, duplex: boolean): PacketEntry[] {
  const layout: PacketEntry[] = [];
  for (let copy = 0; copy < copies; copy++) {
    layout.push(...selected);
    if (duplex && selected.length % 2 === 1) layout.push(SPACER);
  }
  // Safety net: the slip must start a new sheet (front side) when printing double-sided.
  if (duplex && layout.length % 2 === 1) layout.push(SPACER);
  return layout;
}

/**
 * 0-based packet pages to render in greyscale for a mixed-colour order: every B/W customer page,
 * spacer and the slip. Empty when the whole job is one mode (the job's colour setting covers it).
 */
export function greyscalePacketPages(
  selected: number[],
  colour: ReadonlySet<number>,
  copies: number,
  duplex: boolean,
): number[] {
  if (colour.size === 0 || colour.size === selected.length) return [];
  const layout = packetLayout(selected, copies, duplex);
  const pages = layout.flatMap((entry, i) => (entry !== SPACER && colour.has(entry) ? [] : [i]));
  return [...pages, layout.length];
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
