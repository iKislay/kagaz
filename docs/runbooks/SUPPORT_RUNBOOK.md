# Support runbook

For the Kagaz team member answering a shop's or customer's call. Start with the order reference
(`KGZ-XXXXXX`) or the shop name, open the admin dashboard, and work through the matching section.

Ground rules (from the PRD — don't work around them):

- **Never reprint for the shop from the server or database.** Reprints happen only in the shop app,
  with the operator's two-step confirmation. No silent duplicates.
- **Never change `orders.status` (or any status) with SQL.** All status changes go through the API
  so the event history, audit and realtime hints stay correct.
- **Never mark a payment paid by hand.** Only the provider's verified webhook/status check does it.
- Don't paste tokens, pairing codes, signed URLs or customer phone numbers into chat or tickets.

Useful read-only places: admin **Orders → order** (Event history, Payments & refunds, Print jobs,
Audit), **Health**, **Reconciliation**, **Audit log**; the shop PC's logs (app **Settings →
Troubleshooting → Open logs folder**, `%LOCALAPPDATA%\Kagaz\logs`); API logs (pino JSON, search by
`orderId` / `shopId` / `printJobId`).

## 1. Stuck jobs

First find which state the order is stuck in (admin order page, top pill and Event history).

| Stuck in                    | Likely cause                                                                                                                               | Fix                                                                                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AWAITING_PAYMENT`          | Customer didn't finish paying, or payment is pending at the provider.                                                                      | Nothing to do; unpaid orders expire after 24 h. In demo, check Demo controls didn't leave a **Pending/Fail** outcome set.                                                     |
| `PENDING_REVIEW` (Manual)   | Nobody accepted it. App offline or no operator signed in.                                                                                  | Health: is the shop PC online? Call the shop: sign in, Jobs → **Pending** → Accept or Reject.                                                                                 |
| `PENDING_REVIEW` (Auto)     | An auto-accept check failed (shop closed/outside hours, printer offline or unconfirmed, options unsupported, over limits, queue too long). | Event history shows the failing reason (`order.auto_accept_failed`). Fix the cause or ask the operator to accept by hand.                                                     |
| `QUEUED` for minutes        | App offline, **Pause printing** on, printer lease held by another job, no enabled printer that can do the options.                         | Health → device online? printer status? Ask the operator: is Pause printing on? Is the printer ticked **Use for Kagaz** and confirmed? Is the job ahead of it in Needs check? |
| `PRINTING` for a long time  | Printer slow/jammed; app lost contact.                                                                                                     | If the app stops renewing the lease (60 s), the server moves the job to `NEEDS_OPERATOR_CHECK` by itself. Don't intervene before that. Then see §2.                           |
| `READY_FOR_PICKUP` for days | Customer hasn't come.                                                                                                                      | Normal end state under ADR-002. Files are deleted by retention; the order stays.                                                                                              |

Read-only SQL helper (psql against the environment's DB) for a shop-wide view:

```sql
SELECT o.public_ref, o.status, o.updated_at, pj.attempt, pj.status AS job_status, pj.error
FROM orders o
LEFT JOIN print_jobs pj ON pj.order_id = o.id
JOIN shops s ON s.id = o.shop_id
WHERE s.slug = 'demo-shop-a'
  AND o.status IN ('PENDING_REVIEW','QUEUED','PRINTING','NEEDS_OPERATOR_CHECK')
ORDER BY o.updated_at;
```

## 2. Needs check (`NEEDS_OPERATOR_CHECK`)

Causes: printer error or jam, print failed, outcome unknown (app/PC restarted mid-print, printer
stopped answering, lease expired). Print job status `FAILED` or `UNCERTAIN`; the error is on the
admin order page under **Print jobs**.

Talk the operator through it (details in [OPERATOR_GUIDE.md](../guides/OPERATOR_GUIDE.md#7-needs-check-and-safe-reprint)):

1. Fix the printer first (paper, jam, power, cable). Print a Windows test page.
2. Look at the output tray for that pickup number's slip and pages.
3. Choose in Jobs → **Needs check**:
   - all pages + slip there → **Confirm printed…** → order Ready;
   - incomplete → **Reprint…** (two confirmations) → new attempt, same pickup number. Remove
     the partial pages;
   - can't print at all → **Mark failed…** → customer refunded.

If the shop can't be reached and the customer is waiting: an admin can reject the order and
refund it (§3). Never reprint on the shop's behalf.

## 3. Refunds

Refunds are automatic when the operator rejects a paid order or marks a print failed. Order goes
`REJECTED → REFUND_PENDING → REFUNDED`. In demo the refund is simulated ("Demo refund — no money
moved").

Check: admin order page → **Payments & refunds**; **Reconciliation** for the day.

**Admin reject + refund** (order in `PENDING_REVIEW`, `QUEUED` or `NEEDS_OPERATOR_CHECK`, shop
can't handle it). There is no button yet; use the API with an admin session. `ORDER_ID` is the UUID
in the admin order page URL.

```bash
API=https://api.demo.kagaz.example/api
curl -s -c admin.cookie -H 'content-type: application/json' \
  -d '{"email":"admin@kagaz.local","password":"<from password manager>"}' $API/admin/auth/login
curl -s -b admin.cookie -H 'content-type: application/json' \
  -d '{"reasonCode":"PRINTER_UNAVAILABLE","note":"Shop printer down, refunded by Kagaz"}' \
  $API/admin/orders/$ORDER_ID/reject
```

Reason codes: `FILE_UNREADABLE`, `CONTENT_NOT_ALLOWED`, `PRINTER_UNAVAILABLE`,
`OPTION_UNSUPPORTED`, `SHOP_CLOSING`, `OUT_OF_SUPPLIES`, `PRINT_FAILED`, `OTHER`.

**Refund failed / stuck in `REFUND_PENDING`, or Reconciliation shows "Rejected without
refund":** retry (safe to repeat; it never refunds twice):

```bash
curl -s -b admin.cookie -X POST $API/admin/orders/$ORDER_ID/refund
```

Delete `admin.cookie` afterwards. "Refund without rejection" or "Refund status mismatch" flags
→ don't retry blindly; open an incident ([INCIDENT_CHECKLIST.md](INCIDENT_CHECKLIST.md)).

Live payments are gated by decision D6; until then every refund is a demo refund.

## 4. Device re-pair

When: new PC, Windows reinstalled, app says _"An administrator revoked this PC's access"_, or
`DEVICE_UNAUTHORIZED` errors, or a PC was lost/stolen.

1. Admin → Shops → shop → **Devices**. If the old PC is still **Active** and shouldn't be, click
   **Revoke → Confirm revoke** (stops it at once, signs out the operator).
2. **Generate pairing code** (single use, 30 min). Give it to the shopkeeper by phone.
3. On the PC: if the app is still paired to the old identity, **Settings → Unpair this PC** (or
   delete `%LOCALAPPDATA%\Kagaz\` with the app closed). Then **Pairing**: server address, code,
   PC name → **Pair this PC**.
4. Operator signs in, opens **Printers**, re-confirms the printer, **Save printers**.
5. Health shows the new device **Online**. Place a small test order.

Jobs that were printing on the old PC go to Needs check; resolve them on the new PC as in §2.

## 5. Printer unreachable

Symptoms: job errors `PRINTER_UNREACHABLE` (_"installed but not responding — check it is on, awake
and connected"_), `PRINTER_NOT_FOUND`, printer status offline on **Health**, orders going to Needs
check right after printing starts.

Checklist with the shopkeeper:

1. Printer powered on, not asleep, no error light, paper loaded.
2. Cable/Wi-Fi: reconnect USB; for Wi-Fi printers check it's on the same network.
3. Windows: Settings → Bluetooth & devices → Printers & scanners → printer → **Print test page**.
   If Windows can't print, Kagaz can't either.
4. Print queue empty of stuck non-Kagaz jobs (don't cancel an active `KAGAZ-…` job without
   checking the tray).
5. Printer name unchanged: if it was reinstalled under a new name, re-tick it in the app's
   **Printers** and confirm again.
6. Resolve any orders in Needs check (§2).

### HP printers on the Microsoft IPP Class Driver (error 995)

Seen in T10 with an **HP Smart Tank 580-590** connected by USB
([T10 report](../testing/T10-real-printer-canon-g2010.md)):

- Windows installed it with **"Microsoft IPP Class Driver"** (Printer properties → Advanced →
  Driver).
- The printer shows as installed, but opening it for printing fails: `CreateIC` returns **error
  995 (operation aborted)** after ~16 s, .NET reports the printer settings as invalid, or the print
  host hangs until its timeout.
- Kagaz behaves safely: the job becomes `UNCERTAIN`/`FAILED`, the order goes to Needs check,
  nothing is printed and nothing is reprinted.

Fix: this is a driver problem, not Kagaz. Install **HP's full driver** for the model (HP Smart /
HP support site), or fix the IPP-over-USB connection, then print a Windows test page. The IPP class
driver also defaults to **Letter** paper — after installing, set A4 as the default and check the
Kagaz test print comes out A4. Then resolve the Needs-check orders (usually **Reprint**, since
nothing printed). Until fixed, set the printer's **Use for Kagaz** off or the shop to Maintenance.

### Wrong output (double-sided or colour)

If a double-sided order came out one side per sheet, or with every second page missing, the
printer is probably manual-duplex (e.g. Canon G2010). Ask the operator to untick **Prints
double-sided** and save. Mark the affected order failed (refund) or reprint only if the printer
really can do it.

## 6. Customer questions

| Question                  | Answer                                                                                                                                                                                              |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "I lost the order page."  | If they signed in with their number: **My orders**. Otherwise they need the tracking link (it can't be re-sent). The shop can still find the packet in **Today's pickups** by time and job summary. |
| "Someone took my copies." | Check the order's Event history and the shop's Ready list; ask the shop. Pickup numbers aren't verified (ADR-002) — record the case and tell the team.                                              |
| "I didn't get the OTP."   | Demo: read it from Demo controls → OTP inbox. Wait 5 min after too many attempts.                                                                                                                   |
| "Is my money taken?"      | In demo, no: payments and refunds are simulated.                                                                                                                                                    |

## 7. App problems on the shop PC

| Symptom                          | Fix                                                                                                                                    |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| "Kagaz Shop is already running." | Switch to its window from the taskbar. If hung, end it in Task Manager and reopen. Jobs mid-print go to Needs check — that's expected. |
| **Update required**              | **Install update** in the sheet. No new prints until updated.                                                                          |
| "Can't reach the Kagaz server."  | Check internet. Check the API health from your side. The app retries by itself.                                                        |
| SmartScreen blocks install       | See [SHOP_AGENT_INSTALL.md](../guides/SHOP_AGENT_INSTALL.md#unsigned-builds-and-smartscreen).                                          |

Escalate anything not covered here with [INCIDENT_CHECKLIST.md](INCIDENT_CHECKLIST.md).
