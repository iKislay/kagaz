# ADR-003: Pay at the counter (production without a payment gateway)

- Status: accepted (2026-11-12)
- Context: Kagaz is being sold to shops and run in production before a payment gateway exists (D6, merchant of
  record, is still open). Production may not run the demo gateway (invariant 4), and a site that says
  "DEMO PAYMENT — NO MONEY CHARGED" cannot be sold.

## Decision

1. New payment provider `PAYMENT_PROVIDER=counter` (`CounterPaymentProvider`, behind `PaymentProvider`).
   Placing the order confirms it right away: the order gets its daily pickup code and goes to the shop. The
   customer pays the shop (cash/UPI) at pickup. `Payment.provider = 'counter'`, `isSimulated = false`.
2. Pay-at-counter orders are **never auto-accepted** (`AutoAcceptReason.PAY_AT_COUNTER`): the shopkeeper sees
   every one in the Windows app, accepts or rejects it, and the app shows "Collect ₹X at the counter".
3. The customer site shows the review step with **Pay at counter** and a disabled **Pay online — coming soon**,
   and the tracking page shows the pickup code with "Pay at the counter ₹X". No DEMO banner: nothing is
   simulated and nothing claims money moved online.
4. Rejections of counter orders say "Nothing to pay" (the refund record exists for bookkeeping only).
5. `OTP_PROVIDER=none` turns customer sign-in off until an SMS vendor is chosen (D9). The demo OTP provider shows
   codes on screen, so it would let anyone read anyone's orders and is not allowed in production. Guest orders
   and tracking links are unaffected.

Production runs `APP_ENV=production`, `PAYMENT_PROVIDER=counter`, `OTP_PROVIDER=none`.

## Consequences

- Money is not verified by the backend for counter orders (invariant 2 applies to online payments). The shop is
  the verifier, in person; manual approval is the safeguard against printing no-show orders.
- A live gateway later is a second provider; the "Pay online" button is enabled then.
