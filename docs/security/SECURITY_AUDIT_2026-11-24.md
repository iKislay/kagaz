# Security audit — 2026-11-24

- **Scope:** `main` at `3711f4f` — `apps/api`, `apps/web` (customer site + `/superadmin`), `apps/shop-agent`
  (Windows app), `packages/shared`, `scripts/`, `infra/`, Dockerfiles, GitHub workflows, full git history
  (all local and remote refs).
- **Method:** code review of every controller, guard and service on the trust boundaries, then attacks
  against a **local** instance only (API on `:4105`, its own `kagaz_audit` Postgres database, local
  SeaweedFS). Each finding was reproduced against the original code and re-run against the fixed build with
  the same script. **No traffic was sent to kaggaz.in / api.kaggaz.in or any third party**, no real payment
  was made, no production data was touched.
- **Previous review:** [SECURITY_REVIEW_RC1.md](SECURITY_REVIEW_RC1.md) (P5.2). Its fixed items were
  re-verified (§7); its open low items L2, L3, L5, L6 are fixed here.
- **Branch:** `security/audit-2026-11-24` (one PR).

## 1. Summary

| ID  | Severity   | Title                                                                                         | Status        |
| --- | ---------- | --------------------------------------------------------------------------------------------- | ------------- |
| H-1 | **High**   | Validated upload can be swapped through its still-valid signed PUT URL (pay 1 page, print 40) | Fixed, PASS   |
| H-2 | **High**\* | A self-signed-up shop can open itself and take customers' documents without activation        | Fixed, PASS   |
| M-1 | Medium     | No throttle on order creation / upload URLs; pay-at-counter confirms every order for free     | Fixed, PASS   |
| M-2 | Medium     | Unauthenticated invalid webhooks write unbounded rows (RC1 L6)                                | Fixed, PASS   |
| M-3 | Medium     | Shop sign-up resets the password of an existing login without proving the phone               | Fixed, PASS   |
| L-1 | Low        | Signed preview URLs persisted in idempotency records (RC1 L2)                                 | Fixed, PASS   |
| L-2 | Low        | Superseded original PDFs never deleted from storage (RC1 L3)                                  | Fixed, PASS   |
| L-3 | Low        | Staff login limited per IP+login only (RC1 L5)                                                | Fixed, PASS   |
| L-4 | Low        | In-memory rate-limiter maps grow without bound                                                | Fixed, PASS   |
| L-6 | Low        | Malformed order id (36 dashes) → 500                                                          | Fixed, PASS   |
| L-7 | Low        | API accepts form-encoded bodies (CSRF from any `*.kaggaz.in` page)                            | Fixed, PASS   |
| D-1 | Low        | `effect` ≤ 3.22.0 ReDoS via `prisma` CLI/config (dev/migrate tooling)                         | Open — see §6 |

\* H-2 is High when `BILLING_ENFORCED=false` in production (the default). With it on, new orders were already
refused for unsubscribed shops, but the shop could still show as OPEN.

**No Critical findings.** The core controls held under attack: tenant isolation (cross-tenant → 404),
operator vs owner roles, admin-only routes, server-side pricing, payment state machine, webhook signature
over raw bytes, private bucket, signed-URL size binding, content-based PDF validation. No AI / LLM
integration exists anywhere in the codebase (searched for OpenAI/Anthropic/Gemini/LangChain/LLM clients),
so prompt injection is **not applicable**.

**Needs your action** (§8): confirm production `BILLING_ENFORCED` and `TRUST_PROXY`; add an R2 lifecycle
rule for `uploads/`; review shops that self-registered and are OPEN; no secret rotation is required.

## 2. Architecture and trust boundaries

```
 Customer browser ──(1)──▶ Next.js web (kaggaz.in)            Superadmin browser ──(4)──▶ /superadmin
        │  tracking token (header / per-order cookie)                │ kgz_admin JWT cookie (12 h)
        │  kagaz_session JWT (OTP, off in prod)                       │
        ▼                                                             ▼
 ┌──────────────────────────── NestJS API (api.kaggaz.in/api) ─────────────────────────────┐
 │ public: /shops /config /health /orders* (TrackingGuard) /auth/otp/* /downloads/shop-agent │
 │ /webhooks/:provider (signature) /shop/signup /shop/enroll-with-login /devices/enroll      │
 │ device:  /shop/* (DeviceAuthGuard: Bearer device token → shopId) + X-Operator-Token       │
 │          (OperatorAuthGuard: JWT bound to device + session row + live membership)         │
 │ admin:   /admin/* (AdminAuthGuard: staff JWT, role re-read from DB; ADMIN only)           │
 │ realtime: /shop (device token), /customer (tracking token), /admin (staff JWT)            │
 └──────┬──────────────────────────┬──────────────────────────────┬─────────────────────────┘
        │ Prisma (tenant guard)    │ S3 SDK, presigned URLs        │ PaymentProvider (demo|counter)
        ▼                          ▼                               ▼
   PostgreSQL                 Private bucket (R2 / SeaweedFS)   (no live gateway yet, D6)
        ▲                          ▲ signed GET (≤ 5 min)
        │                          │
 Windows shop app ──(3)── device token (DPAPI), operator login, leases packets, prints locally
 Customer browser ──(2)── signed PUT (≤ 10 min, Content-Length + Content-Type signed) to the bucket
```

Trust boundaries and who can cross them:

| Boundary                   | Credential                                                                 | Scope derived from                                  |
| -------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------- |
| Customer → order           | 32-byte tracking token (SHA-256 stored) or OTP session owning the order    | order id + token; unknown/wrong → 404               |
| Browser → bucket           | presigned PUT/GET                                                          | object key chosen by the server                     |
| Shop PC → API              | 32-byte device token (SHA-256 stored, DPAPI on the PC, rotatable)          | `shopId` of the device row only                     |
| Person at shop PC          | operator JWT `{typ: operator, did}` + `operator_sessions` row + membership | device's shop; OWNER vs OPERATOR from `shop_users`  |
| Kaggaz staff → /superadmin | staff JWT `{typ: staff}`, 12 h, httpOnly cookie                            | `users.kind = ADMIN`, re-read every request         |
| Gateway → API              | HMAC over raw body (demo); counter has no webhooks                         | provider name in path must match the configured one |
| Public → shop signup       | none (rate-limited 5/h/IP)                                                 | creates a CLOSED shop + owner login                 |

Production (ADR-003): `PAYMENT_PROVIDER=counter`, `OTP_PROVIDER=none` — customer sign-in is off, every
paid order needs the shop's manual approval, demo controls are compiled in but refuse to run.

## 3. Confirmed findings — fixed

Reproduction evidence: the same script was run against `3711f4f` (before) and this branch (after),
on a fresh local database. Output summarised under each finding.

### H-1 — Validated upload can be swapped through its signed PUT URL (High)

- **Where:** `POST /api/orders/:id/upload-url`, `POST /api/orders/:id/upload-complete`,
  `orders.service.ts` (`requestUploadUrl`, `completeUpload`), `print-preparation.service.ts`.
- **Issue:** the presigned PUT URL (valid 10 min) pointed at the same object key the server later read to
  build the print packet and the shop preview. After `upload-complete` validated and priced the file, the
  customer could PUT different bytes of the **same length** (the only signed constraints) to that URL.
  Validation, page count, `MAX_PAGES`, the price and the shop's preview no longer described what printed.
- **Reproduction (before):** order at Demo Shop A; upload a padded 1-page PDF (quote: 1 side, ₹5); PUT a
  40-page PDF padded to the same size to the same URL (`200`); pay; shop accepts (`200`) → print packet
  contained **40 customer pages** + slip. _Result: VULNERABLE._
- **Fix:** uploads go to a staging key `uploads/<orderId>/<uuid>.pdf`. `upload-complete` validates the bytes,
  writes **those exact bytes** to `orders/<id>/original/<uuid>.pdf` (a key no client ever gets a URL for),
  points the file row at it and deletes the staging object. Packet building also verifies the source's
  SHA-256 against the validated checksum and refuses with `409 FILE_CHANGED` otherwise.
- **After:** same script → packet has **1** customer page; re-PUT only rewrites an orphan staging object.
- **Tests:** `security-audit.e2e.test.ts` › H-1 (swap after validation; tampered source → `FILE_CHANGED`;
  staging + superseded objects deleted).
- **API change:** object keys of originals moved (internal). New error `409 FILE_CHANGED` on accept.

### H-2 — A self-signed-up shop can open itself (High when `BILLING_ENFORCED=false`)

- **Where:** `PATCH /api/shop/mode` (`approval.service.ts#setMode`).
- **Issue:** `POST /api/shop/signup` is public and creates a CLOSED shop "until Kaggaz activates it", but
  the owner could immediately `PATCH /shop/mode {status: "OPEN"}`. The app's Subscription gate is
  client-side only. With `BILLING_ENFORCED=false` (default) the shop was listed as accepting orders and
  received customers' PDFs — e.g. a look-alike "Kaggaz Official Print Centre" harvesting documents
  (Aadhaar copies, certificates) from anyone choosing it.
- **Reproduction (before):** signup (`201`) → operator login → register printer → `PATCH mode OPEN` (`200`)
  → heartbeat → `GET /api/shops` shows `acceptingOrders: true` → customer order `201`. _VULNERABLE._
- **Fix:** moving a shop to OPEN requires a current subscription (ADR-004 entitlement) →
  `409 SUBSCRIPTION_INACTIVE`. Closing / maintenance always work. The shop app already maps that code to its
  Subscription screen, so no app change was needed.
- **After:** `PATCH mode OPEN` → `409 SUBSCRIPTION_INACTIVE`; listed `acceptingOrders: false`; order `409`.
- **Tests:** › H-2 (gate with/without subscription; self-signup stays closed to customers).
- **API change:** `PATCH /api/shop/mode {status: OPEN}` can now answer `409 SUBSCRIPTION_INACTIVE`.

### M-1 — No throttle on order creation or upload URLs (Medium)

- **Where:** `POST /api/orders`, `POST /api/orders/:id/upload-url`.
- **Issue:** both are unauthenticated and unlimited. In production every order is confirmed by
  pay-at-counter without any payment, receives a daily pickup number and lands in the shop's review queue,
  so a script can flood every shop's queue and burn pickup numbers. Each upload URL lets the holder store up
  to 25 MB in the bucket, with no per-order cap.
- **Before:** 70 orders from one IP → 70 accepted; 15/15 upload URLs for one order.
- **Fix:** per-client-IP limit `ORDER_CREATE_LIMIT_PER_IP_HOUR` (default 60/h; `.env.example` sets 1000 for
  local load runs), `MAX_UPLOADS_PER_ORDER` (default 10 → `429 UPLOAD_LIMIT`). Needs a correct `TRUST_PROXY`
  in production (see §8), otherwise all clients share the proxy's IP.
- **After:** 50 of 70 accepted (10 more had been used by the earlier steps), 20 → `429 RATE_LIMITED`.
- **Tests:** › M-1; `config.schema.test.ts` defaults.
- **API change:** `429 RATE_LIMITED` on `POST /api/orders`; `429 UPLOAD_LIMIT` on upload-url. New env vars.

### M-2 — Invalid webhooks write unbounded rows (Medium; was RC1 L6)

- **Where:** `POST /api/webhooks/:provider` (`webhooks.service.ts`).
- **Issue:** every request with a bad signature inserts a `webhook_events` row. In production
  `/api/webhooks/counter` exists (counter rejects every signature), so anyone can grow the table forever.
- **Before:** 40 forged requests → 40 rows. **After:** 20 rows, then `429` without a write (per IP, 10 min).
- **Tests:** › M-2.

### M-3 — Shop sign-up resets an existing login's password (Medium)

- **Where:** `POST /api/shop/signup` (`devices.service.ts#signup`).
- **Issue:** sign-up only refused phones belonging to an ADMIN or a current shop member. Any other existing
  user was upserted with the attacker's password — including a removed operator (STAFF with a password and
  no membership). The phone number is never verified (OTP is off in production), so whoever knows the
  number owns the login; if Kaggaz later re-adds that person to a shop, the attacker gets in.
- **Before:** signup with a former operator's phone → `201`, password hash replaced.
- **Fix:** an existing user with a password is refused (`409 PHONE_IN_USE`), matching the owner's
  `addOperator` rule. Password-less customer accounts are still adopted (by design, orders stay linked).
- **After:** `409 PHONE_IN_USE`, password unchanged. **Tests:** › M-3.

### Low findings (fixed)

| ID           | Where                    | Issue → fix                                                                                                                                                                                                                    | Test                                              |
| ------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| L-1 (RC1 L2) | `IdempotencyInterceptor` | `resolve` responses (with a signed `previewUrl`) were stored for 24 h and replayed → stored bodies null `previewUrl`/`downloadUrl`/`uploadUrl`.                                                                                | e2e › L-2, unit `idempotency.interceptor.test.ts` |
| L-2 (RC1 L3) | `completeUpload`         | superseded originals were only marked DELETED; objects stayed forever → deleted after commit, staging objects too.                                                                                                             | e2e › H-1 third test                              |
| L-3 (RC1 L5) | `AdminAuthService.login` | only the IP+login pair was limited → also 20 failures / 10 min per IP across logins (`429 ADMIN_RATE_LIMITED`).                                                                                                                | e2e › L-5                                         |
| L-4          | `LoginRateLimiter`       | maps of unique keys never shrank (memory) → sweep expired keys, cap 10 000.                                                                                                                                                    | unit `login-rate-limiter.test.ts`                 |
| L-6          | `TrackingGuard`          | `/^[0-9a-f-]{36}$/` let `------…` reach `::uuid` → 500 → strict UUID → 404.                                                                                                                                                    | e2e › L-6 (before: 500, after: 404 live)          |
| L-7          | `app.module.ts`          | Nest parses urlencoded bodies, so an HTML form on any `*.kaggaz.in` page (same-site: SameSite=Lax doesn't help) could post cookie-authenticated requests → mutating requests with a non-JSON body get `415` (webhooks exempt). | e2e › L-7                                         |

## 4. Category results (PASS = attacked, control held or fixed)

| #   | Category                       | Result                         | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | ------------------------------ | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Hidden admin/superadmin routes | **PASS**                       | Every `/admin/*` controller guarded (`AdminAuthGuard` or `StaffAuthGuard+RolesGuard+ShopScopeGuard`); `/superadmin` login is email + `kind=ADMIN` only. Live: no cookie → 401; device token → 401; operator JWT as Bearer → 401 (typ check); demo endpoints → 401 without admin and 404 in production.                                                                                                                                                                                                                                                                       |
| 2   | IDOR / parameter tampering     | **PASS**                       | Other order's token → 404; shop B device reading/accepting shop A's job → 404; operator token bound to its device (`did`); no route takes a shop id on `/shop/*`; owner `/admin/shops/:id` → 404 for other shops (ShopScopeGuard); printer ids in heartbeat/accept scoped by shop.                                                                                                                                                                                                                                                                                           |
| 3   | Secret exposure                | **PASS**                       | Web bundle only reads `NEXT_PUBLIC_API_URL`/`NEXT_PUBLIC_API_PROXY`; no browser source maps; shop app `appsettings.json` has only URLs; git history (150 commits, all refs) scanned: only `change-me` placeholders, local SeaweedFS keys and `YOUPI`/`PAYMENT_SECRETS_KEY` placeholders. Old prototype keys (`kagaz_pi_agent_secret_key_2026`, `kagaz-webhook-verify-2026`) exist only in the **local** branch `backup/old-prototype-main`, not on GitHub, and nothing current uses them. The repo is **public**: keep it that way only because nothing secret is committed. |
| 4   | Price manipulation             | **PASS** (after H-1)           | Client `amountPaise` field → 400 (strict schemas); total always from the server snapshot; `PRICE_CHANGED` on re-price; H-1 was the only way to change what a price covers.                                                                                                                                                                                                                                                                                                                                                                                                   |
| 5   | Quantities / ranges / overflow | **PASS**                       | copies −1 / 1.5 / 1e9 → 400; `1-999999999` → `PAGE_RANGE_INVALID` (bound checked before expanding); `MAX_COPIES`/`MAX_SIDES`/`MAX_PAGES`; money via `multiplyPaise` (safe-integer checks); pricing ≤ `MAX_RATE_PAISE`.                                                                                                                                                                                                                                                                                                                                                       |
| 6   | Payment manipulation           | **PASS**                       | Webhook HMAC over raw bytes + `timingSafeEqual`; provider in path must match; amount mismatch → not paid; unique `(provider, event_id)`; `pay` takes no body; demo `?demoOutcome=` refused unless demo controls are on; production boot refuses demo providers; counter never auto-accepts.                                                                                                                                                                                                                                                                                  |
| 7   | Replay / duplicate redemption  | **PASS**                       | Pay serialized with `FOR UPDATE` + conditional updates; accept/resolve/reprint go through the state machine (409 on repeat); leases conditional; enrollment codes single-use (conditional update); idempotency keys scoped per device with request hash; refunds idempotent per payment.                                                                                                                                                                                                                                                                                     |
| 8   | Privilege escalation           | **PASS** (after M-3)           | Signup → owner of a new CLOSED shop only; ADMIN/members refused; owner can't add admins/owners/other shops' logins; operator → owner endpoints → 403 `OWNER_ONLY`; owner → superadmin impossible (`kind` never set to ADMIN by any API; staff login refuses non-admins).                                                                                                                                                                                                                                                                                                     |
| 9   | Weak authentication            | **PASS**                       | Argon2id + dummy-hash timing equalisation; OTP 6-digit CSPRNG, HMAC-stored, 5 tries, per-phone/IP limits; JWT alg pinned HS256 with typ/kind separation; cookies httpOnly + SameSite=Lax + Secure outside local; operator sessions revocable, device tokens rotatable; L-3/L-7 tightened limits and CSRF. Remaining: stateless staff JWT (§6).                                                                                                                                                                                                                               |
| 10  | AI / prompt injection          | **N/A**                        | No AI integration exists.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 11  | XSS                            | **PASS**                       | React escapes everything; no `dangerouslySetInnerHTML`/`innerHTML`/`eval` in `apps/web`; links built from ids and numbers only; API is JSON with helmet (`nosniff`, CSP); slip text drawn by pdf-lib (no markup); shop app renders text in WPF controls and PDFs with `Windows.Data.Pdf` (no script engine).                                                                                                                                                                                                                                                                 |
| 12  | Malicious uploads              | **PASS** (after H-1)           | HTML → `FILE_NOT_PDF`; `%PDF` + SVG polyglot → `FILE_CORRUPT`; encrypted rejected; > 25 MB → 413 before signing; PUT larger than signed → 403 from storage; object keys never contain the filename; packet re-renders pages into a new PDF (no document JS/launch actions carried over); bucket listing → 403.                                                                                                                                                                                                                                                               |
| 13  | Git / env / deployment hygiene | **PASS** with notes            | `.env*` ignored; non-root Docker images; CI uses `pull_request` (not `_target`); helmet + HSTS; errors return codes only (no stacks); log redaction of tokens/cookies/signed URLs (RC1 M2). Notes in §6 (action pinning, installer signing, CI permissions).                                                                                                                                                                                                                                                                                                                 |
| 14  | Injection / mass assignment    | **PASS**                       | Only tagged-template `$queryRaw`/`$executeRaw` (parameterised); no dynamic `orderBy`; zod `strictObject` rejects unknown fields; Prisma tenant guard on device requests; owner-editable shop fields allow-listed.                                                                                                                                                                                                                                                                                                                                                            |
| B   | Kaggaz business logic          | **PASS** (after H-1, H-2, M-1) | Customers can't touch another order/file/price/status/shop; shops isolated (orders, files, pricing, members, billing — billing is admin-only); admin endpoints guarded and audited; payment ≠ order status; documents private, URLs expire (≤ 10/5 min), retention deletes files.                                                                                                                                                                                                                                                                                            |

## 5. Suspected / needs investigation (not changed)

| ID  | Item                                                                                                                                                                                                  | Why not fixed here                                                                                                   |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| S-1 | Rejecting a **pay-at-counter** order records a `SUCCEEDED` refund with the full amount (not simulated), although nothing was collected online. Reconciliation may count refunds of money never taken. | Accounting/business decision, not a security boundary; needs a product decision on how counter rejections are shown. |
| S-2 | A guest order's `customerPhone` is unverified; when OTP sign-in is on, verifying that phone links those orders to the account (metadata only: status, shop, amount — no file access).                 | OTP is off in production (`OTP_PROVIDER=none`); revisit when an SMS vendor is chosen (D9).                           |
| S-3 | Rate limits are in-memory per API instance.                                                                                                                                                           | Fine for the single Render instance; move to Postgres before scaling out.                                            |

## 6. Accepted risks and recommendations (not fixed)

- **Staff JWTs are stateless** (12 h; logout only clears the cookie; role re-read per request, so removing
  ADMIN takes effect immediately). Acceptable for one admin; add a session table if staff grows.
- **Shop sign-up needs no phone proof** (OTP off). Squatting a number blocks its real owner from signing up;
  Kaggaz support can fix it. H-2 means squatted shops can't open.
- **Customer-writable staging objects**: after `upload-complete` a customer can still PUT to their staging
  key for the URL's remaining lifetime; nothing reads it. Add an R2 lifecycle rule (§8) to expire them.
- **D-1 `effect` ReDoS (GHSA-7589-6fvf-x4pw, high)** via `prisma` → `@prisma/config`: only parsed at CLI /
  config load, never on request data. Upgrade when Prisma ships `effect ≥ 3.22.1`. `minimatch` (moderate)
  is ESLint-only. `.NET` packages: no known vulnerabilities.
- **CI/CD:** pin third-party actions to commit SHAs in `shop-agent-release.yml` (it holds R2 write keys);
  add `permissions: contents: read` to `ci.yml`; **code-sign the Windows installer** (Velopack feed integrity
  currently rests on HTTPS + R2/API access).
- **Account lockout** is per-window throttling, not lockout — by design (no lockout DoS).

## 7. Re-verification of RC1 fixes

| RC1 | Check on `3711f4f`                                                                                    | Result                                  |
| --- | ----------------------------------------------------------------------------------------------------- | --------------------------------------- |
| H1  | demo compose builds the S3 identity from env, no committed keys mounted                               | PASS                                    |
| H2  | `PLACEHOLDER = /^change-me/i`, enforced outside `local`                                               | PASS                                    |
| H3  | `@RequireOperator()` on resolve and `PATCH /shop/mode`; live: reject without operator → 401           | PASS                                    |
| M1  | helmet on API (CSP, nosniff, HSTS outside local); web sends X-Frame-Options DENY, CSP frame-ancestors | PASS                                    |
| M2  | pino redaction of authorization, cookie, x-operator-token, x-tracking-token, idempotency-key          | PASS                                    |
| M3  | `TRUST_PROXY` → Express `trust proxy`                                                                 | PASS (value in production unknown — §8) |
| M4  | READY_FOR_PICKUP files deleted from `readyAt`                                                         | PASS                                    |
| L1  | `/admin` socket checks `typ: staff` + current ADMIN                                                   | PASS                                    |
| L4  | demo OTP codes logged only in `local`                                                                 | PASS                                    |
| L7  | shop app refuses `http://` for non-loopback servers                                                   | PASS                                    |
| L8  | signed URL TTLs capped 600 / 300 s                                                                    | PASS                                    |

## 8. Deployment changes needed (your action)

1. **Confirm `BILLING_ENFORCED=true` in production** once shops have plans. H-2 now blocks opening without
   a subscription regardless, but enforcement also stops orders when a plan lapses.
2. **Set `TRUST_PROXY` correctly** (e.g. `1` behind Render's proxy). Without it every per-IP limit (orders,
   logins, OTP, webhooks, signup) sees one IP and either throttles everyone or no one meaningfully.
3. **R2 lifecycle rule:** delete objects under prefix `uploads/` after 1 day.
4. **Review existing self-registered shops:** list shops with a `shop.self_signup` audit row that are OPEN
   without a subscription; close or verify them. After deploy they can't reopen without a subscription.
5. **No secret rotation is required:** nothing real was ever committed to the public repository. If the
   old Raspberry Pi prototype or WhatsApp webhook (local branch `backup/old-prototype-main`) was ever
   deployed, retire it; never push that branch.
6. Optional: `ORDER_CREATE_LIMIT_PER_IP_HOUR` (default 60) — raise it if a busy shop's customers share one
   Wi-Fi.

## 9. Production go-live security checklist

- [ ] `APP_ENV=production`, `PAYMENT_PROVIDER=counter` (or a live provider after D6), `OTP_PROVIDER=none`
      (boot refuses demo values).
- [ ] `SESSION_JWT_SECRET` ≥ 32 random chars, unique to production; `ADMIN_EMAIL`/`ADMIN_PASSWORD` set in
      the host's secret manager (≥ 12 chars, not reused).
- [ ] `TRUST_PROXY` set to the real hop count; `PUBLIC_WEB_URL` exact (CORS).
- [ ] `BILLING_ENFORCED=true` when shops are on plans.
- [ ] Bucket private, R2 token scoped to the one bucket, lifecycle rule on `uploads/`.
- [ ] `UPLOAD_URL_TTL_SECONDS` ≤ 600, `DOWNLOAD_URL_TTL_SECONDS` ≤ 300 (enforced by config).
- [ ] HTTPS only (HSTS on); API and web on their own subdomains; no other untrusted apps on `*.kaggaz.in`.
- [ ] Database not publicly reachable; backups encrypted; least-privilege DB user for the app.
- [ ] Logs: no request bodies; redaction list unchanged; log drain access restricted.
- [ ] `MIN_AGENT_VERSION` set so old shop apps must update; installer code-signed.
- [ ] Release workflow actions pinned by SHA; R2 write keys only in that workflow's secrets.
- [ ] Retention job running (hourly) and its failures alerted.
- [ ] Self-registered shops reviewed (§8.4).

## 10. Tests run

| Command                                                                                  | Result                                                                                                                                        |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`, `pnpm typecheck`, `pnpm format:check`                                       | pass                                                                                                                                          |
| `pnpm test` (shared + api unit)                                                          | 42 shared + 147 api pass                                                                                                                      |
| `pnpm --filter @kagaz/api test:e2e` (incl. 13 new tests in `security-audit.e2e.test.ts`) | 172 / 172 pass                                                                                                                                |
| `dotnet test apps/shop-agent/tests/Kagaz.ShopAgent.Tests/Kagaz.ShopAgent.Tests.csproj`   | 241 / 241 pass (no shop-app change)                                                                                                           |
| Live attack script, before vs after (local `:4105`, `kagaz_audit` DB)                    | before: H-1, H-2, M-1, M-2, M-3 reproduced, dash-id 500; after: all mitigated, every access-control probe unchanged (404/403/401/400/422/415) |
| `pnpm audit --prod`                                                                      | 1 high (D-1, `effect` via Prisma tooling)                                                                                                     |
| `dotnet list … package --vulnerable --include-transitive`                                | no vulnerable packages                                                                                                                        |
