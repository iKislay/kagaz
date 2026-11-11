# ADR-003 — Direct-to-shop UPI with YouPI payment detection (default provider)

- **Status:** Accepted (product owner, 2026-11-11)
- **Resolves:** D6 for the UPI path (ADR-001 option A: **each shop is the merchant of record**).
  Razorpay/Cashfree (P3.9) stay possible later behind the same `PaymentProvider` boundary.
- **Licence:** YouPI-PG (`github.com/youpi-pg/YouPI-PG`, `package.json` says `"Commercial"`, no
  LICENSE file in the repo). The authors gave verbal permission; **written permission must be on
  file before any real-money use.** Kagaz does not vendor YouPI code: it runs YouPI as a separate
  service and talks to its HTTP API.

## Context

Shops in Mandya already take UPI to their own VPA (PhonePe / GPay / Paytm for Business, bank
apps), usually with a soundbox that reads out each credit. A gateway costs 2–3 % and needs KYC
per shop. YouPI-PG is a self-hosted gateway that shows the customer a UPI QR / app link for the
**shop's own VPA** and **detects** the credit from the bank / UPI-app alert, then sends a signed
webhook. No money passes through Kagaz or YouPI.

Highest priority from the product owner: **shopkeeper setup must be as simple as possible.**

## Decision

1. **`youpi` is the default `PAYMENT_PROVIDER`.** `demo` stays for local/tests/investor demo.
2. **Shop setup is two steps in the Kagaz Windows app** (Settings → Payments):
   1. type the UPI ID (and the name customers see);
   2. scan one QR with the phone that already gets the shop's UPI alerts — this installs/pairs the
      YouPI Android observer app (SMS + payment-app notifications).
      Kagaz does everything else server-side: creates the YouPI merchant, generates its API key and
      webhook secret (stored AES-256-GCM encrypted in Kagaz, never shown to anyone), registers
      Kagaz's webhook URL, and activates the VPA. A status dot shows whether the phone is online.
      Gmail detection is optional and not part of the default setup (bank e-mails are often missing
      or late; Gmail's restricted scope needs Google verification beyond 100 users).
3. **What counts as paid.** YouPI reports `OBSERVED_SUCCESS` when a bank/UPI alert matched the
   session (amount + time window, one payer per VPA at a time). Kagaz treats `OBSERVED_SUCCESS`
   (and `RECONCILED`) for `method=UPI` as **PAID** and releases the job. This is weaker than a
   gateway-confirmed payment; it is accepted because amounts are small (₹2–₹500), the shop sees the
   same credit on its own soundbox/app, and the fallback below exists. The webhook is still
   verified over the raw body (HMAC-SHA256, timestamped V2 signature), deduplicated by delivery id,
   and its amount must equal the order's price snapshot (invariants 1–2 unchanged).
4. **Fallback when the alert is late or missing — customer reports, shop approves.** If the
   checkout times out or stays unconfirmed, the customer can **report the payment** on the order
   page with the 12-digit UPI reference (UTR). The claim appears in the shop app; the operator
   checks their UPI app/bank and taps **Approve** or **Decline**. Approve marks the payment PAID
   through the same exactly-once paid transition (`PaymentsService.markPaid`), with the UTR as
   the payment reference, the operator as actor and an audit row. It is a fallback, not the normal
   path: claims are only possible after the automatic check had its chance, one open claim per
   order, at most 3 claims per order, a UTR can be used once per shop, and no new payment attempt
   can start while a claim is open.
5. **Refunds are manual.** YouPI cannot move money. A refund (rejected paid order) is opened as
   usual (`REFUND_PENDING`); the shop returns the money from their UPI app and confirms it in the
   shop app, which completes the refund (audited). The customer page says the shop will refund.
6. **Mismatches and ambiguity never print.** `MANUAL_REVIEW` from YouPI (two sessions could match
   an alert) stays PENDING in Kagaz; the customer can report, the shop decides.

## Consequences

- `PaymentProvider.createPayment` now receives `shopId` and `returnUrl`; providers declare
  `refundMode: 'API' | 'MANUAL'`. Demo keeps `API` behaviour.
- New tables `shop_payment_accounts` (per-shop provider credentials, encrypted) and
  `payment_claims` (customer reports + shop decisions). Both are shop-owned (tenant guard).
- New env: `YOUPI_API_URL`, `YOUPI_ADMIN_TOKEN`, `PUBLIC_API_URL` (webhook target),
  `PAYMENT_SECRETS_KEY` (32-byte base64 AES key). Boot fails if `PAYMENT_PROVIDER=youpi` and any is
  missing. `PAYMENT_PROVIDER=youpi` is LIVE mode: no DEMO banner.
- One payer per VPA at a time (YouPI's queue) limits throughput at rush hour. Revisit with
  unique-paise amounts if queues become a problem (needs a pricing decision).
- The observer phone is now operationally critical: it must stay on, online and exempt from
  battery optimisation. The shop app and admin show its last heartbeat.
- YouPI's own guidance is "experimental, ≤ 20 payments/day/VPA for experiments". Fine for the
  pilot (3 shops, 100–200 orders); re-assess with the bank before scaling.
- Follow-ups in YouPI (reported upstream, not patched here): the Android pairing QR embeds a
  gateway-wide enrollment secret, and the device list for a merchant also includes the default
  merchant's devices.
