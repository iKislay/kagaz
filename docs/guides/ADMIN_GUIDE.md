# Admin guide — Kagaz dashboard

For the Kagaz team. The dashboard lives at `/admin` on the website, e.g.
`https://demo.kagaz.example/admin` (locally `http://localhost:3000/admin`).

## 1. Sign in

- Platform admin: `admin@kagaz.local`. Its password is `SEED_ADMIN_PASSWORD`, or, when that is
  unset, a random one printed **once** by `pnpm --filter @kagaz/api db:seed`. Keep it in the team's
  password manager.
- Shop owners can sign in with their staff account too. They see only **Shops** (their own shop:
  settings, hours, pricing). Every other page needs the platform admin.
- The session lasts 12 hours. Sign out on shared computers.

Sidebar: **Overview · Shops · Orders · Health · Reconciliation · Audit log · Demo controls**.

## 2. Set up a new shop (checklist)

1. **Shops** → the shop (demo shops come from the seed). Check name, address, contact phone
   (`+91…`).
2. **Hours** → opening hours.
3. **Pricing** → create the first pricing version. Without it the shop can't take orders
   (_"No pricing yet — the shop can't take orders."_).
4. **Devices** → **Generate pairing code**; give it to the shopkeeper with the server address.
5. Shopkeeper installs and pairs the app ([OPERATOR_GUIDE.md](OPERATOR_GUIDE.md),
   [SHOP_AGENT_INSTALL.md](SHOP_AGENT_INSTALL.md)) and confirms the printer.
6. **Printers** tab: the printer appears with its capabilities and "confirmed" state.
7. **Settings** → status **Open**; approval mode as the shop wants.
8. Place one test order (website, or `pnpm --filter @kagaz/api demo:order -- --api <api> --pages 2`)
   and watch it print.

## 3. Shop settings

**Settings** tab:

- **Shop status:** **Open**, **Closed** or **Maintenance**. Only Open shops take orders. Use
  Maintenance for printer repairs.
- **Approval mode:** Manual / Auto and **Pause auto-accept**. The shopkeeper normally changes this
  in the app's Settings; both places show the same value.
- **Auto-accept limits:** max pages, max copies, max printed sides, max queue depth. Larger orders
  wait for the operator even in Auto.
- **Demo shop** flag: demo shops can be wiped by `pnpm demo:reset`.

## 4. Opening hours

**Hours** tab: one row per weekday (Asia/Kolkata time). Add one or more intervals per day (e.g.
09:00–13:00 and 15:00–20:00), remove one with **Remove interval**. A day with no interval is
**Closed**. Save.

Outside opening hours Auto doesn't accept orders; they wait in Pending.

## 5. Pricing versions

Prices are never edited in place. Each change is a **new version** with an "effective from" time.

**Pricing** tab → **New pricing version**:

| Field                        | Notes                                                                                    |
| ---------------------------- | ---------------------------------------------------------------------------------------- |
| B/W per side (₹)             | Rupee amounts like `2` or `2.50`. Stored as integer paise.                               |
| Colour per side (₹)          |                                                                                          |
| Duplex rule                  | **Same rate** (double-sided costs the same per side) or **Discounted** (separate rates). |
| B/W / Colour duplex side (₹) | Only for Discounted.                                                                     |
| Minimum charge (₹)           | Smallest order total.                                                                    |
| Effective from               | Blank = now. A future time is shown as **Scheduled**.                                    |

Click **Create version**. **Versions** lists Current, Scheduled and Past versions.

Customers who are about to pay when the price changes see the new price first. Orders already
paid keep their price (it is stored on the order).

## 6. Printers

**Printers** tab (admin only): printers registered by the shop app, with colour/duplex,
**Not confirmed** / confirmed, status and last report. Capabilities are set and confirmed by the
operator in the app. If a printer can't really do double-sided (e.g. Canon G2010, manual duplex),
make sure the operator has it unticked.

## 7. Devices, pairing codes, revoke

**Devices** tab (admin only):

- **Pair a shop PC → Generate pairing code.** Shown once, single use, expires after 30 minutes.
  Only a hash is stored. Send it to the shopkeeper by phone, not in a group chat.
- **Recent pairing codes** — created, state, expiry, used.
- **Devices** — name, health (Online / Stale / Offline), app version, last heartbeat, operator
  signed in.
- **Revoke → Confirm revoke** — stops that PC at once and signs the operator out. Use when a PC is
  lost, replaced or compromised. The PC must be paired again with a new code.

## 8. Health

**Health** shows each shop's PC and printers: online (heartbeat within 45 s), stale (up to 5 min)
or offline, app version (an **Update** pill when below `MIN_AGENT_VERSION`), printer status, last
report and queue length. Check it before a demo and when a shop calls.

## 9. Orders

**Orders**: search by reference (`KGZ-7H3K2Q`), filter by shop and status. Open an order for the
full history: **Event history** (every status change with actor), **Payments & refunds**, **Print
jobs** (attempts, spooler job id, errors) and **Audit**.

Reject-and-refund and refund retry exist as admin API actions (no button yet):
`POST /api/admin/orders/:id/reject` and `POST /api/admin/orders/:id/refund`. See
[SUPPORT_RUNBOOK.md](../runbooks/SUPPORT_RUNBOOK.md#3-refunds).

## 10. Overview (dashboard)

**Overview** for a date range (Asia/Kolkata days): orders, paid, collected, rejected, median
paid → ready and ready → collected times, orders per day, by shop, by status, and printer uptime.

## 11. Reconciliation

**Reconciliation** compares payments, orders and refunds for a date range and shop. Totals: Paid,
Refunded, Net, Mismatches. Flags:

| Flag                     | Meaning                                                     | Action                                             |
| ------------------------ | ----------------------------------------------------------- | -------------------------------------------------- |
| Paid, no progress        | Paid but still waiting after the "stuck for" hours you set. | Call the shop; see support runbook §1.             |
| Rejected without refund  | Rejected after payment, no refund record.                   | Retry the refund (§9).                             |
| Refund without rejection | Refund exists but the order wasn't rejected.                | Investigate in the order history; escalate.        |
| Refund status mismatch   | Refund outcome and order/payment state disagree.            | Retry refund or escalate to the developer on call. |

"No mismatches — payments, orders and refunds agree." is the goal at the end of each day.

## 12. Audit log

**Audit log**: every human action, setting change and device event (who, what, when). Filter by
actor or action (e.g. `order.accepted`, `device.revoked`).

## 13. Demo controls (demo environments only)

Hidden with _"Demo controls are turned off in this environment."_ outside demo/local.

- **OTP inbox** — sign-in codes sent by the demo OTP provider (no SMS is sent). Read the code to
  the person signing in. Refreshes every 3 s.
- **Payment outcome per order** — choose the next demo payment result for an order: Success, Fail,
  Pending, Duplicate webhook, Out-of-order webhooks. Applies once, then resets to Success. Use it to
  show failure handling.

Command-line helpers (from the repo, pointed at the right API/DB):

- `pnpm demo:reset` (dry run) / `pnpm demo:reset -- --yes` — deletes orders of demo shops only.
  Refused when `APP_ENV=production`.
- `pnpm sim:agent -- --shop demo-shop-b` — a simulated shop PC for shops without a real printer.
  Never run it for the shop with the real printer.

Full demo script: [DEMO_RUNBOOK.md](../demo/DEMO_RUNBOOK.md). Never say a demo payment is real.
