# Kagaz — Implementation Plan

Companion to [PRD.md](PRD.md). This plan turns the PRD into **small, independently verifiable stages**. Each stage is sized to be completed (and reviewed) in roughly 1–4 focused hours and ends with a concrete "Done when" check.

- Phases follow the source plan's schedule: **Day 0–1 vertical slice → Days 2–7 → 8–14 → 15–21 → 22–30**.
- Stage IDs (`P1.4`, `P2.6`, …) are referenced in commits, PRs and `CLAUDE.md`.
- Acceptance tests `T01`–`T20` come from PRD §16; the [traceability matrix](#traceability-matrix-acceptance-tests--stages) shows where each is satisfied.
- Requirement IDs (`FR-…`) come from PRD §7.

**Status legend:** `[ ]` not started · `[~]` in progress · `[x]` done · `[-]` deferred (write why)

---

## Contents

- [Guiding principles](#guiding-principles)
- [Target repository layout](#target-repository-layout)
- [Phase 0 — Foundation (Day 0, morning)](#phase-0--foundation-day-0-morning)
- [Phase 1 — Investor demo vertical slice (Day 0–1)](#phase-1--investor-demo-vertical-slice-day-01)
- [Phase 2 — Core workflow and stability (Days 2–7)](#phase-2--core-workflow-and-stability-days-27)
- [Phase 3 — Payment adapter and business rules (Days 8–14)](#phase-3--payment-adapter-and-business-rules-days-814)
- [Phase 4 — Three-shop operation and hardening (Days 15–21)](#phase-4--three-shop-operation-and-hardening-days-1521)
- [Phase 5 — Release-candidate readiness (Days 22–30)](#phase-5--release-candidate-readiness-days-2230)
- [Traceability matrix](#traceability-matrix-acceptance-tests--stages)
- [Decision gates](#decision-gates)
- [Appendix A — Key algorithms](#appendix-a--key-algorithms)
- [Appendix B — Environment variables](#appendix-b--environment-variables)
- [Appendix C — Test PDF corpus](#appendix-c--test-pdf-corpus)

---

## Guiding principles

1. **Physical transaction first.** The Day 0–1 slice proves one real PDF → mock payment → one combined print → READY → verified pickup. Breadth (dashboards, admin polish) comes later.
2. **Server is the authority.** Price, payment status, order status and print-job state live in PostgreSQL and change only through the backend state machine.
3. **REST for commands, WebSocket for hints.** Anything a client misses over WebSocket must be recoverable by polling REST.
4. **Never duplicate a print silently.** Uncertain → `NEEDS_OPERATOR_CHECK`; reprint = new attempt + explicit confirmation.
5. **Interfaces at the volatile edges.** `PaymentProvider`, `OtpProvider`, `StorageService`, `IPrintEngine` — so mock/live and demo/real hardware swap without touching business logic.
6. **Honest demo.** Mock payments are always labelled; production refuses to boot with mock payments.
7. **Build the schema once, properly.** The full entity set is created in Phase 1 (cheap now, painful later); later phases add behaviour, not churn.

---

## Target repository layout

```
kagaz/
├─ CLAUDE.md
├─ docs/                      PRD, implementation plan, architecture, runbooks, guides
├─ apps/
│  ├─ api/                    NestJS modular monolith (+ Prisma schema, migrations, seed)
│  │  ├─ prisma/
│  │  └─ src/
│  │     ├─ common/           config, guards, filters, interceptors, logging, idempotency
│  │     ├─ modules/
│  │     │  ├─ identity/      customers, staff, roles, OTP, sessions
│  │     │  ├─ shops/         shops, printers, devices, enrollment, modes
│  │     │  ├─ pricing/
│  │     │  ├─ orders/        lifecycle + state machine + events
│  │     │  ├─ files/         storage, validation, packet + slip builder
│  │     │  ├─ payments/      PaymentProvider, DemoMockProvider, webhooks, refunds
│  │     │  ├─ printing/      print jobs, leases, recovery
│  │     │  ├─ pickup/
│  │     │  ├─ notifications/ Socket.IO gateway
│  │     │  ├─ audit/
│  │     │  └─ admin/         admin + demo-control endpoints
│  │     └─ main.ts
│  ├─ web/                    Next.js (customer routes + /admin routes)
│  └─ shop-agent/             .NET WPF solution (Kagaz.ShopAgent.sln)
│     ├─ src/Kagaz.ShopAgent.App/        WPF UI (MVVM)
│     ├─ src/Kagaz.ShopAgent.Core/       API client, queue, state, models
│     ├─ src/Kagaz.ShopAgent.Printing/   IPrintEngine + spooler monitor
│     └─ tests/Kagaz.ShopAgent.Tests/
├─ packages/
│  └─ shared/                 TS enums, zod schemas, DTO types, money helpers
├─ infra/
│  ├─ docker-compose.yml      postgres + minio (local)
│  └─ deploy/                 Dockerfiles, env templates per environment
├─ scripts/                   load/seed/demo scripts
├─ test-assets/pdfs/          test PDF corpus (Appendix C)
├─ package.json / pnpm-workspace.yaml
└─ .env.example
```

---

## Phase 0 — Foundation (Day 0, morning)

**Goal:** a runnable empty skeleton of all three apps, local infrastructure and shared types, so Phase 1 is pure feature work.

### P0.1 — Monorepo scaffold `[x]`

- `git init`; `.gitignore` (node, .NET `bin/obj`, `.env*` except `.env.example`, `*.pdf` outside `test-assets/`).
- pnpm workspaces: `apps/api`, `apps/web`, `packages/shared`. Root scripts: `dev`, `build`, `lint`, `test`, `typecheck`, `format`.
- TypeScript strict base config; ESLint + Prettier; `.editorconfig`; `.nvmrc` (Node LTS).
- **Done when:** `pnpm install && pnpm lint && pnpm typecheck` pass on the empty workspace.

### P0.2 — Local infrastructure `[~]` (written; not yet run: Docker engine unavailable)

- `infra/docker-compose.yml`: PostgreSQL 16 (port 5432) and MinIO (S3 API 9000, console 9001) with a private bucket `kagaz-local` created by an init container.
- `.env.example` with every variable from [Appendix B](#appendix-b--environment-variables).
- **Done when:** `docker compose -f infra/docker-compose.yml up -d` starts both; bucket exists and is not publicly readable.

### P0.3 — Shared package `[x]`

- `packages/shared`: enums `OrderStatus`, `PaymentStatus`, `PrintJobStatus`, `ApprovalMode`, `ShopStatus`, `RejectReasonCode`; zod schemas for `PrintOptions` (pageRange, copies, colour, duplex, paperSize='A4'), `Quote`, public order DTO; money helpers (`formatPaise`, integer guards); page-range parser (`"1-3,5"` → sorted unique page list, validated against page count).
- Unit tests for page-range parser (empty, overlaps, reversed ranges, out of bounds, whitespace).
- **Done when:** `pnpm --filter @kagaz/shared test` passes.

### P0.4 — API skeleton `[x]` (live db/storage "ok" pending P0.2)

- NestJS app under `apps/api`; global prefix `/api`; config module with **zod-validated env** (fails fast on missing/invalid vars).
- **Startup guard:** if `APP_ENV=production` and `PAYMENT_PROVIDER=demo` → throw and exit (FR-PAY-03). Unit-test it now.
- Prisma installed, connected; `PrismaService` with graceful shutdown.
- Pino structured logging with `requestId`; global exception filter returning `{ error: { code, message } }`; validation pipe.
- `GET /api/health` (DB + storage reachability), `GET /api/config` (public config).
- **Done when:** `pnpm --filter api dev` serves `/api/health` → `{ status: "ok", db: "ok", storage: "ok" }`; guard test passes.

### P0.5 — Web skeleton `[x]`

- Next.js (App Router, TypeScript, Tailwind) under `apps/web`; typed API client using `@kagaz/shared`.
- Layout with persistent **DEMO banner** driven by `/api/config` (`paymentMode === "DEMO"`).
- Route stubs: `/` (shops), `/order/new`, `/order/[id]`, `/admin`.
- **Done when:** `pnpm --filter web dev` shows the banner fetched from the running API.

### P0.6 — Windows agent skeleton `[~]`

- `apps/shop-agent/Kagaz.ShopAgent.sln` (.NET LTS, WPF, x64) with projects `App`, `Core`, `Printing`, `Tests`.
- CommunityToolkit.Mvvm, Serilog (rolling file in `%LOCALAPPDATA%\Kagaz\logs`), typed `HttpClient` with base URL from `appsettings.json`.
- Local state folder `%LOCALAPPDATA%\Kagaz\` and a `SecureStore` using DPAPI (`ProtectedData`, CurrentUser) for the device token.
- Main window shell with navigation placeholders: Pairing, Jobs, Pickup, Printers, Settings.
- **Done when:** `dotnet build` and `dotnet test` succeed; the app launches and calls `/api/health`, showing "Connected".

---

## Phase 1 — Investor demo vertical slice (Day 0–1)

**Goal (exit):** a customer orders from the browser, pays with the mock provider, the Windows app receives and prints **one combined PDF + slip** on a real printer, the operator marks it ready, the website shows the code, and the operator verifies it → `COLLECTED`.

**Simplifications allowed in this phase (removed later):** guest customer with tracking link (no OTP), polling instead of WebSocket, device token from seed/enrollment code without operator login, single printer per shop, no lease expiry handling, synchronous packet build.

### P1.1 — Database schema v1 + seed `[ ]`

- Prisma schema with **all** PRD §10 entities, enums, constraints and indexes (unique `public_ref`, `(provider, provider_event_id)`, `(order_id, attempt)`, `pickup_code.order_id`; `shop_id` indexes; `Order.version` for optimistic locking).
- Initial migration.
- Seed script: 3 demo shops in Mandya (e.g. "Kagaz Demo — PES College Gate", "Kagaz Demo — Mandya Bus Stand", "Kagaz Demo — VV Nagar"), `is_demo=true`, `OPEN`, `MANUAL` mode; pricing (e.g. mono ₹2/side = 200 paise, colour ₹10/side, min ₹5); one admin user; one owner + one operator per shop; one printer record for Shop 1; a one-time enrollment code for Shop 1 printed to console.
- **Done when:** `pnpm --filter api prisma migrate dev && pnpm --filter api db:seed` produces 3 shops; re-running seed is idempotent.

### P1.2 — Pricing module + quote `[ ]`

- Pure function `calculateQuote(pricing, options, pageCount)` implementing PRD §8.2 in integer paise.
- `PricingService.getEffectivePricing(shopId, at)`.
- Unit tests: mono/colour, copies, page ranges, minimum charge, duplex rules, zero/negative/overflow guards, no floats.
- **Done when:** tests cover every branch of the formula (T03 logic).

### P1.3 — Storage + upload + PDF validation `[ ]`

- `StorageService` interface (`createUploadUrl`, `createDownloadUrl`, `head`, `getObject`, `putObject`, `delete`) with S3 implementation (works with MinIO and R2).
- `POST /api/orders/{id}/upload-url` → signed PUT (TTL 10 min, content-length limit, `application/pdf`), object key `orders/{orderId}/original/{uuid}.pdf` (no customer filename in key).
- `POST /api/orders/{id}/upload-complete` → download object, check size, `%PDF-` magic bytes, load with pdf-lib (reject encrypted), parse with pdf.js for readability, count pages, enforce limits, compute SHA-256, create `FileAsset(ORIGINAL)`.
- Error codes: `FILE_NOT_PDF`, `FILE_ENCRYPTED`, `FILE_CORRUPT`, `FILE_TOO_LARGE`, `FILE_TOO_MANY_PAGES`, `FILE_MISSING`.
- Tests against [test corpus](#appendix-c--test-pdf-corpus).
- **Done when:** valid PDF → page count + checksum stored; each invalid sample returns its specific error (T01, T02); direct unsigned GET to MinIO returns 403.

### P1.4 — Order state machine + order endpoints `[ ]`

- `OrderStateMachine.transition(orderId, to, actor, {reason, metadata, expectedVersion})`: validates against the transition table (PRD §9.1), conditional update on `version`, writes `OrderEvent`, all inside one Prisma transaction; emits domain event after commit.
- `POST /api/orders` (shopId, options) → `DRAFT`, `public_ref` (`KGZ-` + 6 chars from the pickup alphabet), tracking token (random 32 bytes, stored hashed, returned once).
- `PATCH /api/orders/{id}/options` → re-quote.
- On successful `upload-complete` → transition to `AWAITING_PAYMENT` with quote.
- `GET /api/orders/{id}` (auth: tracking token header/cookie) → customer-safe DTO.
- Unit tests: every allowed transition, every forbidden transition throws, concurrent transition (stale version) fails cleanly.
- **Done when:** draft → upload → awaiting payment works via HTTP; forbidden transitions rejected.

### P1.5 — Payment interface + DemoMockProvider `[ ]`

- `PaymentProvider` interface exactly as PRD §8.7; `PAYMENT_PROVIDER` token resolved by config.
- `DemoMockProvider.createPayment` → returns `{ providerOrderId: "DEMO-ORD-<ref>", mode: "DEMO_AUTO_APPROVE" }`; then `PaymentsService` records verification via `fetchPaymentStatus` (mock returns PAID, `providerPaymentId: "DEMO-PAY-<ref>"`) **inside the backend**.
- `POST /api/orders/{id}/pay`: amount read from price snapshot (never from body); creates `Payment(is_simulated=true)`; on verified PAID → conditional transition `AWAITING_PAYMENT → PENDING_REVIEW` (exactly once; second call returns existing payment).
- Price snapshot written when payment is created.
- **Done when:** paying twice yields one payment and one `PENDING_REVIEW` event (T04 core); request body `amount` is ignored.

### P1.6 — Customer website flow `[ ]`

- `/`: shop cards (name, address, status, rates, DEMO tag).
- `/order/new?shop=`: upload (direct PUT with progress) → validation result → options form (copies, B/W/colour; duplex + page range may be shown if ready) → live server quote with breakdown.
- Checkout: "Pay ₹X" → demo confirmation screen "**DEMO PAYMENT — NO MONEY CHARGED**".
- `/order/[id]`: status timeline, polling every 5 s; pickup code panel only when `READY_FOR_PICKUP`. Tracking token kept in an httpOnly cookie + shareable tracking link.
- Mobile-first layout (360 px).
- **Done when:** a full order reaches `PENDING_REVIEW` from a phone-sized browser with no console errors.

### P1.7 — Pickup code + slip + packet builder `[ ]`

- `PickupCodeService.generate()` — CSPRNG over `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, 8 chars; store `HMAC-SHA256(pepper, code)` and AES-256-GCM encrypted display value.
- `SlipRenderer` (pdf-lib, embedded font + logo) per PRD §8.6.
- `PacketBuilder.build(original, options, slip)` per [Appendix A.1](#a1-print-packet-construction): page range × copies, duplex spacers, slip on own sheet; store `FileAsset(PACKET)` with SHA-256 and page count.
- Unit tests: page count of packet for simplex/duplex × odd/even × copies; slip is last page; slip text contains code & ref; no phone number.
- **Done when:** a generated packet opened in a PDF viewer shows pages × copies, correct spacers and one slip at the end.

### P1.8 — Shop/device API (slice) `[ ]`

- `POST /api/devices/enroll` (enrollment code → device token; store SHA-256 hash; code single-use).
- `DeviceAuthGuard` resolves `shopId` + `deviceId` from `Authorization: Bearer <deviceToken>`; every shop endpoint uses that `shopId` (never a path param).
- `GET /api/shop/jobs?status=`; `GET /api/shop/jobs/{orderId}` (with short-lived preview URL of the original).
- `POST /api/shop/jobs/{orderId}/accept` → generate pickup code, build packet, create `PrintJob(attempt=1, READY)`, transition → `QUEUED`.
- `POST /api/shop/jobs/{orderId}/reject` → `REJECTED` (+ simulated refund record; full refund flow in P3.4).
- `POST /api/shop/print-jobs/{id}/lease` → `LEASED`, order → `PRINTING`, returns packet download URL (TTL 5 min) + checksum.
- `POST /api/shop/print-jobs/{id}/status` → `SUBMITTED` (+`spoolerJobId`) / `SPOOLER_COMPLETE` / `FAILED`.
- `POST /api/shop/jobs/{orderId}/ready` → `READY_FOR_PICKUP` (only from `PRINTING` with job `SUBMITTED`/`SPOOLER_COMPLETE`).
- `POST /api/shop/pickups/verify` → shop-scoped HMAC lookup among `READY_FOR_PICKUP` orders; consume (`consumed_at` conditional update) → `COLLECTED`; second use → `PICKUP_ALREADY_USED`.
- e2e tests (supertest) for the full happy path and double-pickup rejection (T15).
- **Done when:** the whole lifecycle can be driven by HTTP calls alone.

### P1.9 — Windows app: pairing + job list + actions `[ ]`

- Pairing screen: API URL + enrollment code → stores device token via DPAPI.
- Jobs screen: polls `GET /api/shop/jobs` every 5 s; tabs Pending / Queue / Printing / Ready; toast + sound on new pending job.
- Job detail: summary + preview (render first page thumbnail, or open preview URL in default viewer for the slice); **Accept** / **Reject** (reason dialog).
- Printer setup: list installed printers (`PrinterSettings.InstalledPrinters`), operator picks the shop printer and confirms colour/duplex; `PUT /api/shop/printers`.
- **Done when:** a paid web order appears within 5 s and can be accepted/rejected from the app.

### P1.10 — Windows app: print engine + ready + pickup `[ ]`

- `IPrintEngine.PrintAsync(pdfPath, PrintRequest{ printerName, colour, duplex, paper=A4, copies=1, documentName })`.
- Implementation (see [Appendix A.4](#a4-windows-print-engine)): render PDF pages with PDFium and print through a single `PrintDocument` job with explicit `PrinterSettings` (duplex, colour, A4, copies=1) and `DocumentName = KAGAZ-<ref>-A<attempt>`. Keep a fallback engine (SumatraPDF CLI) behind config for the demo if PDFium rendering misbehaves on the chosen printer.
- Flow: lease → download to temp → verify SHA-256 (mismatch → `FAILED`, no print) → print → report `SUBMITTED` with spooler job id (look up by document name via `System.Printing.PrintQueue`) → delete temp file.
- Local sequential queue: one job at a time per printer (simple `SemaphoreSlim` per printer in the slice).
- **Mark Ready** button with confirmation "I have checked the printed stack and the pickup slip".
- **Verify Pickup** screen: 8-char input (auto-uppercase, strips spaces/dashes) → shows order summary → success / error states.
- **Done when:** a real printer outputs customer pages followed by exactly one slip (T10 manual run), and the code on the slip verifies the order to `COLLECTED`.

### P1.11 — End-to-end rehearsal + demo assets `[ ]`

- Deploy demo environment (can be a single VM / managed services: API + web + Postgres + R2) **or** run locally with a tunnel if time is short — document which.
- `docs/demo/DEMO_RUNBOOK.md`: pre-flight checklist (printer paper/toner, agent paired, shops open, demo data reset), the 7-step script (PRD §18), recovery steps.
- Rehearse 3 consecutive clean runs; record a 2–3 min video and keep a fallback pre-recorded successful run.
- **Done when:** Phase 1 exit goal achieved 3 times in a row without developer intervention.

---

## Phase 2 — Core workflow and stability (Days 2–7)

**Goal:** replace slice shortcuts with real identity, durable queue/lease semantics, realtime, recovery, retention and basic admin.

### P2.1 — Transactional hardening + audit `[ ]`

- Audit module: `AuditService.record(actor, action, {shopId, orderId, metadata})`, called inside the same transaction as the change for all human actions (FR-OPS-01).
- Idempotency interceptor for mutating shop/agent endpoints (`Idempotency-Key` → `IdempotencyRecord`; same key + same body → stored response; same key + different body → 409).
- Outbox-style post-commit event emission (domain events collected during the transaction, published after commit).
- **Done when:** replaying accept/ready/verify with the same key returns identical responses and no extra events.

### P2.2 — Customer identity (OTP) `[ ]`

- `OtpProvider` interface; `DemoOtpProvider` (demo/local only — OTP visible in the demo admin "OTP inbox" page and API logs; refuses to load in production); live provider deferred (D9).
- `POST /api/auth/otp/request` (rate-limited per phone + IP), `POST /api/auth/otp/verify` → session cookie (httpOnly, Secure, SameSite=Lax, signed JWT, 7-day).
- Orders linked to `customer_id`; tracking-link access still supported (read-only).
- **Done when:** customer can sign in by OTP and see their orders; OTP brute force is rate-limited.

### P2.3 — Staff accounts, roles and operator login `[ ]`

- Staff login (email/phone + password, Argon2id) for `ADMIN`, `SHOP_OWNER`, `SHOP_OPERATOR`; `RolesGuard` + `ShopScopeGuard`.
- Windows app: operator login after pairing; requests carry device token + operator session; audit attributes actions to the operator.
- **Done when:** an operator from Shop A cannot log into a Shop B device; actions show the operator's name in the audit log.

### P2.4 — Device enrollment (proper) `[ ]`

- Admin endpoint/UI to create enrollment codes (single-use, 30 min expiry, hashed); list and revoke devices; revoked token → 401 and the app returns to pairing screen.
- Token rotation endpoint for the agent.
- **Done when:** enroll → revoke → app shows "Device revoked, re-pair required".

### P2.5 — Per-shop pricing management `[ ]`

- Pricing versions with `effective_from`; owner/admin can create new version; quote uses the latest effective row; existing orders keep snapshot.
- **Done when:** changing price after a quote does not change the already-created order amount (T03 snapshot part).

### P2.6 — Approval modes + guarded auto-accept `[ ]`

- `AutoAcceptPolicy.evaluate(order, shop, printers, queueStats)` → `{ eligible, reasons[] }` implementing PRD §8.4.
- On payment verified: if eligible → accept path (same code as manual accept, actor `SYSTEM`) → `QUEUED`; else → `PENDING_REVIEW` with reasons stored in the event.
- `PATCH /api/shop/mode` (mode, autoPaused); Windows app toggle always visible; realtime `shop.mode_changed`.
- Unit tests per precondition; integration test for offline printer and over-limit holds (T08).
- **Done when:** T08 passes for eligible, offline, unsupported-colour and over-limit cases.

### P2.7 — Durable per-printer queue + leases `[ ]`

- Lease acquisition as a single conditional update ([Appendix A.2](#a2-printer-lease)): succeeds only if the printer has no active job or its lease expired, and this job is the oldest `READY` job for that printer.
- Lease TTL 60 s, renewed by agent heartbeat every 15 s; job status reports also renew.
- Server sweeper (every 15 s, `@nestjs/schedule`): expired lease with job `LEASED`/`SUBMITTED` → job `UNCERTAIN`, order `NEEDS_OPERATOR_CHECK`, printer lease cleared.
- Agent: per-printer local queue persisted in `%LOCALAPPDATA%\Kagaz\state.json` (job id, attempt, local phase).
- **Done when:** two agents racing for the same printer → only one wins; killing the agent mid-print → order lands in `NEEDS_OPERATOR_CHECK` after TTL (T13/T14 server side).

### P2.8 — Agent reconnect reconciliation `[ ]`

- On startup/reconnect, agent runs [Appendix A.3](#a3-agent-reconciliation-on-startup--reconnect): compares local state, server jobs and the Windows spooler; continues monitoring jobs still in the spooler; reports `UNCERTAIN` for anything it can't prove; **never** re-submits an attempt.
- **Done when:** T13 manual drill (pull network cable mid-queue; restart PC mid-print) produces no duplicate output.

### P2.9 — Realtime notifications `[ ]`

- Socket.IO gateway: `/customer` (auth by session or tracking token, room `order:{id}`), `/shop` (device token, room `shop:{shopId}`), `/admin`.
- Events per PRD §12, emitted post-commit.
- Web: replace polling with socket + 30 s safety poll; Windows app: SocketIOClient + 10 s safety poll; reconnect with exponential backoff.
- **Done when:** pay → job appears in app in < 3 s; disabling the socket still delivers within the poll interval.

### P2.10 — Spooler monitoring + printer health `[ ]`

- Agent monitors its submitted job via `System.Printing` (`PrintQueue`, `PrintSystemJobInfo`): spooling, printing, error, offline, paper out, deleted, completed.
- Maps to `POST /status` (`SPOOLER_COMPLETE`, `FAILED` with reason) and printer status in heartbeat (`READY`, `OFFLINE`, `PAPER_OUT`, `ERROR`).
- Error states → order `NEEDS_OPERATOR_CHECK`; customer never sees READY (T12).
- Release printer lease when the spooler job leaves the queue (completed or deleted).
- **Done when:** unplugging the printer / removing paper on the demo model shows the right status in the app and holds the order (T12, real hardware).

### P2.11 — Needs-check resolution + safe reprint `[ ]`

- `POST /api/shop/jobs/{orderId}/resolve` with `CONFIRM_PRINTED` (→ READY), `REPRINT` (requires `confirm: true`; marks old job `SUPERSEDED`; creates attempt+1 with the **same packet** and pickup code; order → `QUEUED`), `MARK_FAILED` (→ `REJECTED` → refund).
- Windows app: Needs-check tab with clear warning copy ("Check the printer output tray before reprinting — reprinting may produce duplicate pages").
- All actions audited.
- **Done when:** T14 passes; reprint creates attempt 2 and an audit entry.

### P2.12 — File retention + signed-URL expiry `[ ]`

- Scheduled job (hourly): delete objects per PRD §14.3, set `FileAsset.deleted_at`; abandoned `DRAFT`/`AWAITING_PAYMENT` orders → `CANCELLED` after expiry.
- Config: `RETENTION_AFTER_COLLECTED_HOURS=24`, `UNPAID_ORDER_EXPIRY_HOURS=24`.
- Test with shortened durations.
- **Done when:** T17 passes (object gone; old signed URL returns 403/404).

### P2.13 — Basic admin screens `[ ]`

- `/admin` (role-protected): login, shop list (status, mode, device online, queue depth), order search + detail with event history, audit log viewer.
- **Done when:** admin can find any order by ref and see its full history.

---

## Phase 3 — Payment adapter and business rules (Days 8–14)

**Goal:** a frozen, tested payment boundary with full webhook/refund semantics, so a live gateway is "just another adapter".

### P3.1 — Freeze `PaymentProvider` + contract test suite `[ ]`

- Finalize types: `PaymentSession`, `VerifiedPaymentEvent` (`eventId`, `type`, `providerOrderId`, `providerPaymentId`, `amountPaise`, `status`, `occurredAt`), `PaymentStatus`, `RefundResult`.
- Reusable contract test suite (`describePaymentProviderContract(factory)`) that any adapter must pass: amounts in paise, idempotent refunds, signature rejection, status mapping.
- Lint rule / test that `orders/` imports nothing from provider implementations.
- **Done when:** DemoMockProvider passes the contract suite.

### P3.2 — Environment separation + production guard `[ ]`

- Config matrix (`local`, `demo`, `staging`, `production`): mock payments / demo OTP / demo controls allowed only in non-production; separate DB, bucket, domain, keys per env.
- Boot-time assertions + a startup log line summarizing mode (`PAYMENT=DEMO (SIMULATED)`).
- Test: production + demo provider → process exits non-zero.
- **Done when:** guard tests pass; `/api/config` reflects mode; demo banner can't be disabled while mock is active.

### P3.3 — Webhook pipeline `[ ]`

- `POST /api/webhooks/{provider}` with raw-body capture (Nest `rawBody: true`), `provider.verifyWebhook(rawBody, headers)`.
- Persist `WebhookEvent` (insert with unique `(provider, provider_event_id)`; conflict → 200 "duplicate" no-op).
- Process idempotently: payment status updates are monotonic (ignore `PENDING` after `PAID`; out-of-order safe); paid transition uses conditional update so only one wins.
- Server-to-server `fetchPaymentStatus` used to confirm before marking PAID when the event is ambiguous.
- Mock provider can emit signed webhooks (HMAC with a demo secret) so the real pipeline is exercised in demo.
- **Done when:** T06 passes (same event twice → one transition, one print job); invalid signature → 400 + logged, no state change.

### P3.4 — Refund workflow `[ ]`

- `RefundService.request(orderId, reason)` — idempotency key `refund:<paymentId>:<n>`; `Refund` record; order `REJECTED → REFUND_PENDING`; provider `refund()`; on confirmation (sync for mock, webhook for live) → `REFUNDED`.
- Demo: "Demo refund — no money moved" in customer UI and admin.
- **Done when:** T07 reject path and T20 pass; order history, payment and refund records agree.

### P3.5 — Payment outcome simulation (demo controls) `[ ]`

- Mock provider modes selectable per order from admin demo controls or a demo-only query flag: `SUCCESS`, `FAIL`, `PENDING` (resolves after N seconds), `DUPLICATE_WEBHOOK`, `OUT_OF_ORDER`.
- Customer UI handles failed/pending payment states (retry pay; "waiting for confirmation").
- **Done when:** T05 passes — failed/pending orders never reach the shop queue.

### P3.6 — Cancellation and business rules `[ ]`

- Customer cancel before payment; admin reject after payment (→ refund); shop closed/paused handling: checkout blocked (`SHOP_UNAVAILABLE`), already-paid orders remain `PENDING_REVIEW` and are flagged in admin (T19).
- Opening-hours evaluation in `Asia/Kolkata`.
- **Done when:** T19 passes.

### P3.7 — Reconciliation screen `[ ]`

- `/admin/reconciliation`: per day/shop — paid amount, refunded amount, orders by final state; mismatch flags (paid without order progress > N hours, rejected without refund, refund without rejection, webhook received but unprocessed).
- **Done when:** seeded inconsistent fixtures are flagged; clean data shows zero mismatches.

### P3.8 — Merchant-of-record decision + data model readiness `[ ]` _(business + engineering)_

- Team/accountant/provider decide model (PRD §8.8). Record decision in `docs/decisions/ADR-001-merchant-of-record.md`.
- Ensure `Shop.gatewayAccountId`, `settlementConfig`, `Payment` settlement refs exist and are editable by admin (not active).
- **Done when:** ADR merged (or explicitly marked "pending" with owner and date).

### P3.9 — Live gateway sandbox adapter `[-] gated by D6`

- Only after P3.8: implement `RazorpayProvider` _or_ `CashfreeProvider` against sandbox; server-side order creation; client checkout launch; webhook signature verification; status fetch; refunds; passes P3.1 contract suite.
- Never enabled in demo env; never ships secrets to web or agent.
- **Done when:** sandbox payment → verified webhook → `PENDING_REVIEW`, with the contract suite green.

---

## Phase 4 — Three-shop operation and hardening (Days 15–21)

**Goal:** three independent shops running concurrently with proven isolation, complete admin, health visibility and 100–200 orders without loss or duplication.

### P4.1 — Tenant isolation enforcement + tests `[ ]`

- Central repository helpers require `shopId` for every shop-owned query (no unscoped `findUnique` by id in shop paths); Prisma query extension that asserts `shopId` presence for shop-owned models in shop/device contexts.
- Cross-tenant e2e suite: Shop A device/operator tries to list, read, accept, reject, lease, ready, verify pickup, read preview/packet URLs of Shop B orders → all 404 (not 403, to avoid enumeration).
- **Done when:** T09 suite passes and runs in CI.

### P4.2 — Enroll three devices + printer mapping `[ ]`

- Pair three Windows agents (one on the real demo PC/printer; two can be simulated agents — see P4.7) and map printers with confirmed capability profiles.
- **Done when:** admin shows 3 shops, each with an online device and at least one printer.

### P4.3 — Admin completion `[ ]`

- Full shop management: details, opening hours editor, status (OPEN/CLOSED/MAINTENANCE), approval mode, auto limits, pause; printer enable/disable/default; pricing versions; device list/revoke; enrollment codes.
- All setting changes audited.
- **Done when:** every shop setting in PRD FR-ADMIN-03…06 is editable without DB access.

### P4.4 — Device + printer health `[ ]`

- Heartbeat payload: app version, OS, uptime, printers `[ { printerId, status, lastError } ]`, local queue depth.
- Admin health view: online (heartbeat ≤ 45 s), stale, offline; version drift warnings; printer status; queue depth per printer.
- Realtime `device.status` / `printer.status` events.
- **Done when:** stopping an agent turns its shop "offline" in admin within 60 s and blocks auto-accept for that shop.

### P4.5 — Pickup hardening `[ ]`

- Rate limiting: per device 5 failures / 10 min → 10 min lockout; per order failed-attempt counter; every failure audited with device and operator.
- Code expiry (7 days after READY) surfaced in admin.
- Customer retrieval of code via encrypted display value; cleared on `COLLECTED`.
- **Done when:** T16 passes; T15 still passes.

### P4.6 — Duplicate-prevention + recovery test pack `[ ]`

- Automated tests: duplicate accept, duplicate lease, duplicate status reports, socket reconnect storms, webhook replays, reprint without confirm (rejected), lease expiry → uncertain.
- Manual drills on real hardware: printer off mid-job, paper out, network drop, PC restart (record results in `docs/testing/RECOVERY_DRILLS.md`).
- **Done when:** all automated cases pass; drills documented with outcomes.

### P4.7 — Simulated agent + load seeding `[ ]`

- `scripts/sim-agent.ts`: headless agent using the real device API (enroll, heartbeat, lease, report statuses, randomized delays/failures) — stands in for shops without hardware.
- `scripts/load-orders.ts`: creates 100–200 orders across 3 shops through the public API (upload sample PDFs, quote, pay with mock, mixed options), optionally with mock failure modes.
- Post-run verifier: counts orders per state, asserts no lost orders, no duplicate `(order, attempt)`, no cross-tenant jobs, payments == transitions.
- **Done when:** T18 passes with 200 orders; verifier report saved under `docs/testing/`.

### P4.8 — Dashboards + audit verification `[ ]`

- Admin overview: orders by shop/status/day, median time paid→ready, ready→collected, printer uptime.
- Spot-check audit trail completeness for 10 random orders from the load run.
- **Done when:** every sampled order has a complete event + audit history.

---

## Phase 5 — Release-candidate readiness (Days 22–30)

**Goal:** a reproducible, documented, reviewed release candidate and investor-ready assets.

### P5.1 — Full test matrix run `[ ]`

- Execute T01–T20 (automated + hardware); record results in `docs/testing/TEST_REPORT_RC1.md` with evidence (screenshots, logs, photos of print output).
- Load check (P4.7) re-run on the deployed demo env; recovery drills re-run.
- **Done when:** all 20 pass or have an accepted, documented exception.

### P5.2 — Security review `[ ]`

- Checklist: authN (sessions, device tokens, operator login), authZ & tenant isolation, signed URL TTLs & logging redaction, secrets handling, webhook verification, rate limits, CORS/CSRF/cookies, headers (Helmet, HSTS), dependency audit (`pnpm audit`, `dotnet list package --vulnerable`), file retention, demo/live separation, admin demo endpoints disabled in production.
- Fix findings; record in `docs/security/SECURITY_REVIEW_RC1.md`.
- **Done when:** no open high/critical findings.

### P5.3 — Deployment + environments `[ ]`

- Dockerfiles (API, web); deploy demo and staging (production config prepared, not activated for payments).
- Managed PostgreSQL with automated backups; R2/S3 buckets per env (private, lifecycle rule as a retention safety net); HTTPS domains; secrets in the platform's secret manager.
- Migrations run as a release step; health checks + uptime monitor; Sentry for API/web/agent.
- **Done when:** clean deploy from `main` to demo with one command/pipeline; backup restore tested once.

### P5.4 — Windows installer + updates `[ ]`

- Installer + auto-update (e.g. Velopack or MSIX); per-user install, start-with-Windows option, single instance.
- Version reported in heartbeat; minimum-supported-version check from API (`426 Upgrade Required` style response → app prompts update).
- Code signing when a certificate is available (document unsigned SmartScreen behaviour otherwise).
- **Done when:** fresh Windows machine → install → pair → print works; update from vN to vN+1 works.

### P5.5 — Documentation `[ ]`

- `docs/guides/CUSTOMER_GUIDE.md`, `OPERATOR_GUIDE.md` (with screenshots), `ADMIN_GUIDE.md`.
- `docs/runbooks/SUPPORT_RUNBOOK.md` (stuck jobs, needs-check, refunds, device re-pair, printer issues), `BACKUP_RESTORE.md`, `INCIDENT_CHECKLIST.md`.
- **Done when:** a new team member can set up a shop and run the demo from the docs alone.

### P5.6 — Live payment readiness `[-] gated by D6 + provider approval`

- Complete gateway approval and live-mode testing **only** when business and provider approvals are complete. Otherwise document the remaining steps and owner.

### P5.7 — Investor assets `[ ]`

- Release-candidate demo video (2–3 min), architecture slide (from `docs/architecture.png`), metrics dashboard snapshot from the 200-order run.
- **Done when:** assets stored in `docs/investor/` (or linked) and the demo runbook is rehearsed on the RC.

---

## Traceability matrix (acceptance tests → stages)

| Test | Scenario                               | Built in         | Verified in |
| ---- | -------------------------------------- | ---------------- | ----------- |
| T01  | Valid PDF upload                       | P1.3             | P1.3, P5.1  |
| T02  | Invalid / encrypted / corrupt file     | P1.3             | P1.3, P5.1  |
| T03  | Price calculation + no client override | P1.2, P1.5, P2.5 | P1.2, P2.5  |
| T04  | Mock successful payment                | P1.5, P1.6       | P1.5, P3.3  |
| T05  | Payment failure / pending              | P3.5             | P3.5        |
| T06  | Duplicate webhook                      | P3.3             | P3.3, P4.6  |
| T07  | Manual accept / reject + refund        | P1.8, P3.4       | P3.4        |
| T08  | Auto mode                              | P2.6             | P2.6        |
| T09  | Three-shop separation                  | P1.8, P4.1       | P4.1        |
| T10  | Real print packet                      | P1.7, P1.10      | P1.11, P5.1 |
| T11  | Sequential orders                      | P1.10, P2.7      | P4.6, P5.1  |
| T12  | Printer offline / paper out            | P2.10            | P2.10, P4.6 |
| T13  | Agent disconnect / restart             | P2.7, P2.8       | P2.8, P4.6  |
| T14  | Uncertain completion                   | P2.7, P2.11      | P2.11       |
| T15  | Pickup code success / reuse blocked    | P1.8             | P1.8, P4.5  |
| T16  | Pickup brute force                     | P4.5             | P4.5        |
| T17  | File retention                         | P2.12            | P2.12       |
| T18  | Load 100–200 orders                    | P4.7             | P4.7, P5.1  |
| T19  | Admin pause / shop closed              | P3.6             | P3.6        |
| T20  | Refund reconciliation                  | P3.4, P3.7       | P3.7        |

---

## Decision gates

| Gate | Needed before        | Decision (PRD §20)                         | Default if unresolved                                |
| ---- | -------------------- | ------------------------------------------ | ---------------------------------------------------- |
| G-A  | P1.10 hardware print | D1 — demo PC + printer model               | Block hardware stages; continue with simulated agent |
| G-B  | P1.2                 | D4 — rate units                            | Per printed side, `SAME_AS_SIMPLEX` duplex           |
| G-C  | P1.7                 | D7 — slip layout / handover                | PRD §8.6 layout; shop keeps slip                     |
| G-D  | P2.2                 | D8 — customer identity                     | Phone + OTP (demo provider) + tracking link          |
| G-E  | P3.9, P5.6           | D6 — merchant of record / split settlement | Live payments stay disabled                          |

---

## Appendix A — Key algorithms

### A.1 Print packet construction

```
input: original (validated PDF), options { pageRange, copies, duplex, colour }, slipPdf (1 page)
pages      = parsePageRange(options.pageRange, original.pageCount)   // 1-based, ordered
packet     = new PDFDocument()
for c in 1..copies:
    for p in pages:
        packet.addPage(normalizeToA4(copyPage(original, p)))
    if duplex and len(pages) is odd:
        packet.addPage(blankA4())                 // next copy starts on a front side
if duplex and packet.pageCount is odd:
    packet.addPage(blankA4())                     // safety: slip on its own sheet
packet.addPage(slipPdf.page[0])                   // exactly one slip, always last
store packet → FileAsset(PACKET), sha256, pageCount
```

Invariants (unit-tested): last page is the slip; slip appears exactly once; for duplex, slip page index is odd-numbered (1-based) i.e. a front side; charged sides = `len(pages) × copies` (spacers and slip excluded).

### A.2 Printer lease

```sql
-- Acquire: atomic; succeeds for exactly one caller
UPDATE printer
SET active_job_id = :jobId, lease_until = now() + interval '60 seconds'
WHERE id = :printerId
  AND shop_id = :shopId
  AND (active_job_id IS NULL OR lease_until < now())
  AND :jobId = (SELECT id FROM print_job
                WHERE printer_id = :printerId AND status = 'READY'
                ORDER BY created_at ASC LIMIT 1)
RETURNING id;
-- then, in the same transaction:
UPDATE print_job SET status='LEASED', lease_until=... WHERE id=:jobId AND status='READY';
-- and transition order QUEUED -> PRINTING via the state machine
```

- Renew: heartbeat / status report extends `lease_until` only where `active_job_id = :jobId`.
- Release: on `SPOOLER_COMPLETE`, `FAILED`, `CANCELLED`, or operator resolution.
- Sweeper: `lease_until < now()` with job in `LEASED`/`SUBMITTED` → job `UNCERTAIN`, order `NEEDS_OPERATOR_CHECK`, clear lease. Never auto-requeue.

### A.3 Agent reconciliation on startup / reconnect

```
serverJobs = GET /api/shop/jobs?status=PRINTING,QUEUED,NEEDS_OPERATOR_CHECK
local      = load state.json
for job in serverJobs where job.status == PRINTING and job.printJob.leasedByThisDevice:
    spooled = findSpoolerJob(printer, "KAGAZ-<ref>-A<attempt>")
    if local.phase in {DOWNLOADED, NOT_STARTED} and spooled is None:
        # never reached the spooler; still not auto-retried in v1
        report FAILED(reason="NOT_SUBMITTED")     -> order NEEDS_OPERATOR_CHECK
    elif spooled exists:
        resume monitoring spooled job
    else:
        report UNCERTAIN                          -> order NEEDS_OPERATOR_CHECK
for job in serverJobs where status == QUEUED:
    enqueue locally (normal path; lease decides who prints)
clean up local entries the server no longer lists
```

Rule: the agent may **only** submit a print for a job it has freshly leased **and** whose local phase is `NOT_STARTED` for that attempt. Anything else goes to the operator. (Even "never reached the spooler" goes to the operator in v1 for simplicity and safety; the operator can then use "Reprint with confirmation".)

### A.4 Windows print engine

- **Primary (`PdfiumPrintEngine`):** load packet with PDFium (e.g. PDFiumCore / Docnet), create one `System.Drawing.Printing.PrintDocument` with `DocumentName = "KAGAZ-<ref>-A<attempt>"`, `PrinterSettings { PrinterName, Copies = 1, Duplex = duplex ? Vertical : Simplex }`, `DefaultPageSettings { Color = colour, PaperSize = A4, Margins = 0 }`; `PrintPage` renders page _i_ at the printer's DPI (cap 300 dpi for speed) and sets `HasMorePages`. One `Print()` call = one spooler job.
- **Fallback (`SumatraPrintEngine`, config-switchable):** bundled SumatraPDF `-print-to "<printer>" -print-settings "duplexlong|simplex,color|monochrome,paper=A4" -silent <file>` — useful if PDFium rendering misbehaves on the demo printer. Check licence terms before distributing.
- **Spooler job id:** after submission, poll `PrintQueue.GetPrintJobInfoCollection()` for `Name == DocumentName` (timeout 10 s); record `JobIdentifier`.
- **Capability check before printing:** verify `PrinterSettings.CanDuplex` and `SupportsColor` match the confirmed profile; mismatch → `FAILED(UNSUPPORTED_SETTING)`, no print.
- Validate on the actual demo printer: B/W vs colour output, duplex flip edge, margins/scaling, the slip landing on its own sheet.

### A.5 Pickup code

```
ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"   // 32 symbols, no O/0/I/1 → 40 bits
code     = 8 × ALPHABET[crypto.randomInt(32)]
codeHmac = HMAC_SHA256(PICKUP_CODE_PEPPER, code)
display  = AES_256_GCM_encrypt(PICKUP_CODE_ENC_KEY, code)
verify(shopId, input):
    norm = uppercase(input) with spaces/dashes removed; reject if not 8 chars of ALPHABET
    if device locked out -> 429
    row  = PickupCode JOIN Order WHERE code_hmac = HMAC(norm) AND order.shop_id = shopId
    if none -> record failure, 404 INVALID_CODE
    if consumed_at not null -> audit, 409 PICKUP_ALREADY_USED
    if order.status != READY_FOR_PICKUP -> 409 NOT_READY
    UPDATE pickup_code SET consumed_at=now() WHERE id=row.id AND consumed_at IS NULL  (must affect 1 row)
    transition order -> COLLECTED (same transaction)
```

---

## Appendix B — Environment variables

| Variable                                    | Example                                         | Notes                               |
| ------------------------------------------- | ----------------------------------------------- | ----------------------------------- |
| `APP_ENV`                                   | `local` \| `demo` \| `staging` \| `production`  | Drives guards                       |
| `PORT`                                      | `4000`                                          | API                                 |
| `DATABASE_URL`                              | `postgresql://kagaz:kagaz@localhost:5432/kagaz` |                                     |
| `PUBLIC_WEB_URL`                            | `http://localhost:3000`                         | CORS + links                        |
| `S3_ENDPOINT`                               | `http://localhost:9000`                         | MinIO locally; R2 endpoint in cloud |
| `S3_REGION`                                 | `auto`                                          |                                     |
| `S3_BUCKET`                                 | `kagaz-local`                                   | Private                             |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | —                                               | Secret                              |
| `UPLOAD_URL_TTL_SECONDS`                    | `600`                                           |                                     |
| `DOWNLOAD_URL_TTL_SECONDS`                  | `300`                                           |                                     |
| `MAX_UPLOAD_BYTES`                          | `26214400`                                      | 25 MB                               |
| `MAX_PAGES` / `MAX_COPIES` / `MAX_SIDES`    | `300` / `20` / `1000`                           |                                     |
| `PAYMENT_PROVIDER`                          | `demo` \| `razorpay` \| `cashfree`              | `demo` forbidden in production      |
| `DEMO_WEBHOOK_SECRET`                       | —                                               | Mock webhook signing                |
| `OTP_PROVIDER`                              | `demo`                                          | `demo` forbidden in production      |
| `SESSION_JWT_SECRET`                        | —                                               | Secret                              |
| `PICKUP_CODE_PEPPER`                        | —                                               | Secret, 32+ bytes                   |
| `PICKUP_CODE_ENC_KEY`                       | —                                               | Secret, 32 bytes base64             |
| `PRINTER_LEASE_TTL_SECONDS`                 | `60`                                            |                                     |
| `DEVICE_ONLINE_THRESHOLD_SECONDS`           | `45`                                            |                                     |
| `RETENTION_AFTER_COLLECTED_HOURS`           | `24`                                            |                                     |
| `UNPAID_ORDER_EXPIRY_HOURS`                 | `24`                                            |                                     |
| `SENTRY_DSN`                                | —                                               | Optional                            |
| `NEXT_PUBLIC_API_URL`                       | `http://localhost:4000/api`                     | Web                                 |

Windows agent `appsettings.json`: `ApiBaseUrl`, `PollIntervalSeconds` (10), `HeartbeatSeconds` (15), `PrintEngine` (`Pdfium` | `Sumatra`), `MaxRenderDpi` (300). Device token is **not** in this file — it's in the DPAPI store.

---

## Appendix C — Test PDF corpus

Store in `test-assets/pdfs/` (generated by a script where possible; no real personal documents):

| File                                                           | Purpose                      |
| -------------------------------------------------------------- | ---------------------------- |
| `valid-1-page.pdf`, `valid-3-pages.pdf`, `valid-12-pages.pdf`  | Happy paths, odd/even duplex |
| `valid-300-pages.pdf`, `too-many-pages-301.pdf`                | Limits                       |
| `too-large-26mb.pdf`                                           | Size limit                   |
| `encrypted-password.pdf`                                       | `FILE_ENCRYPTED`             |
| `corrupt-truncated.pdf`                                        | `FILE_CORRUPT`               |
| `not-a-pdf.png-renamed.pdf`                                    | Magic-byte check             |
| `letter-size.pdf`, `a3-landscape.pdf`, `mixed-sizes.pdf`       | A4 normalization             |
| `embedded-fonts.pdf`, `scanned-images.pdf`, `vector-heavy.pdf` | Rendering on real printer    |
| `zero-pages.pdf`                                               | Edge case                    |
