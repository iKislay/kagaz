import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import { type UploadSourceType } from '@kagaz/shared';
import { A4_PORTRAIT } from '../printing/slip.js';
import { PdfValidationError, validatePdf } from './pdf-validator.js';

// One image at a time, no cache: the API runs on a small instance (Render).
sharp.cache(false);
sharp.concurrency(1);

export interface UploadLimits {
  maxBytes: number;
  maxPages: number;
  /** Decoded image size limit (width × height), guards against decompression bombs. */
  maxImagePixels: number;
}

export interface ValidatedUpload {
  sourceType: UploadSourceType;
  /** The printable PDF to store: the upload itself for a PDF, a one-page A4 PDF for an image. */
  pdf: Buffer;
  /** True when `pdf` is new bytes (an image was converted) and must replace the upload. */
  converted: boolean;
  pageCount: number;
  /** SHA-256 of `pdf`. */
  sha256: string;
  bytes: number;
}

/** A4 at 300 dpi: more pixels than this never reach paper. */
const MAX_LONG_SIDE = 3508;
const MAX_SHORT_SIDE = 2480;
/** ≈ 6 mm: most shop printers can't print to the edge. */
const PAGE_MARGIN_PT = 18;

type Sniffed = UploadSourceType | 'HEIF';

/**
 * What the bytes are, from their magic numbers — never from the filename or the browser's MIME
 * type (CLAUDE.md invariant 11). HEIF/HEIC/AVIF is recognised only to explain that it isn't
 * supported.
 */
export function sniffUploadType(buf: Uint8Array): Sniffed | null {
  const b = Buffer.from(buf.buffer, buf.byteOffset, Math.min(buf.length, 1024));
  if (b.indexOf('%PDF-') !== -1) return 'PDF'; // spec tolerates junk before the header
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'JPEG';
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'PNG';
  }
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') {
    return 'WEBP';
  }
  if (b.toString('latin1', 4, 8) === 'ftyp') {
    const brand = b.toString('latin1', 8, 12);
    if (/^(heic|heix|hevc|hevx|heim|heis|mif1|msf1|avif|avis)$/.test(brand)) return 'HEIF';
  }
  return null;
}

/**
 * Validate an upload by content and return the printable PDF. PDFs go through `validatePdf`
 * unchanged; JPEG/PNG/WebP are fully decoded (a broken image fails here, not at the printer),
 * turned upright from their EXIF orientation, capped at A4 300 dpi, flattened onto white and
 * placed on one A4 page in their own orientation (ADR-005).
 */
export async function validateUpload(
  buffer: Buffer,
  limits: UploadLimits,
): Promise<ValidatedUpload> {
  if (buffer.length > limits.maxBytes) throw new PdfValidationError('FILE_TOO_LARGE');
  if (buffer.length === 0) throw new PdfValidationError('FILE_TYPE_UNSUPPORTED');
  const type = sniffUploadType(buffer);
  if (type === null) throw new PdfValidationError('FILE_TYPE_UNSUPPORTED');
  if (type === 'HEIF') throw new PdfValidationError('FILE_HEIC_UNSUPPORTED');

  if (type === 'PDF') {
    const pdf = await validatePdf(buffer, limits);
    return { sourceType: 'PDF', pdf: buffer, converted: false, ...pdf };
  }

  const pdf = await imageToPdf(buffer, type, limits.maxImagePixels);
  return {
    sourceType: type,
    pdf,
    converted: true,
    pageCount: 1,
    sha256: createHash('sha256').update(pdf).digest('hex'),
    bytes: pdf.length,
  };
}

const SHARP_FORMAT: Record<Exclude<UploadSourceType, 'PDF'>, string> = {
  JPEG: 'jpeg',
  PNG: 'png',
  WEBP: 'webp',
};

/** One A4 page (portrait or landscape, like the image) with the image fitted inside a margin. */
export async function imageToPdf(
  buffer: Buffer,
  type: Exclude<UploadSourceType, 'PDF'>,
  maxPixels: number,
): Promise<Buffer> {
  const input = () =>
    sharp(buffer, { limitInputPixels: maxPixels, failOn: 'error', sequentialRead: true });

  let jpeg: { data: Buffer; info: sharp.OutputInfo };
  try {
    const meta = await input().metadata();
    if (meta.format !== SHARP_FORMAT[type] || !meta.width || !meta.height) {
      throw new PdfValidationError('IMAGE_CORRUPT');
    }
    if (meta.width * meta.height > maxPixels) throw new PdfValidationError('IMAGE_TOO_LARGE');
    // EXIF orientations 5–8 swap width and height once the image is upright.
    const swapped = (meta.orientation ?? 1) >= 5;
    const landscape = swapped ? meta.height > meta.width : meta.width > meta.height;
    jpeg = await input()
      .rotate() // apply EXIF orientation, then drop it
      .resize({
        width: landscape ? MAX_LONG_SIDE : MAX_SHORT_SIDE,
        height: landscape ? MAX_SHORT_SIDE : MAX_LONG_SIDE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .flatten({ background: '#ffffff' }) // transparent PNG areas print as paper, not black
      .toColourspace('srgb')
      .jpeg({ quality: 90, chromaSubsampling: '4:4:4' }) // 4:4:4 keeps text in screenshots crisp
      .toBuffer({ resolveWithObject: true });
  } catch (err) {
    if (err instanceof PdfValidationError) throw err;
    const message = err instanceof Error ? err.message : '';
    throw new PdfValidationError(
      /pixel limit/i.test(message) ? 'IMAGE_TOO_LARGE' : 'IMAGE_CORRUPT',
    );
  }

  const { width, height } = jpeg.info;
  const landscape = width > height;
  const [pw, ph] = landscape ? [A4_PORTRAIT[1], A4_PORTRAIT[0]] : A4_PORTRAIT;
  const doc = await PDFDocument.create();
  doc.setCreator('Kaggaz');
  doc.setProducer('Kaggaz');
  const image = await doc.embedJpg(jpeg.data);
  const page = doc.addPage([pw, ph]);
  const scale = Math.min((pw - 2 * PAGE_MARGIN_PT) / width, (ph - 2 * PAGE_MARGIN_PT) / height);
  const w = width * scale;
  const h = height * scale;
  page.drawImage(image, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
  return Buffer.from(await doc.save());
}
