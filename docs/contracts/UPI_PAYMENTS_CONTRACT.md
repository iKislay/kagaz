# Direct-to-shop UPI payments — API contract (ADR-003, Phase 6)

Types: `packages/shared/src/upi-payments.ts` (zod) and `packages/shared/src/api.ts`.
Errors use the standard envelope `{ error: { code, message, details? } }`.
"operator" = route also needs `X-Operator-Token` (signed-in shop operator), like other human
actions. Mutating shop routes accept `Idempotency-Key`.

## Customer (order tracking token: cookie or `X-Tracking-Token`)

| Method + path                         | Body                      | Response      | Notes                                                                                                                                                                                                                              |
| ------------------------------------- | ------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/orders/:id/pay`            | —                         | `PayResponse` | `mode: "UPI_CHECKOUT"` + `checkoutUrl` → navigate the browser there (YouPI page: shop's UPI QR + app buttons). YouPI returns to `/order/:id`. Calling again reuses the open checkout.                                              |
| `POST /api/orders/:id/payment-report` | `{ utr: "123456789012" }` | `PublicOrder` | Fallback "I paid but it isn't confirmed". Errors: `PAYMENT_REPORT_TOO_EARLY` (409, `details.after`), `PAYMENT_REPORT_OPEN` (409), `PAYMENT_REPORT_LIMIT` (409, max 3), `PAYMENT_REPORT_UTR_USED` (409), `ORDER_NOT_PAYABLE` (409). |
| `GET /api/orders/:id`                 | —                         | `PublicOrder` | New fields: `payment.checkoutUrl`, `paymentReport`, `canReportPayment`, `reportPaymentAfter`, `refund.manual`.                                                                                                                     |

`POST /api/orders/:id/pay` answers `409 PAYMENT_REPORT_OPEN` while a report is open (no second payment while the shop is checking).

## Shop app (device token; shop always from the token)

| Method + path                                | Auth     | Body                   | Response                                                                                                                          |
| -------------------------------------------- | -------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `GET  /api/shop/payments/setup`              | device   | —                      | `ShopPaymentSetup`                                                                                                                |
| `PUT  /api/shop/payments/setup`              | operator | `{ upiId, payeeName }` | `ShopPaymentSetup` — step 1. Errors: `VALIDATION_FAILED`, `PAYMENT_PROVIDER_UNAVAILABLE` (502, YouPI unreachable — retry).        |
| `POST /api/shop/payments/pairing`            | operator | —                      | `ShopPhonePairing` — step 2: show `qrText` as a QR (valid ~10 min). Error `PAYMENT_SETUP_REQUIRED` (409) before step 1.           |
| `GET  /api/shop/payment-reports?status=OPEN` | device   | —                      | `ShopPaymentReportList` (`status=ALL`: last 50).                                                                                  |
| `POST /api/shop/payment-reports/:id/approve` | operator | —                      | `ShopPaymentReport` — marks the order paid (pickup code assigned, job enters the queue). Errors: `PAYMENT_REPORT_NOT_OPEN` (409). |
| `POST /api/shop/payment-reports/:id/decline` | operator | `{ reason, note? }`    | `ShopPaymentReport`                                                                                                               |
| `GET  /api/shop/refunds`                     | device   | —                      | `ShopManualRefundList` (pending manual refunds)                                                                                   |
| `POST /api/shop/refunds/:id/confirm`         | operator | `{ utr? }`             | `204` — "I sent the money back"; completes the refund.                                                                            |

`readiness` (one status line in the app):

| value           | Show                                                                 |
| --------------- | -------------------------------------------------------------------- |
| `NOT_REQUIRED`  | "Demo payments — nothing to set up" (grey)                           |
| `NEEDS_UPI_ID`  | "Add your UPI ID so customers can pay you" (red)                     |
| `NEEDS_PHONE`   | "Connect your phone to confirm payments automatically" (orange)      |
| `PHONE_OFFLINE` | "Your payments phone is offline — check internet / battery" (orange) |
| `READY`         | "Payments are confirmed automatically" (green)                       |

## Realtime

`/shop` namespace, event `payment_report.changed` `{ reportId, orderId, status }` — a hint; refetch
`GET /api/shop/payment-reports`. Poll every 30 s as the safety net (invariant 13).

## Shopkeeper setup UX (highest priority: simple)

Settings → **Payments**: (1) UPI ID + name → Save. (2) "Connect your phone": QR A = `appDownloadUrl`
(install the app), QR B = pairing `qrText` (scan inside the app). Status dot turns green when the
phone reports in. Nothing else to configure.
