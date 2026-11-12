# ADR-003 — Pay at counter; online payment off until Razorpay; no demo payments

- **Status:** Accepted (product owner, 2026-11-11)
- **Supersedes:** the direct-to-shop UPI design on branch `feat/youpi-upi-payments` (never merged,
  dropped) and, for customers, the simulated DEMO payment (PRD FR-PAY-02 / FR-CUST-09 banner).
- **Changes:** CLAUDE.md invariants 2–4 and 12, ADR-002 decision 1 (when the number is assigned),
  PRD §8.7 payment flow, plan P5.6.

## Context

The product is being prepared for production at real shops. A live gateway (Razorpay) needs the
merchant-of-record decision (D6, ADR-001) and provider approval, so it can't be the launch path.
Customers at a Mandya print shop already pay cash or UPI at the counter. The simulated DEMO
gateway and the "DEMO PAYMENT — NO MONEY CHARGED" banner are wrong in production, where real money
changes hands.

## Decision

1. **Two choices at checkout.** After upload and options, the customer sees the server-calculated
   total and two buttons: **Pay at counter** and **Pay online**. Pay online is disabled ("Coming
   soon") until a live gateway is configured (`GET /api/config` → `onlinePayments`).
2. **Pay at counter = one number for paying and collecting.** `POST /api/orders/:id/pay-at-counter`
   takes the immutable price snapshot (as online payment does), opens a `PENDING` payment with
   `provider = "counter"`, and gives the order its **ADR-002 daily pickup number right away**
   (same per-shop daily sequence as online orders). The customer's page shows **#7 · 12 Nov** with
   the amount to pay. The order stays `AWAITING_PAYMENT`; the shop does not print anything yet.
3. **The shop approves.** The shop app's **Counter** page lists waiting customers as "#7 · collect
   ₹X". The signed-in operator finds the number the customer shows (types it or picks the row),
   takes the money and approves (`POST /api/shop/counter-payments/:orderId/approve {pickupNumber}`).
   The server re-checks that the number belongs to that order, so a stale selection can't approve
   the wrong customer. It then runs the same exactly-once paid transition as a gateway payment
   (`AWAITING_PAYMENT → PENDING_REVIEW`, auto-accept in Auto mode); the number does not change.
   The operator is the actor, and an audit row (`payment.counter_collected`) records it. The slip
   prints the same #7, which the customer uses to collect.
4. **Abandoned requests.** The customer can cancel while waiting (no money moved). The operator can
   mark "customer left" (`…/cancel`, audited). Unpaid orders still expire after
   `UNPAID_ORDER_EXPIRY_HOURS`. In all three cases the counter payment becomes `FAILED` and the order
   `CANCELLED`.
5. **Refunds of counter payments are cash at the counter.** Rejecting a counter-paid order records
   the refund as completed immediately ("Cash refunded at the counter"). The rejecting operator
   hands the money back.
6. **No demo payments for customers.** `PAYMENT_PROVIDER` gains `none` (the default): online payment
   is off, and the API boots in production (only `demo` is refused there). The simulated `demo`
   gateway remains only as the test double for the automated suites, the load/demo scripts and the
   future Razorpay adapter's contract tests. It is never reachable from the customer UI. The DEMO
   banner shows only when `PAYMENT_PROVIDER=demo`.

## Consequences

- Invariant 2 now reads: a payment is verified by the backend only, either from a verified
  gateway webhook/status fetch, or from an operator approval with the matching counter code. A
  browser action is never proof of payment.
- Invariant 3 is unchanged for gateways. Counter payments are not a gateway and live in
  `payments/counter-payments.service.ts`; `orders/` still never imports provider code.
- **ADR-002 change:** for counter orders the pickup number is assigned when the customer chooses
  pay at counter, not at payment. A customer who leaves without paying uses up their number, so
  a day's numbers can have gaps. Numbers are still unique per `(shop, date)` and never reused.
- The number is not a secret. Someone could claim another person's number at the counter, but
  approving means the shop collected that order's exact amount. Accepted, as in ADR-002.
- Numbers restart daily. If yesterday's unpaid #3 and today's #3 both wait, lookup returns the
  most recent; the list shows the date.
- Production still needs a real OTP provider (`OTP_PROVIDER=demo` is refused in production) or
  customer sign-in turned off. That is a separate decision.
- Cash refunds completed "immediately" assume the customer is at the counter when the shop
  rejects. If shops reject later, add a "cash handed back" step.
- Realtime: counter changes reach the shop app as the existing `job.updated` hint;
  `GET /api/shop/counter-payments` is the REST source of truth (invariant 13).
