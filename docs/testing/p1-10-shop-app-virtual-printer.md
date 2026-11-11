# P1.9 / P1.10 — Windows shop app, end-to-end run on a virtual printer

- **Date:** 2026-11-06 (Asia/Kolkata)
- **Build:** `apps/shop-agent` Release, .NET 10 — `dotnet build -c Release` 0 warnings, `dotnet test` 57/57 passed
- **Backend:** API from `phase-1-vertical-slice` @ `c7cd8db` (local Postgres + SeaweedFS), `db:seed`, demo payments
- **Printer:** _Microsoft Print to PDF_ (virtual). **Not** a physical printer — the real-printer run (T10) is still
  open and blocked on decision **D1** (demo PC + printer model).

## Steps and results

| #   | Step                                                                           | Result                                                                                                                                        |
| --- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Launch app with empty `%LOCALAPPDATA%\Kagaz`                                   | Opens on Pairing; sidebar shows "Server reachable · not paired"                                                                               |
| 2   | Pair with seed enrollment code (typed lower-case with dash), name "Counter PC" | Paired with _Kagaz Demo Shop A_; token saved with DPAPI; DEMO notice bar shown; jumps to Printers                                             |
| 3   | Use _Microsoft Print to PDF_, confirm capabilities, default → Save             | `PUT /api/shop/printers` OK; heartbeat now sends that printer's server id                                                                     |
| 4   | `pnpm --filter @kagaz/api demo:order -- --pages 3 --copies 2`                  | Order appears in **Pending** on the next poll (5 s interval; seen 0.6 s after switching to Jobs) with toast + sound                           |
| 5   | Accept                                                                         | Order → QUEUED; worker leases, downloads, verifies SHA-256, prints **one** spooler job `KAGAZ-<ref>-A1`, reports SUBMITTED → SPOOLER_COMPLETE |
| 6   | Inspect output PDF                                                             | **7 pages**: customer pages 1-2-3, 1-2-3, then exactly one pickup slip last (`05-printed-packet.png`)                                         |
| 7   | Mark Ready                                                                     | Confirm button stays disabled until "I have checked the printed stack and the pickup slip" is ticked; order → READY_FOR_PICKUP                |
| 8   | Pickup: enter slip code as `xxxx-xxxx` lower-case                              | "collected" — order → COLLECTED                                                                                                               |
| 9   | Pickup: same code again                                                        | "Already collected. This code was already used for KGZ-…" (`PICKUP_ALREADY_USED`)                                                             |
| 10  | Reject another pending order (reason "Out of paper or toner")                  | Reject disabled until a reason is picked; order → REJECTED; toast "Demo refund — no money moved"                                              |

## Crash recovery (A.3) — observed for real

While printing in-process, capturing the window with `PrintWindow` made the app fail-fast (`0xc0000409`,
CFG check in an unknown module; WPF D3D renderer, GDI+, the XPS print driver and PDFium all in one process).
Reproduced twice. Each time, on restart, reconciliation found the attempt in local phase `SUBMITTING` with no
spooler job and reported it `FAILED` ("UNCERTAIN: … could not confirm this print") → order NEEDS_OPERATOR_CHECK.
**No attempt was reprinted.**

Fix: printing now runs in a separate `Kagaz.ShopAgent.PrintHost.exe` (`OutOfProcessPrintEngine`). With it, 20
window captures taken during a print did not affect the app, and the job completed normally.

## Evidence

Screenshots in [`evidence/p1-10-shop-app/`](evidence/p1-10-shop-app/) (window captures via `PrintWindow`):
pairing, printers, pending job, printed packet (7 pages, slip last), Mark Ready sheet, ready, pickup success,
pickup already used.

## Not covered here

- Physical printer output, duplex flip edge, colour, margins/scaling (T10–T14) — needs D1.
- SumatraPDF fallback engine (A.4) — not implemented; only needed if PDFium misbehaves on the chosen printer.
