# T10 — real-printer run (Canon G2010) + HP Smart Tank findings

- **Date:** 2026-11-07 (Asia/Kolkata)
- **PC:** the team's ASUS laptop, Windows 11 Home 10.0.26300 (working default for **D1** until the demo PC is fixed)
- **Backend:** API + web from `phase-1-vertical-slice` (local Postgres + SeaweedFS), demo payments
- **Shop app:** Release build, .NET 10, with the print-host fixes in this commit
- **Result:** **PASS** on the Canon G2010. The HP Smart Tank 580-590 never accepted a job (see below); both
  failed attempts ended safely in NEEDS_OPERATOR_CHECK with nothing printed and nothing reprinted.

## Printer under test

| Printer                      | Connection | Driver                      | Colour | Duplex                                                                        | Default paper | Reachable                               |
| ---------------------------- | ---------- | --------------------------- | ------ | ----------------------------------------------------------------------------- | ------------- | --------------------------------------- |
| Canon G2010 series           | USB001     | Canon G2010 series (vendor) | yes    | driver says yes, but it is **manual** duplex → registered as **single-sided** | A4            | `CreateIC` OK in 51 ms                  |
| HP Smart Tank 580-590 series | USB002     | Microsoft IPP Class Driver  | yes    | no                                                                            | **Letter**    | `CreateIC` fails, error 995 after ~16 s |

Registered in the shop app as: Canon G2010 — use for Kagaz, colour on, double-sided **off**, default; capabilities
not yet confirmed (B/W order only in this run).

## Steps and results (order KGZ-ZWCX8X)

| #   | Step                                                          | Result                                                                                                                                                                      |
| --- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `pnpm --filter @kagaz/api demo:order -- --pages 2 --copies 2` | Paid DEMO order, ₹8.00, PENDING_REVIEW; appears in the app's Pending tab ([01](evidence/t10-canon-g2010/01-pending-order.png))                                              |
| 2   | Accept in the shop app                                        | QUEUED → PRINTING; lease, download, SHA-256 check                                                                                                                           |
| 3   | Watch the Windows spooler                                     | **One** job `KAGAZ-KGZ-ZWCX8X-A1` (spooler id 7), **5 pages**, spooled in ~4 s, 5/5 printed ~20 s after Accept; job reported SUBMITTED → SPOOLER_COMPLETE                   |
| 4   | Inspect paper (operator)                                      | **5 × A4**: p1, p2, p1, p2, then exactly one pickup slip last — confirmed by the operator                                                                                   |
| 5   | Mark Ready                                                    | Confirm button disabled until "I have checked the printed stack and the pickup slip" is ticked ([02](evidence/t10-canon-g2010/02-mark-ready-sheet.png)); → READY_FOR_PICKUP |
| 6   | Customer tracking page                                        | "Ready for pickup" with pickup code shown                                                                                                                                   |
| 7   | Pickup: code typed lower-case with a space (`67rd pbab`)      | Normalised; "KGZ-ZWCX8X — collected" → COLLECTED ([03](evidence/t10-canon-g2010/03-pickup-collected.png))                                                                   |
| 8   | Same code again                                               | "Already collected. This code was already used for KGZ-ZWCX8X." ([04](evidence/t10-canon-g2010/04-pickup-already-used.png))                                                 |
| 9   | Wrong code `ABCD-EFGH`                                        | "No order at this shop matches this code." ([05](evidence/t10-canon-g2010/05-pickup-wrong-code.png))                                                                        |
| 10  | Customer page after pickup                                    | "Collected", code no longer shown, full 5-step timeline ([06](evidence/t10-canon-g2010/06-customer-collected.jpg))                                                          |

Server records: order events DRAFT → AWAITING_PAYMENT → PENDING_REVIEW (SYSTEM, demo payment verified) → QUEUED →
PRINTING → READY_FOR_PICKUP → COLLECTED; one `print_jobs` row (attempt 1, SPOOLER_COMPLETE, spooler job 7, packet
5 pages); audit rows `order.accepted`, `print.started`, `order.ready`, `pickup.verified`, `pickup.reused`,
`pickup.failed`.

## HP Smart Tank 580-590 (Microsoft IPP Class Driver) — did not print

1. **KGZ-KUMVBA:** the print host hung for > 2 min inside `CreateDC` (`StandardPrintController.OnStartPrint`), nothing
   in the spooler. The host was killed → app reported `UNCERTAIN … print outcome is unknown` → order
   **NEEDS_OPERATOR_CHECK**, no reprint. (Without the kill, the host's 10-minute timeout would have done the same.)
2. **KGZ-HWDRFF** (after a power cycle): `PrinterSettings.IsValid` false → refused before printing → NEEDS_OPERATOR_CHECK.
3. Diagnosis outside the app: `OpenPrinter` OK, `CreateIC` fails with **995 (operation aborted)** after ~16 s; plain
   .NET reports `IsValid=False`. The IPP class driver can't talk to the device over IPP-over-USB. Not a Kagaz bug;
   fix is HP's full driver or a working IPP-over-USB link. Note its Windows default paper is Letter — the engine's
   explicit A4 must be re-verified on it.

## Code changes from this run

- Print host prints on its `[STAThread]` main thread (`PdfiumPrintEngine.PrintOnCurrentThread`) instead of `Task.Run`.
- Installed-but-unreachable printer → new error `PRINTER_UNREACHABLE` ("installed but not responding — check it is
  on, awake and connected") instead of the misleading `PRINTER_NOT_FOUND` "not installed on this PC".

## Bugs / follow-ups found

- **Printers page:** unticking "Use for Kagaz" and saving does not disable that printer on the server
  (`PUT /api/shop/printers` only upserts), so it comes back ticked after reload.
- **Job detail at narrow window widths:** order ref is truncated under the status pill and the details column wraps
  to one word per line.
- **`demo:order` defaults to `http://localhost:4000/api`** — easy to hit the live server by mistake; default from
  `API_PORT`/`.env` instead.
- **Unreachable printer detection is slow:** a hung `CreateDC` waits for the 10-minute host timeout. A fast
  reachability probe (`CreateIC` with a short timeout) before leasing would fail fast and keep the job QUEUED.
- Colour order, the explicit-A4 path on a Letter-default driver, and T11–T14 hardware drills are still to run.
