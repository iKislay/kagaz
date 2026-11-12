# Phase 2–5 cross-team contracts

Frozen interface agreements between the parallel workstreams (API core, payments/business, identity/admin,
Windows app, realtime/tooling). Implement exactly this shape; if a contract must change, note it in your
final report instead of silently changing it. Zod schemas go in `packages/shared/src/shop-api.ts`
(shop/device), `admin-api.ts` (admin) or `api.ts` (customer); the C# models mirror them in
`Kagaz.ShopAgent.Core/ShopApiModels.cs`. Errors always use `{ error: { code, message, details? } }`.

## 1. Heartbeat + leases — owner: **API core**

`POST /api/shop/heartbeat` (device token), sent by the agent **every 15 s**.

```jsonc
// request (extends today's HeartbeatRequestSchema; all new fields optional for back-compat)
{
  "appVersion": "0.3.0",
  "os": "Windows 11 10.0.26300",
  "uptimeSeconds": 1234,
  "queueDepth": 2, // jobs in the agent's local queue
  "activePrintJobIds": ["<uuid>"], // attempts the agent is printing/monitoring → leases renewed
  "printers": [{ "printerId": "<uuid>", "status": "READY|OFFLINE|PAPER_OUT|ERROR|UNKNOWN", "lastError": "..." }],
}
// response 200
{
  "serverTime": "ISO",
  "leaseTtlSeconds": 60,
  "minAgentVersion": "0.1.0" | null,      // from MIN_AGENT_VERSION env
  "upgradeRequired": false,                // true when appVersion < minAgentVersion
  "shop": { "status": "OPEN|CLOSED|MAINTENANCE", "approvalMode": "MANUAL|AUTO", "autoPaused": false }
}
```

- Lease (`POST /api/shop/print-jobs/:id/lease`) is one conditional update (plan Appendix A.2). Lease TTL =
  `PRINTER_LEASE_TTL_SECONDS` (60). Failure codes: `409 PRINTER_BUSY` (printer has another active, unexpired
  lease), `409 NOT_NEXT_IN_QUEUE` (an older READY job exists for that printer), `409 JOB_NOT_LEASABLE`.
- Every `POST /print-jobs/:id/status` report renews the lease. New report variant:
  `{ "status": "UNCERTAIN", "reason": "..." }` → job `UNCERTAIN`, order `NEEDS_OPERATOR_CHECK`, lease cleared.
  `SPOOLER_COMPLETE` / `FAILED` clear the lease. A report for a job not leased by this device → 404.
- Sweeper every 15 s: expired lease with job `LEASED`/`SUBMITTED` → job `UNCERTAIN`, order
  `NEEDS_OPERATOR_CHECK` (actor SYSTEM), lease cleared.
- A shop endpoint called by an agent whose `appVersion` (header `X-Agent-Version`) is below
  `MIN_AGENT_VERSION` returns `426 AGENT_UPGRADE_REQUIRED` (heartbeat itself still answers 200).

## 2. Needs-check resolution — owner: **API core**

`POST /api/shop/jobs/:orderId/resolve` (device + operator, `Idempotency-Key` supported)

```jsonc
{ "action": "CONFIRM_PRINTED" | "REPRINT" | "MARK_FAILED", "confirm": true, "note": "optional ≤500" }
```

- Only from `NEEDS_OPERATOR_CHECK`, else `409 INVALID_TRANSITION`.
- `CONFIRM_PRINTED` → `READY_FOR_PICKUP`. `REPRINT` requires `confirm: true` (else `400 REPRINT_CONFIRM_REQUIRED`),
  marks the old attempt `SUPERSEDED`, creates attempt+1 (`READY`) with the **same packet file and pickup code**,
  order → `QUEUED`. `MARK_FAILED` → `REJECTED` and triggers the refund workflow (`RefundService.request`).
- Response: `ShopJobDetail`. Every action writes an `AuditLog` row (`ORDER_RESOLVE_<ACTION>`).

## 3. Approval mode — owner: **payments/business**

`PATCH /api/shop/mode` (device + operator) body `{ "approvalMode"?: "MANUAL"|"AUTO", "autoPaused"?: boolean }`
→ `{ "approvalMode", "autoPaused" }`; audited `SHOP_MODE_CHANGED`; realtime `shop.mode_changed`.
`GET /api/devices/me` (existing) response gains `shop.approvalMode` and `shop.autoPaused`.

## 4. Operator session + devices — owner: **identity/admin**

- `POST /api/shop/operator/login` (device token) `{ "login": "<email or phone>", "password": "..." }` →
  `{ "operatorToken", "expiresAt", "operator": { "id", "name", "role": "SHOP_OWNER|SHOP_OPERATOR" } }`.
  The user must be a member of the **device's** shop; otherwise `401 INVALID_CREDENTIALS` (same error as a wrong
  password — no enumeration). Rate-limited.
- `POST /api/shop/operator/logout`. Token: signed JWT bound to `deviceId` (session row expires 90 days after last use, sliding); sent as header
  `X-Operator-Token`.
- Human actions (accept, reject, ready, resolve, pickups/verify, mode, printers PUT) require a valid operator
  token → else `401 OPERATOR_LOGIN_REQUIRED`. Agent-only calls (jobs list/detail, lease, status, heartbeat)
  need only the device token. Audit rows for human actions: `actorType: STAFF`, `actorId: <userId>`,
  `metadata.deviceId`.
- A revoked device token on any device-auth endpoint → `401 DEVICE_REVOKED` (unknown token → `401 UNAUTHORIZED`).
- `POST /api/devices/rotate-token` (device token) → `{ "deviceToken" }`; the old token stops working immediately.
- Seeded operator credentials are printed by `db:seed` and documented in `.env.example` comments
  (`SEED_STAFF_PASSWORD`, default `kagaz-demo-123` in local/demo only).
- **e2e harness**: add a helper so tests can get `{ deviceToken, operatorToken }` for a shop; other suites
  will be migrated to it at integration time.

## 5. Realtime — owner: **realtime/tooling**

Socket.IO (path `/socket.io`, same origin/port as the API). Hints only — everything is also available by REST.

| Namespace   | Handshake `auth`                                   | Room            | Events (payload)                                                                                                                                         |
| ----------- | -------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/shop`     | `{ token: <deviceToken> }`                         | `shop:{shopId}` | `job.created` `{orderId,status,at}`, `job.updated` `{orderId,status,at}`, `shop.mode_changed` `{approvalMode,autoPaused}`, `device.revoked` `{deviceId}` |
| `/customer` | `{ orderId, trackingToken }` or the session cookie | `order:{id}`    | `order.updated` `{orderId,status,at}`                                                                                                                    |
| `/admin`    | admin session cookie                               | `admin`         | `order.updated`, `device.status` `{deviceId,shopId,online}`, `printer.status` `{printerId,shopId,status}`                                                |

Events are emitted **after commit** from the existing `OrderStateMachine` domain events (an in-process event
emitter). Other modules publish through a `RealtimePublisher` service (`publishToShop`, `publishToOrder`,
`publishToAdmin`); if the realtime module isn't present yet, emit through `EventEmitter2`-style events named
exactly as above so the gateway can subscribe.

## 6. Customer identity — owner: **payments/business**

`POST /api/auth/otp/request {phone}`, `POST /api/auth/otp/verify {phone, code}` → session cookie
`kagaz_session` (httpOnly, SameSite=Lax, Secure outside local, signed JWT 7 d). `GET /api/me/orders`.
Demo OTP inbox: `GET /api/admin/demo/otp-inbox` (admin, non-production only).

## 7. Shared test/dev environment rules (all workstreams)

- Each worktree uses its **own database** (`DATABASE_URL=.../kagaz_<stream>`; e2e then uses `kagaz_<stream>_test`)
  so parallel runs never collide (the S3 bucket is shared; object keys are per-order UUIDs). Don't touch the main `kagaz` DB.
- Don't run dev servers on 3000/4000 (reserved for the real-printer run in the main checkout); use
  `API_PORT=41xx` / `next dev -p 31xx` if you must.
- Never print to a physical printer from a worktree. Use **Microsoft Print to PDF** or fakes.
- One Prisma migration per workstream at most, named `<timestamp>_<stream>_<what>`; never edit `20261105132602_init`.
