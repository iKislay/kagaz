# ADR-004: Shop subscriptions per connected printer

- Status: accepted (2026-11-12)
- Context: Kaggaz is sold to shops as a subscription priced by how many printers a shop connects (the count, not
  a particular printer). For now Kaggaz collects the money by hand (cash, UPI, bank transfer) and records it in
  /superadmin; later shops will subscribe through Razorpay.

## Decision

1. **Subscription** = one paid-for period of a plan: `printerSeats`, `pricePerPrinterPaise` (per month),
   `months`, `periodStart` (IST midnight of the chosen day) and `periodEnd` (same day-of-month `months` later,
   clamped at month end), `totalPaise = seats × price × months` fixed at creation. Renewal is a new row starting
   where the last one ends. Non-cancelled periods of one shop never overlap (checked under a shop row lock).
   Rows are never edited except to cancel (`cancelledAt`, `cancelledById`, `cancelReason`).
2. **SubscriptionPayment** = append-only ledger (amount, method CASH/UPI/BANK_TRANSFER/CHEQUE/OTHER, UTR/receipt
   reference, received date, who recorded it). Mistakes are fixed with a negative correction row; balance =
   total − sum of payments. Nothing is deleted.
3. A shop's **entitlement** at time t is the non-cancelled subscription whose `[periodStart, periodEnd)` contains t.
   Status ACTIVE / EXPIRED (had a plan that ended) / NONE.
4. **Enforcement** behind `BILLING_ENFORCED` (default off, set on in production when shops are on plans):
   - no current subscription → the shop is listed but not accepting orders, and new orders / first payments are
     refused with `SUBSCRIPTION_INACTIVE` (orders already paid are never blocked);
   - enabled printers ≤ seats: the shop app's "Use for Kaggaz" set (`PUT /api/shop/printers`) and admin printer
     enable are refused with `PRINTER_LIMIT_REACHED`, rolling the change back.
5. The heartbeat response carries `subscription { status, printerSeats, periodEnd, daysLeft }` for the shop app.
6. /superadmin (Kaggaz admins only): Billing page (all shops, needs-attention sort, collected this month, balance
   due) and a Subscription tab per shop (create/renew, record payment or correction, cancel, full history).
   Every write is audited in the same transaction.

## Consequences

- Razorpay later writes the same two tables (`source = RAZORPAY`, `method = RAZORPAY`, `reference` = the provider
  payment id). Add a unique index on `(method, reference)` for RAZORPAY rows in that migration so a webhook
  retry can't double-record a payment.
- Prices are per printer per month; discounts are expressed by the price or a note, not a separate engine.
