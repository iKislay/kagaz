# Incident checklist

Use this when something affects more than one order, more than one shop, money, or customer data.
For a single stuck order use [SUPPORT_RUNBOOK.md](SUPPORT_RUNBOOK.md) instead.

## Severity

| Level  | Examples                                                                                                                          | Response          |
| ------ | --------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| **S1** | Possible data leak (files, phone numbers, tokens). Duplicate prints or wrong-shop prints. Money mismatch. API down for all shops. | Now. Whole team.  |
| **S2** | One shop can't print for > 15 min. Payments failing. Realtime broken (orders arrive late).                                        | Within 30 min.    |
| **S3** | Cosmetic, one PC, workaround exists.                                                                                              | Next working day. |

## 1. First 10 minutes

- [ ] Note the time (Asia/Kolkata) and who is handling it. One person leads.
- [ ] What is affected: which shops, which orders (references), since when?
- [ ] Check `GET /api/health` (503 names the failing dependency: `db` or `storage`).
- [ ] Admin **Health**: shop PCs and printers online?
- [ ] API logs: errors around the start time (search `requestId`, `orderId`, `shopId`).
- [ ] Is it a demo environment during an investor demo? Switch to the fallback recording
      ([DEMO_RUNBOOK.md](../demo/DEMO_RUNBOOK.md)).

## 2. Contain

Pick what fits; prefer the smallest safe step.

- [ ] **Stop new orders at a shop:** admin → Shops → shop → Settings → status **Maintenance**.
- [ ] **Stop auto-printing:** ask the shop to turn on **Pause auto**, or **Pause printing** in the
      app. Accepted orders then wait safely.
- [ ] **Compromised or lost shop PC:** admin → Devices → **Revoke**.
- [ ] **Leaked secret:** rotate it in the secret manager and redeploy (`SESSION_JWT_SECRET` signs
      everyone out; S3 keys: create new, deploy, then delete old).
- [ ] **Bad release:** roll back to the previous image. Migrations are forward-only and
      backward-compatible, so the previous API runs on the new schema.
- [ ] **Database damaged / bad data:** stop writes (all shops Maintenance), then follow
      [BACKUP_RESTORE.md](BACKUP_RESTORE.md) point-in-time restore to a **new** instance.

Do **not**: edit order/payment statuses in SQL, reprint from the server, delete
`print_jobs`/`webhook_events`/unique constraints to "unstick" things, or make the bucket public.

## 3. Check the invariants

- [ ] **Duplicate prints?** Admin order → **Print jobs**: more than one attempt without an
      operator reprint in **Audit** is an S1 bug.
- [ ] **Money:** **Reconciliation** for the affected days → mismatches? Every rejected paid order
      has a refund?
- [ ] **Tenant isolation:** any shop seeing or printing another shop's order → S1.
- [ ] **Demo labels:** in demo, the amber **DEMO PAYMENT — NO MONEY CHARGED** bar visible on the
      website and app.
- [ ] **Data exposure:** logs, tickets or chats containing signed URLs, tokens, pairing codes or
      phone numbers → delete them and treat as a possible leak.

## 4. Recover

- [ ] Fix the cause (printer, network, config, code).
- [ ] Shops back to **Open**; Pause auto / Pause printing off.
- [ ] Walk each affected shop through **Needs check** ([OPERATOR_GUIDE.md §7](../guides/OPERATOR_GUIDE.md#7-needs-check-and-safe-reprint)).
- [ ] Refund orders that can't be printed ([SUPPORT_RUNBOOK.md §3](SUPPORT_RUNBOOK.md#3-refunds)).
- [ ] Place one test order per affected shop and watch it to Ready.
- [ ] Reconciliation shows no new mismatches.

## 5. Communicate

- [ ] Shops: what happened, what they should do, when it's fixed. Phone call for S1/S2.
- [ ] Customers with affected orders: their order page already shows status and refunds. For S1
      data issues, agree the message with the product owner before sending anything.
- [ ] Payment provider / legal: only for live money or personal-data incidents (not in demo).

## 6. Afterwards (within 2 working days)

- [ ] Write a short report in `docs/testing/incidents/YYYY-MM-DD-<topic>.md`: timeline, impact
      (orders, shops, money), cause, what was done, follow-ups.
- [ ] File follow-ups (tests, alerts, runbook changes). Update this checklist or the support
      runbook if a step was missing.
