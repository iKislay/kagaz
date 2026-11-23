# ADR-005: Several files per order, including photos

- Status: accepted (2026-11-24)
- Context: v1 took exactly one PDF per order (PRD D2 "PDF only", CLAUDE.md scope guardrail "non-PDF uploads").
  Customers in Mandya mostly arrive with a phone full of photos and screenshots (ID cards, marksheets, receipts)
  plus a PDF or two. They asked to pick several files at once, see them as cards, reorder and remove them, add
  more, see a print preview, and upload photos without converting them first. The user (product owner) asked
  for this explicitly, taking iLovePDF's multi-file picker as the reference.

## Decision

1. **An order holds up to `MAX_FILES_PER_ORDER` (20) files.** Each is an `ORIGINAL` `FileAsset` with a
   `position` (print order, ties by `createdAt`) and a `sourceType`. Files can be added, removed (an upload in
   progress can be cancelled) and reordered while the order is `DRAFT`/`AWAITING_PAYMENT` and has no payment;
   all of it under the same order-row lock as `pay()` and `cancel()`. New endpoints:
   `DELETE /api/orders/:id/files/:fileId`, `PUT /api/orders/:id/files/order`,
   `GET /api/orders/:id/files/:fileId/content` (the stored PDF, for the preview; tracking-token guarded,
   streamed through the API so the bucket needs no CORS for reads). `PublicOrder.files` lists them.
2. **Accepted types: PDF, JPEG, PNG, WebP**, recognised by magic bytes at upload-complete (invariant 11 holds:
   never by filename or browser MIME; uploads are signed as opaque `application/octet-stream`).
   - Images are **fully decoded** with `sharp` (a broken image fails at upload, not at the printer), turned
     upright from EXIF orientation, capped at A4 300 dpi, flattened onto white (transparent PNGs) and placed on
     **one A4 page** in their own orientation with a ~6 mm margin, as a PDF. The stored, printable file is always
     a PDF; the raw image is deleted. `MAX_IMAGE_PIXELS` (50 MP) guards against decompression bombs, and sharp
     runs with concurrency 1 and no cache on the small API instance.
   - **WebP: yes** — sharp decodes it with no extra dependency, and phones/WhatsApp save many images as WebP.
   - **HEIC/HEIF: no (for now)** — sharp's prebuilt libvips has no HEVC decoder (patent-encumbered), and the
     alternatives are a native libheif build in the Docker image or a slow WASM decoder. iPhones already send
     JPEG when sharing to a website ("Most Compatible"), so HEIC is recognised by content only to return a clear
     `FILE_HEIC_UNSUPPORTED` message ("save it as JPEG").
   - Still out: Word/Excel/other documents (D2 unchanged — "save as PDF first").
3. **One document, one packet, one job (invariant 7 unchanged).** The files print as one combined document
   in print order. Page ranges, the quote and the print packet count pages of that document. When the shop needs
   it (job detail preview, accept), `CombinedDocumentService` merges the files once into a `COMBINED`
   `FileAsset` (files are frozen after payment). The print packet is built from it exactly as before: pages ×
   copies + duplex spacers + **one** pickup slip, one PDF, one spooler job. Single-file orders use their file.
4. **Price stays server-side in integer paise over the total pages** (invariant 1). **One set of print options
   for the whole order** (copies, colour, sides, page range): per-file options would need per-file quote lines,
   per-file packet sections and a new shop-app display, and customers rarely need them; a customer who wants a
   file in colour and another in B/W places two orders. `MAX_PAGES` applies per file and to the total.
5. **No shop-app change.** `ShopJob.pageCount` is the total, and `previewUrl` points to the combined PDF.

## Consequences

- New dependency `sharp` (prebuilt native binaries, glibc Linux in the API Docker image; Windows for dev).
- Migration `20261124090000_multi_file_orders`: `FileKind.COMBINED`, `file_assets.position`,
  `file_assets.source_type`. Existing orders (one file, `position` null) read as before.
- New stable error codes: `FILE_TYPE_UNSUPPORTED`, `FILE_HEIC_UNSUPPORTED`, `IMAGE_CORRUPT`, `IMAGE_TOO_LARGE`,
  `TOO_MANY_FILES`, `ORDER_TOO_MANY_PAGES`.
- A file removed while its upload is still in flight may land in the bucket afterwards; its row keeps
  `deleted_at` null so retention deletes the object again when the order closes.
- An order with all files removed has no quote and `pay()` refuses it (`ORDER_NOT_PAYABLE`); there is no
  `AWAITING_PAYMENT → DRAFT` transition (the state table is unchanged).
- The customer's print preview renders the stored PDFs in the browser with pdf.js (loaded on demand).
