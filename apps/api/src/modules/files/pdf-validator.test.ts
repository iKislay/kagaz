import { describe, expect, it } from 'vitest';
import {
  makeEncryptedPdf,
  makeNotAPdf,
  makePdf,
  makeTruncatedPdf,
} from '../../../test/fixtures/pdfs.js';
import { PdfValidationError, validatePdf } from './pdf-validator.js';

const limits = { maxBytes: 5 * 1024 * 1024, maxPages: 20 };

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'OK';
  } catch (err) {
    expect(err).toBeInstanceOf(PdfValidationError);
    return (err as PdfValidationError).code;
  }
}

describe('validatePdf (T01, T02)', () => {
  it('accepts a valid PDF and returns page count + sha256', async () => {
    const pdf = await makePdf(3);
    const result = await validatePdf(pdf, limits);
    expect(result.pageCount).toBe(3);
    expect(result.bytes).toBe(pdf.length);
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('accepts non-A4 pages (normalized later in the packet)', async () => {
    expect((await validatePdf(await makePdf(1, [612, 792]), limits)).pageCount).toBe(1);
  });

  it('rejects a renamed non-PDF by content', async () => {
    expect(await codeOf(validatePdf(makeNotAPdf(), limits))).toBe('FILE_NOT_PDF');
  });

  it('rejects a password-protected PDF', async () => {
    expect(await codeOf(validatePdf(makeEncryptedPdf(), limits))).toBe('FILE_ENCRYPTED');
  });

  it('rejects a truncated/corrupt PDF', async () => {
    expect(await codeOf(validatePdf(await makeTruncatedPdf(), limits))).toBe('FILE_CORRUPT');
  });

  it('rejects files over the size limit', async () => {
    const pdf = await makePdf(2);
    expect(await codeOf(validatePdf(pdf, { ...limits, maxBytes: pdf.length - 1 }))).toBe(
      'FILE_TOO_LARGE',
    );
  });

  it('rejects too many pages', async () => {
    expect(await codeOf(validatePdf(await makePdf(4), { ...limits, maxPages: 3 }))).toBe(
      'FILE_TOO_MANY_PAGES',
    );
  });
});
