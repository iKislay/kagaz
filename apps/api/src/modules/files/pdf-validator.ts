import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

/** Stable error codes returned to the customer (PRD FR-CUST-05). */
export const PdfErrorCode = {
  FILE_NOT_PDF: 'FILE_NOT_PDF',
  FILE_ENCRYPTED: 'FILE_ENCRYPTED',
  FILE_CORRUPT: 'FILE_CORRUPT',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  FILE_TOO_MANY_PAGES: 'FILE_TOO_MANY_PAGES',
  FILE_EMPTY: 'FILE_EMPTY',
} as const;
export type PdfErrorCode = (typeof PdfErrorCode)[keyof typeof PdfErrorCode];

export const PDF_ERROR_MESSAGES: Record<PdfErrorCode, string> = {
  FILE_NOT_PDF: 'This file is not a PDF. Please upload a PDF document.',
  FILE_ENCRYPTED: 'This PDF is password-protected. Remove the password and upload it again.',
  FILE_CORRUPT: 'This PDF could not be read. It may be damaged; try exporting it again.',
  FILE_TOO_LARGE: 'This file is too large.',
  FILE_TOO_MANY_PAGES: 'This PDF has too many pages.',
  FILE_EMPTY: 'This PDF has no pages.',
};

export class PdfValidationError extends Error {
  override name = 'PdfValidationError';
  constructor(
    readonly code: PdfErrorCode,
    message: string = PDF_ERROR_MESSAGES[code],
  ) {
    super(message);
  }
}

export interface PdfLimits {
  maxBytes: number;
  maxPages: number;
}

export interface ValidatedPdf {
  pageCount: number;
  sha256: string;
  bytes: number;
}

const PDF_MAGIC = Buffer.from('%PDF-');

/**
 * Validate an uploaded file by its content (never by filename or browser MIME type):
 * size, %PDF- magic bytes, pdf-lib parse (rejects encryption), pdf.js parse of every page
 * (readability), page count limits. Returns page count and SHA-256.
 */
export async function validatePdf(buffer: Buffer, limits: PdfLimits): Promise<ValidatedPdf> {
  if (buffer.length > limits.maxBytes) throw new PdfValidationError('FILE_TOO_LARGE');
  // The header may be preceded by a little junk (PDF spec tolerates up to 1 KB).
  const headerAt = buffer.subarray(0, 1024).indexOf(PDF_MAGIC);
  if (headerAt === -1) throw new PdfValidationError('FILE_NOT_PDF');

  let pdfLibPages: number;
  let encrypted: boolean;
  try {
    // ignoreEncryption lets us inspect isEncrypted instead of relying on the thrown error type
    // (pdf-lib's EncryptedPDFError doesn't survive instanceof across module formats).
    const doc = await PDFDocument.load(buffer, { updateMetadata: false, ignoreEncryption: true });
    encrypted = doc.isEncrypted;
    pdfLibPages = doc.getPageCount();
  } catch {
    throw new PdfValidationError('FILE_CORRUPT');
  }
  if (encrypted) throw new PdfValidationError('FILE_ENCRYPTED');

  const pageCount = await parseWithPdfJs(buffer);
  if (pageCount !== pdfLibPages) throw new PdfValidationError('FILE_CORRUPT');
  if (pageCount < 1) throw new PdfValidationError('FILE_EMPTY');
  if (pageCount > limits.maxPages) throw new PdfValidationError('FILE_TOO_MANY_PAGES');

  return {
    pageCount,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    bytes: buffer.length,
  };
}

async function parseWithPdfJs(buffer: Buffer): Promise<number> {
  const task = getDocument({
    data: new Uint8Array(buffer), // pdf.js takes ownership of the array
    disableFontFace: true,
    useSystemFonts: false,
    stopAtErrors: true,
    verbosity: 0,
  });
  try {
    const doc = await task.promise;
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      page.cleanup();
    }
    return doc.numPages;
  } catch (err) {
    if (err instanceof Error && err.name === 'PasswordException') {
      throw new PdfValidationError('FILE_ENCRYPTED');
    }
    throw new PdfValidationError('FILE_CORRUPT');
  } finally {
    await task.destroy();
  }
}
