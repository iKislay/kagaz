/**
 * In-memory test PDFs (Appendix C corpus, generated instead of committed as binaries).
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const A4: [number, number] = [595.28, 841.89];

export async function makePdf(pages: number, size: [number, number] = A4): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) {
    const page = doc.addPage(size);
    page.drawText(`Test page ${i} of ${pages}`, {
      x: 50,
      y: size[1] - 80,
      size: 24,
      font,
      color: rgb(0, 0, 0),
    });
  }
  return Buffer.from(await doc.save());
}

/** A PDF whose trailer declares Standard-security encryption (password protected). */
export function makeEncryptedPdf(): Buffer {
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>\nendobj\n',
    '4 0 obj\n<< /Filter /Standard /V 1 /R 2 /O <' +
      'ab'.repeat(32) +
      '> /U <' +
      'cd'.repeat(32) +
      '> /P -44 >>\nendobj\n',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(body));
    body += obj;
  }
  const xrefAt = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) body += `${String(off).padStart(10, '0')} 00000 n \n`;
  body +=
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Encrypt 4 0 R ` +
    `/ID [<${'01'.repeat(16)}> <${'01'.repeat(16)}>] >>\n` +
    `startxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}

/** First half of a valid PDF: header present, structure missing. */
export async function makeTruncatedPdf(): Promise<Buffer> {
  const full = await makePdf(3);
  return full.subarray(0, Math.floor(full.length / 2));
}

/** PNG signature with a .pdf name — the content check must reject it. */
export function makeNotAPdf(): Buffer {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Array(64).fill(0)]);
}
