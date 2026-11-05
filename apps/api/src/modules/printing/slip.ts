import { type PDFDocument, type PDFFont, type PDFPage, StandardFonts, rgb } from 'pdf-lib';

export const A4_PORTRAIT: [number, number] = [595.28, 841.89];

export interface SlipData {
  code: string; // 8 chars, unformatted
  publicRef: string;
  shopName: string;
  pages: number;
  copies: number;
  colour: boolean;
  duplex: boolean;
  printedAt: Date;
  isDemo: boolean;
}

const INK = rgb(0.06, 0.09, 0.16);
const BRAND = rgb(0.12, 0.31, 0.47);
const MUTED = rgb(0.4, 0.45, 0.52);
const ALERT = rgb(0.72, 0.11, 0.11);

/**
 * The pickup slip — PRD §8.6. One A4 page appended to the end of the packet:
 * wordmark, very large pickup code, order ref, shop, time, job summary for checking the
 * stack, and "REMOVE THIS SLIP BEFORE HANDOVER". Never prints the customer's phone number.
 * Uses standard PDF fonts (WinAnsi): keep text to Latin-1 characters.
 */
export async function drawPickupSlip(doc: PDFDocument, data: SlipData): Promise<PDFPage> {
  const page = doc.addPage(A4_PORTRAIT);
  const [width, height] = A4_PORTRAIT;
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.CourierBold);

  const center = (text: string, font: PDFFont, size: number, y: number, color = INK) => {
    const w = font.widthOfTextAtSize(text, size);
    page.drawText(text, { x: (width - w) / 2, y, size, font, color });
  };

  // Header band
  page.drawRectangle({ x: 0, y: height - 90, width, height: 90, color: BRAND });
  page.drawText('Kagaz', { x: 48, y: height - 60, size: 34, font: bold, color: rgb(1, 1, 1) });
  const tagline = 'PICKUP SLIP';
  page.drawText(tagline, {
    x: width - 48 - bold.widthOfTextAtSize(tagline, 14),
    y: height - 55,
    size: 14,
    font: bold,
    color: rgb(1, 1, 1),
  });

  // Pickup code
  center('PICKUP CODE', bold, 16, height - 190, MUTED);
  const display = `${data.code.slice(0, 4)} ${data.code.slice(4)}`;
  center(display, mono, 76, height - 290);
  page.drawRectangle({
    x: 60,
    y: height - 320,
    width: width - 120,
    height: 160,
    borderColor: INK,
    borderWidth: 2,
  });

  // Order details
  const rows: [string, string][] = [
    ['Order', data.publicRef],
    ['Shop', data.shopName],
    [
      'Job',
      `${data.pages} page${data.pages === 1 ? '' : 's'} x ${data.copies} cop${data.copies === 1 ? 'y' : 'ies'}` +
        ` - ${data.colour ? 'Colour' : 'B/W'} - ${data.duplex ? 'Double-sided' : 'Single-sided'}`,
    ],
    ['Printed', formatIst(data.printedAt)],
  ];
  let y = height - 390;
  for (const [label, value] of rows) {
    page.drawText(label.toUpperCase(), { x: 80, y, size: 11, font: bold, color: MUTED });
    page.drawText(fit(value, regular, 15, width - 240), {
      x: 180,
      y,
      size: 15,
      font: regular,
      color: INK,
    });
    y -= 34;
  }

  // Handover warning
  page.drawRectangle({
    x: 60,
    y: 150,
    width: width - 120,
    height: 70,
    borderColor: ALERT,
    borderWidth: 3,
  });
  center('REMOVE THIS SLIP BEFORE HANDOVER', bold, 22, 178, ALERT);
  center(
    'Ask the customer for this code and verify it in the Kagaz app before handing over.',
    regular,
    10,
    120,
    MUTED,
  );

  if (data.isDemo) {
    center('DEMO ORDER - NO MONEY CHARGED', bold, 10, 60, MUTED);
  }
  return page;
}

function fit(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && font.widthOfTextAtSize(`${out}...`, size) > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out}...`;
}

function formatIst(date: Date): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
  })
    .format(date)
    .replace(/[^\x20-\x7e]/g, ' '); // keep WinAnsi-safe (Intl may emit narrow no-break spaces)
}
