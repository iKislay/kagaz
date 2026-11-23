-- ADR-005: several files (PDFs and images) per order, printed as one combined document.
ALTER TYPE "FileKind" ADD VALUE 'COMBINED';

ALTER TABLE "file_assets" ADD COLUMN "position" INTEGER,
ADD COLUMN "source_type" TEXT;
