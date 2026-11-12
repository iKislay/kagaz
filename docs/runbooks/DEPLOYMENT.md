# Deployment runbook (P5.3)

Status: **prepared, not deployed** — no cloud accounts exist yet. Images build and the all-in-one
demo stack runs locally (see "Verified" at the end). Production is configured but must not take
payments until D6 (merchant of record) is decided.

## 1. What gets deployed

| Piece          | Artifact                                                     | Notes                                                                                                               |
| -------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| API (NestJS)   | `apps/api/Dockerfile` target `runtime` → `kagaz-api`         | `node dist/main.js`, non-root, port 4000, healthcheck `GET /api/health`. Socket.IO on the same port (`/socket.io`). |
| Migrations     | `apps/api/Dockerfile` target `migrate` → `kagaz-api-migrate` | `prisma migrate deploy`; a one-shot **release step** before the new API version starts.                             |
| Web (Next.js)  | `apps/web/Dockerfile` → `kagaz-web`                          | Standalone server, port 3000. `NEXT_PUBLIC_API_URL` is a **build arg** (inlined) → one image per environment.       |
| Database       | Managed PostgreSQL 16                                        | Source of truth and the durable print queue (no Redis).                                                             |
| Object storage | Cloudflare R2 (or AWS S3), one **private** bucket per env    | Signed URLs only (upload ≤ 10 min, download ≤ 5 min).                                                               |
| Windows agent  | MSIX/installer (P5.4)                                        | Points at the env's API base URL; outbound HTTPS + WSS only.                                                        |

Build from the repo root:

```bash
docker build -f apps/api/Dockerfile -t kagaz-api:<sha> .
docker build -f apps/api/Dockerfile --target migrate -t kagaz-api-migrate:<sha> .
docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_API_URL=https://api.demo.kagaz.example/api -t kagaz-web:demo-<sha> .
```

## 2. Environment matrix

| Variable                                                 | local (`.env`)              | demo                                 | staging                               | production                                  |
| -------------------------------------------------------- | --------------------------- | ------------------------------------ | ------------------------------------- | ------------------------------------------- |
| `APP_ENV`                                                | `local`                     | `demo`                               | `staging`                             | `production`                                |
| `PAYMENT_PROVIDER`                                       | `demo`                      | `demo` (banner always shown)         | gateway **sandbox** (P3.9)            | live gateway — **API refuses `demo`**       |
| `OTP_PROVIDER`                                           | `demo`                      | `demo`                               | `demo` until an SMS vendor            | real vendor — **API refuses `demo`**        |
| `PUBLIC_WEB_URL`                                         | `http://localhost:3000`     | `https://demo.kagaz.example`         | `https://staging…`                    | `https://kagaz.example`                     |
| `NEXT_PUBLIC_API_URL` (web build arg)                    | `http://localhost:4000/api` | `https://api.demo.kagaz.example/api` | `https://api.staging…/api`            | `https://api.kagaz.example/api`             |
| `DATABASE_URL`                                           | docker Postgres             | managed PG `kagaz_demo`              | managed PG `kagaz_staging`            | managed PG `kagaz_prod` (separate instance) |
| `S3_ENDPOINT` / `S3_BUCKET`                              | SeaweedFS / `kagaz-local`   | R2 / `kagaz-demo`                    | R2 / `kagaz-staging`                  | R2 / `kagaz-prod`                           |
| `S3_FORCE_PATH_STYLE`                                    | `true`                      | `true` (R2 accepts both)             | `true`                                | `true`                                      |
| `SESSION_JWT_SECRET`, `DEMO_WEBHOOK_SECRET`, `S3_*` keys | `.env.example` placeholders | secret manager                       | secret manager (placeholders refused) | secret manager (placeholders refused)       |
| `MIN_AGENT_VERSION`                                      | unset                       | current agent                        | current agent                         | current agent                               |
| `SENTRY_DSN`                                             | empty                       | demo project                         | staging project                       | prod project                                |
| `LOG_LEVEL`                                              | `info`                      | `info`                               | `info`                                | `info`                                      |

Rules: every environment has its **own** database, bucket and secrets — never share a secret between
environments (sessions would verify across them). Secrets live only in the platform's secret
manager and are injected as environment variables; no `.env` file is baked into an image
(`.dockerignore` excludes them). Rotating `SESSION_JWT_SECRET` signs everyone out.

## 3. Release procedure (one pipeline per environment)

1. CI on `main`: `pnpm lint && pnpm typecheck && pnpm format:check && pnpm test && pnpm --filter @kagaz/api test:e2e`.
2. Build and push the three images tagged with the commit SHA.
3. **Release step:** run `kagaz-api-migrate:<sha>` once with the env's `DATABASE_URL`; stop on failure.
   Migrations are forward-only and must stay compatible with the previous API version (expand →
   deploy → contract), because the old API keeps serving during the rollout.
4. Roll out `kagaz-api:<sha>`; the platform waits for `/api/health` = 200 (it returns 503 naming the
   failing dependency if Postgres or storage is unreachable).
5. Roll out `kagaz-web:<env>-<sha>`.
6. Smoke test: `GET /api/health`, `GET /api/config` (demo shows `paymentMode: DEMO`), open the site,
   place one demo order (`pnpm demo:order -- --api https://api.<env>/api`) in demo/staging.

**Socket.IO behind a load balancer:** enable WebSocket upgrades and sticky sessions (or run a single
API instance — enough for the prototype). Hints are best-effort: clients re-sync over REST, so a
dropped socket never loses work (invariant 13).

## 4. Managed PostgreSQL and backups

- Use a managed PG 16 with automated daily backups + point-in-time recovery (≥ 7 days demo, ≥ 30
  days production), encryption at rest, TLS (`?sslmode=require` in `DATABASE_URL`), no public access
  except from the API's network.
- Logical backup (portable, also for the demo VM):

  ```bash
  pg_dump --format=custom --no-owner --dbname "$DATABASE_URL" --file kagaz-$(date +%F).dump
  ```

- **Restore test (do once per environment, then quarterly):**
  1. Create an empty database `kagaz_restore_test` on the same server.
  2. `pg_restore --no-owner --dbname "postgresql://…/kagaz_restore_test" kagaz-YYYY-MM-DD.dump`
  3. Run `kagaz-api-migrate` against it (must report "No pending migrations").
  4. Start an API container against it with storage pointed at the same bucket; check
     `/api/health`, and that an order from the dump opens in the admin dashboard.
  5. Record date, dump size, restore time and the checks in `docs/testing/backup-restore.md`; drop the test DB.
- Object storage is not in the DB backup. Originals/packets are short-lived by design (retention
  P2.12), so losing them loses only in-flight print files — orders, payments and audit survive.

## 5. Object storage (R2 / S3)

- One private bucket per environment, **no public access**, no custom public domain.
- CORS on the bucket: allow `PUT` and `GET` from the env's `PUBLIC_WEB_URL` only, headers
  `content-type`, `content-length` (browsers upload directly with signed URLs).
- **Lifecycle rule (retention safety net):** expire all objects after **7 days** (prefix: whole
  bucket). The API's retention job (P2.12) deletes files 24 h after collection; the lifecycle rule
  guarantees nothing personal lingers if that job is ever down. Also abort incomplete multipart
  uploads after 1 day.
- Access keys scoped to that single bucket (R2 "Object Read & Write" token for one bucket).

## 6. Observability

- Logs: pino JSON on stdout → platform log drain. Never log tokens, codes or signed URLs (redaction
  is configured in `app.module.ts`).
- Uptime: external monitor on `https://api.<env>/api/health` (1 min) and the web root.
- **Sentry hook-up** (`SENTRY_DSN` is already in the config schema): add `@sentry/node` to the API
  and initialise it first thing in `main.ts` when `SENTRY_DSN` is set, with
  `environment: APP_ENV`, `release: <git sha>`, and `beforeSend` stripping `request.headers`
  (`authorization`, `cookie`, `x-tracking-token`, `x-operator-token`) and query strings; add
  `@sentry/nextjs` to the web with a separate DSN; the Windows agent uses Sentry .NET (P5.4).
  Not wired yet — it's a small follow-up once a Sentry org exists.

## 7. Demo / single-VM option (no managed services)

`infra/docker-compose.demo.yml` runs postgres + SeaweedFS + migrate + api + web on one machine:

```bash
cp infra/demo.env.example infra/demo.env     # fill in real random secrets
docker compose -f infra/docker-compose.demo.yml --env-file infra/demo.env up -d --build
docker compose -f infra/docker-compose.demo.yml --env-file infra/demo.env run --rm migrate   # re-run migrations on upgrade
```

Put a TLS reverse proxy (Caddy/Traefik) in front for anything beyond localhost. The browser talks
to S3 directly, so `S3_ENDPOINT` must be an address both the browser and the API container can
reach (the VM's host name). Seed demo data with `pnpm --filter @kagaz/api db:seed` pointed at the
stack's database, and reset it between rehearsals with `pnpm demo:reset -- --yes`.

## 8. Verified locally (2026-11-07)

On Docker Desktop 29 (Windows 11):

- `kagaz-api` (runtime) built in ~3 min cold, 1.06 GB; `kagaz-api-migrate` 1.39 GB (has dev deps for
  the Prisma CLI); `kagaz-web` built in ~1 min, 413 MB. Image size of the API is dominated by
  production node_modules (AWS SDK, pdf.js, Prisma) — trimming is a follow-up, not a blocker.
- `docker compose -p kagaz-rt-demo -f infra/docker-compose.demo.yml --env-file <env> up -d` with
  host ports 4115/3115/9015: postgres healthy → `migrate` applied `20261105132602_init` and exited 0
  → api **healthy** (`/api/health` db ok, storage ok; `/api/config` → `paymentMode: DEMO`) → web
  healthy (HTTP 200); Socket.IO answered with CORS limited to `PUBLIC_WEB_URL`. Torn down with `down -v`.
- Not yet done: a real cloud deploy, TLS, and the backup-restore test (no accounts exist yet).
