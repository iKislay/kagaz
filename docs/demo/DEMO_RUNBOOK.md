# Investor demo runbook (P1.11)

A 2–3 minute live run of PRD §18: browser order → mock payment → Windows app → real printer →
pages + one pickup slip → READY → pickup code → COLLECTED, then the admin view of three shops.

**Never claim a simulated payment is real.** Script line: _"The payment layer is
provider-independent. This demo uses a mock provider; the same adapter contract will be connected
to an approved live gateway after merchant onboarding and settlement design."_

Where it runs: **locally on the demo laptop** (API + web + Postgres + SeaweedFS in Docker, Windows
app on the printer PC) unless a demo environment has been deployed (docs/runbooks/DEPLOYMENT.md).
Write down which one you use on the day.

## 1. Pre-flight checklist (T-30 min)

**Printer + PC (Shop A)**

- [ ] Printer on, online in Windows, **A4 paper loaded (≥ 50 sheets)**, toner/ink OK, no queued
      jobs in the Windows print queue (Settings → Printers → Open queue → empty).
- [ ] One test page from Windows printed cleanly; duplex works if you'll show double-sided.
- [ ] Kagaz shop app running, **paired to Demo Shop A**, status "Online", printer listed with
      confirmed capabilities and set as default. Operator signed in (if operator login is enabled).
- [ ] Sound on (new-order chime) and the app window visible next to the browser.

**Platform**

- [ ] `pnpm infra:up` → Postgres + SeaweedFS healthy; `pnpm dev` running.
- [ ] `GET http://localhost:4000/api/health` → `{"status":"ok","db":"ok","storage":"ok"}`.
- [ ] Website shows the amber **"DEMO PAYMENT — NO MONEY CHARGED"** banner.
- [ ] All three demo shops **OPEN** and listed on the home page (Shop A in MANUAL mode).
- [ ] Shops B and C have simulated agents running so the admin dashboard shows three live shops:
      `pnpm sim:agent -- --shop demo-shop-b` and `pnpm sim:agent -- --shop demo-shop-c`
      (separate terminals; never run a sim agent for Shop A — it would register a fake printer there).
- [ ] Admin dashboard signed in (`admin@kagaz.local`) in a second browser tab.

**Demo data reset** (clean queue, no leftover orders on screen)

- [ ] `pnpm demo:reset` (dry run: shows what would go) → `pnpm demo:reset -- --yes`.
      Deletes orders of **demo shops only**; refuses when `APP_ENV=production`. Shops, staff,
      paired devices and printers are kept.
- [ ] Optional warm-up order end to end (`pnpm --filter @kagaz/api demo:order -- --pages 2`), print,
      Mark Ready, verify pickup — then reset again.
- [ ] Sample PDF ready on the desktop: 3 pages, no personal data.
- [ ] Phone/tablet with the order page optional; screen recorder ready (keep a fallback recording).

## 2. The script (PRD §18)

| Time      | Do                                                                                                                                        | Say / prove                                            |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| 0:00–0:20 | Open the website; show the three Mandya shops; pick **Demo Shop A — College Road**.                                                       | Multi-shop customer entry point.                       |
| 0:20–0:45 | Upload the 3-page PDF; **2 copies, B/W, double-sided**; show the server-calculated price.                                                 | Real order creation; price comes from the server.      |
| 0:45–1:00 | Click **Pay**; demo provider approves; point at "DEMO — NO MONEY CHARGED". Say the script line above.                                     | Payment adapter works without claiming a live payment. |
| 1:00–1:25 | Switch to the Windows app: the order appeared by itself (realtime). **Accept** → it prints.                                               | Cloud-to-local dispatch and operator workflow.         |
| 1:25–1:50 | Pick up the stack: customer pages, then **one pickup slip at the end** with the order code.                                               | Real printer execution, one packet = one job.          |
| 1:50–2:15 | Back to the website: **READY** + pickup code (after **Mark Ready** in the app). Type the code in the app's Verify Pickup → **Collected**. | Human-confirmed READY; verified one-time handover.     |
| 2:15–2:45 | Admin dashboard: 3 shops, separate queues, devices/printers online, the order's full history.                                             | Platform structure and extensibility.                  |

Mark Ready needs the operator's confirmation ("I have checked the printed stack and the pickup
slip") — that's intentional (READY needs a human), call it out.

## 3. Recovery (stay calm, narrate it as a feature)

| Symptom                                     | Do this                                                                                                                                                                                |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Order doesn't appear in the app within ~3 s | Wait up to 10 s (the app also polls). Still nothing: check the app shows Online; click Refresh. Check the API terminal for errors.                                                     |
| Website status doesn't change               | It refreshes on a socket hint plus every 30 s; reload the page (the tracking link keeps the token).                                                                                    |
| Printer jam / paper out mid-print           | Fix the printer. The order goes to **Needs check** — never reprints by itself. Choose **Reprint** (confirm) or **Confirm printed** after looking at the stack. "No silent duplicates." |
| App crashed / PC restarted                  | Reopen the app; it reconciles: a submitted job becomes **Needs check**, nothing is reprinted automatically. Resolve as above.                                                          |
| Wrong pickup code typed                     | Shows "invalid code"; re-type (codes avoid 0/O and 1/I). Repeated failures are rate-limited — mention that.                                                                            |
| Payment step errors                         | Click Pay again (idempotent — never double charges). If the API is down: restart `pnpm dev`, then continue from the order page.                                                        |
| Total failure                               | Switch to the fallback recording; offer to rerun after the meeting.                                                                                                                    |
| Need a clean slate between runs             | `pnpm demo:reset -- --yes` (demo shops only), refresh the app and the website.                                                                                                         |

## 4. After the demo

- [ ] `pnpm demo:reset -- --yes`; stop sim agents (Ctrl+C).
- [ ] Shred printed demo stacks (they carry order codes).
- [ ] Note any glitch in `docs/testing/` with the time so it can be reproduced.

## 5. Rehearsal log (Done when: 3 clean runs in a row without developer intervention)

| Date | Where (local / demo env) | Run 1 | Run 2 | Run 3 | Notes |
| ---- | ------------------------ | ----- | ----- | ----- | ----- |
|      |                          |       |       |       |       |
