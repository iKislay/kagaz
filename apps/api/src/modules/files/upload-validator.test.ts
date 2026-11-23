import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import {
  makeHeicHeader,
  makeJpeg,
  makePng,
  makeWebp,
  makeZip,
} from '../../../test/fixtures/images.js';
import { makeEncryptedPdf, makePdf } from '../../../test/fixtures/pdfs.js';
import { combinePdfs } from './combine.js';
import { PdfValidationError } from './pdf-validator.js';
import { sniffUploadType, validateUpload } from './upload-validator.js';

const limits = { maxBytes: 5 * 1024 * 1024, maxPages: 20, maxImagePixels: 20_000_000 };
const A4_SHORT = 595;
const A4_LONG = 842;

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'OK';
  } catch (err) {
    expect(err).toBeInstanceOf(PdfValidationError);
    return (err as PdfValidationError).code;
  }
}

async function firstPage(pdf: Uint8Array): Promise<{ w: number; h: number; pages: number }> {
  const doc = await PDFDocument.load(pdf);
  const { width, height } = doc.getPage(0).getSize();
  return { w: Math.round(width), h: Math.round(height), pages: doc.getPageCount() };
}

describe('sniffUploadType: content, never the filename', () => {
  it('recognises PDF, JPEG, PNG, WebP and HEIC by magic bytes', async () => {
    expect(sniffUploadType(await makePdf(1))).toBe('PDF');
    expect(sniffUploadType(await makeJpeg())).toBe('JPEG');
    expect(sniffUploadType(await makePng())).toBe('PNG');
    expect(sniffUploadType(await makeWebp())).toBe('WEBP');
    expect(sniffUploadType(makeHeicHeader())).toBe('HEIF');
    expect(sniffUploadType(makeZip())).toBeNull();
  });
});

describe('validateUpload (ADR-005)', () => {
  it('passes a PDF through unchanged with its page count', async () => {
    const pdf = await makePdf(3);
    const v = await validateUpload(pdf, limits);
    expect(v).toMatchObject({ sourceType: 'PDF', converted: false, pageCount: 3 });
    expect(v.pdf).toBe(pdf);
  });

  it('keeps every PDF check (an encrypted PDF is refused)', async () => {
    expect(await codeOf(validateUpload(makeEncryptedPdf(), limits))).toBe('FILE_ENCRYPTED');
  });

  it('turns a landscape JPEG into one landscape A4 page', async () => {
    const v = await validateUpload(await makeJpeg(800, 400), limits);
    expect(v).toMatchObject({ sourceType: 'JPEG', converted: true, pageCount: 1 });
    expect(v.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(v.bytes).toBe(v.pdf.length);
    expect(await firstPage(v.pdf)).toEqual({ w: A4_LONG, h: A4_SHORT, pages: 1 });
  });

  it('applies EXIF orientation: a phone photo stored sideways prints upright', async () => {
    // Stored 800x400 with orientation 6 (rotate 90deg CW): upright it is 400x800, portrait.
    const v = await validateUpload(await makeJpeg(800, 400, 6), limits);
    expect(await firstPage(v.pdf)).toEqual({ w: A4_SHORT, h: A4_LONG, pages: 1 });
  });

  it('converts PNG (transparency flattened onto white) and WebP', async () => {
    const png = await validateUpload(await makePng(300, 400), limits);
    expect(png).toMatchObject({ sourceType: 'PNG', pageCount: 1 });
    expect(await firstPage(png.pdf)).toEqual({ w: A4_SHORT, h: A4_LONG, pages: 1 });
    const webp = await validateUpload(await makeWebp(), limits);
    expect(webp).toMatchObject({ sourceType: 'WEBP', pageCount: 1 });
    expect(await firstPage(webp.pdf)).toEqual({ w: A4_LONG, h: A4_SHORT, pages: 1 });
  });

  it('refuses HEIC with its own code, and anything that is not a PDF or image', async () => {
    expect(await codeOf(validateUpload(makeHeicHeader(), limits))).toBe('FILE_HEIC_UNSUPPORTED');
    expect(await codeOf(validateUpload(makeZip(), limits))).toBe('FILE_TYPE_UNSUPPORTED');
    expect(await codeOf(validateUpload(Buffer.alloc(0), limits))).toBe('FILE_TYPE_UNSUPPORTED');
  });

  it('refuses a broken image (JPEG header, garbage body)', async () => {
    const jpeg = await makeJpeg();
    const broken = Buffer.concat([jpeg.subarray(0, 40), Buffer.alloc(200, 0x41)]);
    expect(await codeOf(validateUpload(broken, limits))).toBe('IMAGE_CORRUPT');
  });

  it('refuses an image over the pixel limit (decompression-bomb guard)', async () => {
    const big = await makeJpeg(2000, 2000);
    expect(await codeOf(validateUpload(big, { ...limits, maxImagePixels: 1_000_000 }))).toBe(
      'IMAGE_TOO_LARGE',
    );
  });

  it('refuses an upload over the byte limit before decoding', async () => {
    expect(await codeOf(validateUpload(await makeJpeg(), { ...limits, maxBytes: 100 }))).toBe(
      'FILE_TOO_LARGE',
    );
  });
});

describe('combinePdfs: several files become one document in print order', () => {
  it('keeps every page, in order, each in its own orientation', async () => {
    const photo = await validateUpload(await makeJpeg(800, 400), limits);
    const combined = await combinePdfs([await makePdf(3), photo.pdf, await makePdf(2)]);
    expect(combined.pageCount).toBe(6);
    const doc = await PDFDocument.load(combined.bytes);
    const shape = doc.getPages().map((p) => (p.getWidth() > p.getHeight() ? 'L' : 'P'));
    expect(shape).toEqual(['P', 'P', 'P', 'L', 'P', 'P']);
    expect(combined.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses to combine nothing', async () => {
    await expect(combinePdfs([])).rejects.toThrow(RangeError);
  });
});
