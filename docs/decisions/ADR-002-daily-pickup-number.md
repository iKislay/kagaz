# ADR-002 — Daily pickup number, auto-ready, no pickup verification

- **Status:** Accepted (product owner, 2026-11-10)
- **Supersedes:** PRD invariant "READY needs a human" (CLAUDE.md #9) and the 8-character one-time
  pickup code (CLAUDE.md #12, PRD §8.6 / FR-PICK-\*, plan P1.7 code part, P4.5).

## Context

The real-printer run (T10, 2026-11-07) showed the flow works, but asks the shopkeeper for two manual
steps per order: Mark Ready after checking the stack, and typing an 8-character code at pickup. The
product goal is a shopkeeper who is as free as possible. In practice customers either take their own
copies from the output tray or ask "copies for number 7 please" while showing their phone.

## Decision

1. **Pickup code = a small daily number per shop.** The first paid order of the day at a shop is
   **#1**, then #2, #3 … The count restarts at #1 every day at midnight **Asia/Kolkata**. It is
   assigned when payment is verified (unpaid or abandoned orders never use a number), is unique per
   `(shop, business date)`, and never changes for that order (reprints keep it). The name in UI and
   code stays **"pickup code"**.
2. **The slip and the customer's phone show the number large with the date**, e.g. **#7 · 7 Nov**,
   so yesterday's #7 can't be mistaken for today's. Because packets print in order and each slip
   is the top sheet of its packet, the shopkeeper can find #7 in the stack by its neighbours.
   The customer sees the number as soon as payment is verified.
3. **Printing finished = done.** When the agent reports `SPOOLER_COMPLETE` for an attempt and the
   printer reported no error, the order moves `PRINTING → READY_FOR_PICKUP` automatically (actor
   SYSTEM). That is the order's normal end state. There is no Mark Ready and no pickup verification
   in the software. Printer errors, failed or uncertain attempts still go to
   `NEEDS_OPERATOR_CHECK` (never READY), and reprints still need explicit operator confirmation.
4. **Approval mode is a shop setting.** In the shop app's Settings the shopkeeper chooses **Auto**
   (paid orders are accepted and printed automatically) or **Manual** (each order needs Accept). Auto
   keeps the PRD §8.4 safety checks: an order the printer can't do (colour on a B/W printer, printer
   offline, over the size limits) waits for the shopkeeper.

## Consequences

- Anyone who knows today's number could claim someone else's copies. Accepted for v1: documents are
  low-value, the shopkeeper sees the number + date on the customer's phone, and orders are traceable
  by ref. Revisit if shops report mix-ups (option: a 2-letter check next to the number).
- No `COLLECTED` transitions in normal operation; retention (PRD §14.3) counts from `readyAt`.
- The random-code machinery (HMAC/AES-GCM `pickup_codes`, pickup verify endpoint, lockout) is
  retired. The table stays (no destructive migration) but is no longer written.
- "Spooler complete" now drives READY. A jam after the spooler handed the job to the printer is caught
  only by the agent's printer-status monitoring (P2.10 grace period → NEEDS_OPERATOR_CHECK).
