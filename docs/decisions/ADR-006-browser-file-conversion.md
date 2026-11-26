# ADR-006: Photos and Word files converted in the browser; per-page colour

- Status: accepted (2026-11-26)
- Context: customers asked to print photos and Word documents, several files in one order, to skip pages and
  to print only some pages in colour. The guardrails required a decision before accepting non-PDF uploads. The
  production API runs on a 512 MB Render instance where a server-side converter (LibreOffice) does not fit.

## Decision

1. **Conversion happens in the customer's browser** (`apps/web/src/lib/compose-document.ts`). PDFs are loaded
   with pdf-lib (encrypted or unreadable files are refused); photos are drawn on a white canvas, scaled to at
   most 150 dpi A4 and embedded as JPEG; `.docx` is rendered with docx-preview (following Word's own page
   breaks) and rasterised at 150 dpi with html2canvas-pro. All files are merged, in order, into **one PDF**.
2. **The API is unchanged at the boundary:** it still accepts only a PDF upload and validates it by content
   (invariant 11). The browser conversion is a convenience, never a trust boundary.
3. **Per-page colour:** `PrintOptions.colourPages` (colour orders only) lists the selected pages printed in
   colour; the rest print B/W. Pricing charges each part at its own rate (`Quote.mixedColour`).
   The packet is still one PDF and one spooler job (invariant 7) in colour mode; the lease's
   `settings.greyscalePages` lists the packet pages the shop app renders in greyscale.
4. Shop apps older than **0.8.0** (0.7.0 shipped on 2026-11-22 without it) would ignore `greyscalePages` and print those pages in colour, so leasing a
   mixed-colour job from them answers `426 AGENT_UPGRADE_REQUIRED` and the job waits in the queue.

## Consequences

- Word pages and photos print as images (150 dpi): text is sharp enough for documents but not vector-crisp,
  and fonts missing on the customer's device are substituted. A Word section docx-preview cannot break is cut
  into page-high slices, which may split a line. Older `.doc` files are refused (save as `.docx` or PDF).
- No new server dependency or memory cost; the web bundle loads pdf.js, docx-preview and html2canvas-pro
  only when needed.
- Releasing mixed colour requires shop app 0.8.0 to be published before customers place such orders.
