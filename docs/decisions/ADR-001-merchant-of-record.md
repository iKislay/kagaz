# ADR-001 — Merchant of record and settlement model

- **Status:** **Pending** — business decision **D6** not yet made
- **Owner:** business team (founders, with the accountant and the chosen payment provider)
- **Engineering contact:** payments workstream
- **Date opened:** 2026-11-07 · **Decide before:** any live-gateway work (stage P3.9)
- **References:** [PRD §8.7, §8.8, §20 D6](../PRD.md), [Implementation plan P3.8 / P3.9](../IMPLEMENTATION_PLAN.md)

## Context

Kagaz takes payments for print orders placed at independent shops in Mandya. Today every
payment is simulated (`PAYMENT_PROVIDER=demo`, "DEMO PAYMENT — NO MONEY CHARGED"); the API
refuses to start in production with the demo provider. Before any real money moves we must
decide **who is the merchant of record** — whose name is on the customer's statement, who
receives settlement, who issues refunds and who carries chargebacks and GST invoicing.

## Options (PRD §8.8)

| Option                                | How it works                                                                                                                                                        | For                                                                     | Against                                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **A. Each shop is the merchant**      | Payment is created under the selected shop's own gateway account; Kagaz stores the reference and the order.                                                         | Money goes straight to the shop; Kagaz never holds customer funds.      | Every shop needs its own merchant onboarding (KYC, bank account, keys); Kagaz commission must be billed separately.     |
| **B. Marketplace / split settlement** | Kagaz collects through a marketplace product (e.g. Razorpay Route, Cashfree Easy Split) and routes the shop's share to a linked vendor account, keeping commission. | One integration, central reconciliation, commission deducted at source. | Needs provider product approval, vendor KYC per shop, a marketplace agreement, and a refund/settlement-reversal design. |

Questions the business team must answer: commission model (if any) and who invoices it; GST
treatment; who handles refunds/chargebacks; written approval from the provider for the chosen
product; whether a shop can use an existing merchant account (option A).

## Decision

**None yet.** Working default (PRD §20 D6): live payments stay **disabled**; demo payments only.

## Engineering readiness (confirmed 2026-11-07)

The code is ready for either option without a schema change:

- **Provider boundary** — all payment logic goes through `PaymentProvider`
  (`apps/api/src/modules/payments/payment-provider.ts`), frozen in P3.1 with a reusable contract
  suite (`payment-provider.contract.ts`); `orders/` cannot import a provider (boundary test).
  A live adapter is "just another adapter" that must pass the suite.
- **Data model** (PRD §10, FR-PAY-09) — present, stored, **not active**:
  - `Shop.gatewayAccountId` (`shops.gateway_account_id`) — option A merchant account or
    option B linked vendor account id
  - `Shop.settlementConfig` (`shops.settlement_config`, JSON) — e.g. commission %, settlement
    schedule, product (Route / Easy Split)
  - `Payment.settlementRef` (`payments.settlement_ref`) — provider settlement/transfer id,
    added in migration `20261107084817_pay_otp_settlement`
  - `Refund.providerRefundId`, `Refund.idempotencyKey` (`refund:<paymentId>:<n>`)
- **Admin editing** — `PATCH /api/admin/shops/:id/settlement` stores `gatewayAccountId` and
  `settlementConfig` (audited `shop.settlement_updated`); the response always says
  `active: false`. Nothing reads these values until this ADR is accepted.
- **Safety** — `APP_ENV=production` with `PAYMENT_PROVIDER=demo` or `OTP_PROVIDER=demo` exits
  at boot; webhook signatures are verified over the raw body; payment and order status stay
  separate; refunds are idempotent.

## Consequences once decided

1. Record the decision here (status → Accepted), with the provider's written approval.
2. P3.9: implement `RazorpayProvider` or `CashfreeProvider` against the sandbox, pass the
   contract suite, use `Shop.gatewayAccountId` per payment (A) or transfers (B), and fill
   `Payment.settlementRef` from settlement webhooks.
3. Reconciliation (P3.7) adds settlement checks for the chosen model.
