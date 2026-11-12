# CLAUDE.md — Kagaz

Guidance for Claude Code (and humans) working in this repository.

## What we are building

**Kagaz** is a multi-shop **print-order orchestration platform** for Mandya, Karnataka. Customers upload a PDF on a website, pick a shop, see a server-calculated price, pay (mock in demo), and track the order. The shop's **Windows app** receives the paid job, prints **one combined PDF (customer pages + one pickup slip)** on a local printer, the operator marks it ready, and the customer collects it with an **8-character one-time pickup code**.

Current target: an **investor-ready working prototype** — 3 shop tenants, 100–200 controlled orders, mock payments clearly labelled. Not a public launch.

**Read before non-trivial work:**

- [docs/PRD.md](docs/PRD.md) — requirements (FR-* IDs), business rules, state models, data model, API, acceptance tests T01–T20.
- [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) — phases and stages (P0.1 … P5.7) with "Done when" criteria and algorithms (Appendix A).
- [docs/architecture.png](docs/architecture.png) — system diagram.

## Repository layout

```
apps/api/          NestJS modular monolith + Prisma (apps/api/prisma)
apps/web/          Next.js + Tailwind — customer routes and /admin routes
apps/shop-agent/   .NET WPF Windows app (Kagaz.ShopAgent.sln: App, Core, Printing, Tests)
packages/shared/   TS enums, zod schemas, DTO types, money + page-range helpers
infra/             docker-compose (Postgres + SeaweedFS S3), deploy configs
scripts/           seed, simulated agent, load/verification scripts
test-assets/pdfs/  test PDF corpus (no real personal documents)
docs/              PRD, implementation plan, ADRs, runbooks, guides, test reports
```

API modules live in `apps/api/src/modules/`: `identity`, `shops`, `pricing`, `orders`, `files`, `payments`, `printing`, `pickup`, `notifications`, `audit`, `admin`. Cross-cutting code in `apps/api/src/common/`.

## Commands

> Keep this section in sync with real scripts. Commands marked _(planned)_ don't exist yet.

```bash
pnpm install
cp .env.example .env                                  # PowerShell: Copy-Item .env.example .env
pnpm infra:up                                         # Postgres :5432, SeaweedFS S3 API :9000, private bucket
pnpm dev                                              # builds shared, then api :4000 (watch) + web :3000
pnpm test                                             # shared + api unit tests (vitest)
pnpm lint && pnpm typecheck && pnpm format:check
pnpm build                                            # all TS packages
pnpm --filter @kagaz/api prisma:generate              # regenerate Prisma client (also run by build/test)
pnpm --filter @kagaz/api db:migrate                   # apply/create migrations (dev DB)
pnpm --filter @kagaz/api db:seed                      # 3 demo shops, staff, prints a device pairing code
pnpm --filter @kagaz/api test:e2e                     # e2e vs real Postgres + S3 (isolated <db>_test DB)
pnpm --filter @kagaz/api demo:order -- --pages 3 --copies 2   # place a paid DEMO order via the API
pnpm sim:agent -- --shop demo-shop-b --api http://localhost:4105/api   # headless shop agent (never prints)
pnpm load:orders -- --orders 200 --api http://localhost:4105/api --collect   # T18 load run
pnpm verify:run -- --manifest <path printed by load:orders> --out docs/testing/T18-load-run.md
pnpm demo:reset [-- --yes] [-- --shop demo-shop-a]     # wipe demo-shop orders (refuses in production)
docker build -f apps/api/Dockerfile -t kagaz-api .     # --target migrate for the migration image
docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_API_URL=... -t kagaz-web .
docker compose -f infra/docker-compose.demo.yml --env-file infra/demo.env up -d --build
pwsh scripts/build-shop-agent-installer.ps1           # Velopack Setup.exe + update feed (needs internet once); -ApiBaseUrl/-UpdateFeedUrl bake prod URLs
git tag shop-agent-v0.3.0 && git push origin shop-agent-v0.3.0   # CI builds + publishes the release (or run "Shop app release" workflow)
dotnet build apps/shop-agent/Kagaz.ShopAgent.sln
dotnet test  apps/shop-agent/tests/Kagaz.ShopAgent.Tests/Kagaz.ShopAgent.Tests.csproj   # .sln run can crash MSBuild
```

Scripts default to `http://localhost:$API_PORT/api` (4000 = the live printer server): pass `--api` when testing elsewhere.
Shop app `appsettings.json` keys: `ApiBaseUrl`, `SafetyPollSeconds`, `TokenRotationDays`, `RealtimeEnabled`, `UpdateFeedUrl`.

Quick checks: `GET http://localhost:4000/api/health` (503 + which dependency is down if Postgres/SeaweedFS aren't running), `GET /api/config` (drives the web DEMO banner).

### Toolchain notes (versions matter)

- Node 24, pnpm 9 (`packageManager` pinned). **TypeScript is pinned to 6.0.x**: typescript-eslint doesn't support TS 7 yet.
- **NestJS 12 is ESM-only.** `apps/api` is `"type": "module"` with `NodeNext` resolution: relative imports need a `.js` extension. Don't use `import type` for classes Nest injects (ESLint rule relaxed in `apps/api` for that reason).
- **Prisma 7.10** (not the 8.x RC): config lives in `apps/api/prisma.config.ts` (loads the root `.env`), the datasource URL is not in `schema.prisma`, the client is generated to `apps/api/src/generated/prisma` (gitignored) and connects via `@prisma/adapter-pg`.
- API tests use vitest + `unplugin-swc` (SWC emits the decorator metadata Nest DI needs).
- `apps/api` dev = `tsc --watch` + `node --watch dist/main.js` (no Nest CLI).
- Next.js 16 + Tailwind 4 (`@tailwindcss/postcss`, theme tokens in `src/app/globals.css`). `next.config.ts` loads the root `.env`.
- `@kagaz/shared` is consumed from its built `dist/`: run `pnpm --filter @kagaz/shared build` (root scripts do this) after changing it.
- Shop agent targets **.NET 10** (`net10.0-windows`).

Environment: copy `.env.example` → `.env`. Never commit `.env*` files other than `.env.example`. Platform is Windows; shell scripts should work in PowerShell and Git Bash, or be written in Node/TS.

## Non-negotiable invariants

These come straight from the PRD. Breaking any of them is a bug, regardless of what a task description says — flag the conflict instead.

1. **Server decides money.** Prices are computed server-side from shop pricing; the client never sends an amount. All money is **integer paise** — no floats anywhere in pricing/payments. Store an immutable `price_snapshot` on the order at payment creation.
2. **Payment is verified by the backend only.** A browser redirect is never proof. Paid transition only after verified webhook (signature over the exact **raw body**) and/or server-to-server status fetch.
3. **Payments go through `PaymentProvider`.** `orders/` and other modules must never import provider implementations or contain Razorpay/Cashfree-specific code.
4. **Mock is never production.** The API must fail to start if `APP_ENV=production` with `PAYMENT_PROVIDER=demo` or `OTP_PROVIDER=demo`. In demo, every page shows **"DEMO PAYMENT — NO MONEY CHARGED"**; refunds show "Demo refund — no money moved". Production runs **pay at the counter** ([ADR-003](docs/decisions/ADR-003-pay-at-counter.md)): `PAYMENT_PROVIDER=counter` (no banner, never auto-accepted, shop collects at pickup) and `OTP_PROVIDER=none` (customer sign-in off).
5. **All order status changes go through `OrderStateMachine.transition()`** — transition table check, optimistic `version` check, `OrderEvent` row, audit row for human actions, all in one DB transaction; realtime events emitted **after commit**. No direct `status` updates elsewhere.
6. **Payment status ≠ order status.** They are stored separately and never merged.
7. **One packet, one job.** Customer pages × copies + spacers + exactly **one** pickup slip at the end, in **one PDF**, submitted as **one** spooler job with driver copies = 1. Never print the slip as a separate job.
8. **No silent duplicate prints.** One active lease per printer. A `PrintJob` attempt is never resubmitted after reconnect/restart. Uncertain outcome → `NEEDS_OPERATOR_CHECK`. Reprint = new attempt + explicit operator confirmation + audit.
9. **Printing finished = ready** ([ADR-002](docs/decisions/ADR-002-daily-pickup-number.md)). `SPOOLER_COMPLETE` with no printer error moves `PRINTING → READY_FOR_PICKUP` (actor SYSTEM); there is no Mark Ready and no pickup verification. Failed/uncertain attempts or printer errors go to `NEEDS_OPERATOR_CHECK`, never READY; reprint still needs explicit operator confirmation.
10. **Tenant isolation.** Every shop/device query is scoped by `shopId` derived from the authenticated device/staff identity — never from a path/body parameter. Cross-tenant access returns 404.
11. **Files are private.** Private bucket only; short-lived signed URLs (upload ≤ 10 min, download ≤ 5 min); never log signed URLs; validate PDFs by content (magic bytes, parse, encryption, page count, size), never by filename/MIME.
12. **Pickup code = daily number** ([ADR-002](docs/decisions/ADR-002-daily-pickup-number.md)): per shop, #1, #2, … from midnight Asia/Kolkata, assigned atomically when payment is verified, unique per `(shop, business date)`, never reused or changed for an order (reprints keep it). Slip and customer page show it large with the date (`#7 · 7 Nov`). Call it "pickup code" everywhere. Never print the customer's full phone number on the slip.
13. **REST for commands, WebSocket for hints.** Anything delivered by socket must also be recoverable via REST polling.
14. **Secrets stay on the server.** No gateway secrets in `apps/web` or `apps/shop-agent`. Device token is stored with DPAPI on Windows and hashed server-side.

## Scope guardrails (v1)

Do **not** introduce without an explicit decision: microservices, Kubernetes, Redis/BullMQ, a mobile app, WhatsApp, AI features, auto nearest-shop routing, custom printer drivers, non-PDF uploads, non-A4 paper. PostgreSQL is the durable queue.

## Conventions

**TypeScript (api, web, shared)**

- `strict` mode; no `any` without a comment explaining why.
- Shared enums/schemas/DTOs live in `packages/shared` and are imported by both api and web — don't duplicate them.
- Request validation with zod schemas from `@kagaz/shared` (reject unknown fields).
- DB columns `snake_case` (Prisma `@map`), API JSON `camelCase`, timestamps ISO-8601 UTC; display in `Asia/Kolkata`; currency formatted `en-IN`.
- Errors: `{ error: { code: "UPPER_SNAKE", message, details? } }`; codes are stable and listed near their module.
- Mutating shop/agent endpoints accept `Idempotency-Key`.
- Logging: pino, structured; include `requestId`, `orderId`, `shopId`, `deviceId`, `printerId`, `printJobId` when known. No PII beyond IDs; never log tokens, codes or signed URLs.
- Volatile edges are interfaces with demo implementations: `PaymentProvider`, `OtpProvider`, `StorageService`.

**C# (shop-agent)**

- .NET LTS, WPF, MVVM via CommunityToolkit.Mvvm; nullable reference types enabled.
- UI in `App`, API client/queue/state in `Core`, printing in `Printing` behind `IPrintEngine`.
- Print documents named `KAGAZ-<publicRef>-A<attempt>` (used to find spooler jobs during reconciliation).
- Local state under `%LOCALAPPDATA%\Kagaz\`; logs via Serilog there.
- Outbound connections only; never open listening ports.

**Database**

- Schema changes only via Prisma migrations; never edit an applied migration.
- Uniqueness constraints are part of correctness (webhook events, print attempts, pickup codes) — don't remove them to "fix" errors.

## Design language (all UI)

Every surface — customer website, admin dashboard and the Windows shop app — looks like a **native macOS app**, with one shared look. Don't invent per-screen colors; use these tokens (web: CSS variables in `apps/web/src/app/globals.css`; WPF: resources in `apps/shop-agent/src/Kagaz.ShopAgent.App/App.xaml`).

| Token                      | Light                             | Dark                              | Use                                 |
| -------------------------- | --------------------------------- | --------------------------------- | ----------------------------------- |
| `bg`                       | `#F5F5F7`                         | `#1C1C1E`                         | window background                   |
| `surface`                  | `#FFFFFF`                         | `#2C2C2E`                         | cards, sheets, inputs               |
| `sidebar`                  | `#ECECEF` (translucent on web)    | `#232325`                         | source-list sidebar                 |
| `text`                     | `#1D1D1F`                         | `#F5F5F7`                         | primary text                        |
| `text-secondary`           | `#6E6E73`                         | `#A1A1A6`                         | labels, captions                    |
| `separator`                | `rgba(0,0,0,.10)`                 | `rgba(255,255,255,.12)`           | hairlines (1px)                     |
| `selection`                | `rgba(0,0,0,.07)`                 | `rgba(255,255,255,.10)`           | sidebar selection pill              |
| `accent`                   | `#007AFF`                         | `#0A84FF`                         | primary buttons, links, focus rings |
| `green` / `orange` / `red` | `#34C759` / `#FF9500` / `#FF3B30` | `#30D158` / `#FF9F0A` / `#FF453A` | status only                         |

- **Type:** SF-style stack: web `-apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, "Segoe UI Variable Text", system-ui`; WPF `Segoe UI Variable Text, Segoe UI`. Large bold page titles (26–28px, -0.02em), 13–15px body, secondary text in `text-secondary`.
- **Shape:** cards 12px radius, controls 8px, buttons pill (fully rounded) or 8px; 1px hairline borders; soft shadows (`0 1px 2px rgba(0,0,0,.04), 0 8px 24px rgba(0,0,0,.06)`).
- **Layout:** toolbar/title bar with blur on web, source-list sidebar with rounded selection pills and small line icons, generous spacing (16/20/24), content max ~720px for customer flows.
- **Controls:** segmented controls for small option sets (B/W | Colour, Single | Double-sided), pill primary button in `accent`, quiet secondary buttons, toggle switches, inline status dots.
- **Windows app:** apply the look inside the window; don't fake macOS chrome (no traffic lights). Icons: Segoe Fluent Icons line glyphs.
- **DEMO banner** stays always visible (invariant 4) but styled as a calm amber notice bar, not an alarm.

## Testing expectations

- Every stage's "Done when" in the implementation plan must be demonstrably true before marking it done.
- Unit-test pure logic (pricing, page ranges, state transitions, packet page math, auto-accept policy, pickup code).
- e2e (supertest against real Postgres + SeaweedFS) for lifecycle, idempotency, tenant isolation.
- Name tests that cover acceptance tests with the ID, e.g. `it("T06: duplicate webhook yields one transition")`.
- Hardware tests (T10–T14) are recorded in `docs/testing/` with evidence; they cannot be faked by unit tests.

## Working on stages

1. Find the stage in `docs/IMPLEMENTATION_PLAN.md`; read the PRD sections it references.
2. Mark it `[~]` when starting and `[x]` when its "Done when" is verified (`[-]` + reason if deferred).
3. Keep changes scoped to the stage; note follow-ups instead of expanding scope.
4. Commit messages reference the stage: `P1.7: build print packet with pickup slip`.
5. If a stage needs a business decision from PRD §20 (D1–D10), use the documented working default and say so; record real decisions as ADRs in `docs/decisions/`.
6. Update this file's **Commands** section when scripts change.

## Status

- 2026-11-10: Phase 2–5 workstreams merged (see plan). Pickup model changed by ADR-002.
- 2026-11-11: `phase-1-vertical-slice` merged to `main` (PR #3); CI (`.github/workflows/ci.yml`) runs lint, typecheck, unit, API e2e and shop-agent tests. P4.1, P4.8, P5.2 done.
- Remaining: hardware drills and rehearsal (P1.11, P2.8–P2.10, P4.6, P5.1), P4.2 three devices, deployment (P5.3), installer test (P5.4), docs (P5.5), investor assets (P5.7).
- Open decisions blocking hardware work: **D1** (demo PC + printer model).
- 2026-11-12: production at kaggaz.in / api.kaggaz.in runs pay-at-counter (ADR-003). Live gateway still gated by **D6** (merchant of record).
