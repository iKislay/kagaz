# Backup and restore

What to back up, how, and how to prove the backup works. PostgreSQL holds everything that matters
(orders, payments, refunds, print jobs, audit, shops, pricing, devices). Object storage holds only
short-lived print files.

Commands below work in Git Bash and PowerShell (replace `$(date +%F)` with `$(Get-Date -Format yyyy-MM-dd)`
in PowerShell). Use PostgreSQL **16** client tools (same major version as the server).

## 1. What to back up

| Data                                      | Where                                         | Back up?                                                                                                         |
| ----------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Orders, payments, refunds, audit, config  | PostgreSQL                                    | **Yes** — daily, plus before every migration/release.                                                            |
| Original PDFs and print packets           | Private bucket (SeaweedFS local, R2/S3 cloud) | **No.** Deleted by retention within hours/days by design (PRD §14.3). Losing them only affects in-flight orders. |
| Secrets (`SESSION_JWT_SECRET`, S3 keys …) | `.env` locally, secret manager in cloud       | Keep in the team password manager / secret manager. Never inside a DB dump or the repo.                          |
| Shop PC state                             | `%LOCALAPPDATA%\Kagaz\` on each PC            | No. A broken PC is re-paired ([SUPPORT_RUNBOOK.md §4](SUPPORT_RUNBOOK.md#4-device-re-pair)).                     |

Dumps contain customer phone numbers and order data. Store them encrypted, with restricted access,
and delete old ones (keep 7 daily + 4 weekly for demo).

## 2. Local (Docker Postgres from `pnpm infra:up`)

Container service `postgres`, user/db `kagaz` (see `infra/docker-compose.yml`).

**Backup** (no local `pg_dump` needed):

```bash
docker compose -f infra/docker-compose.yml exec -T postgres \
  pg_dump -U kagaz -d kagaz --format=custom --no-owner > kagaz-local-$(date +%F).dump
```

**Restore into a fresh database** (keeps the current one untouched):

```bash
docker compose -f infra/docker-compose.yml exec -T postgres createdb -U kagaz kagaz_restore
docker compose -f infra/docker-compose.yml exec -T postgres \
  pg_restore -U kagaz -d kagaz_restore --no-owner < kagaz-local-YYYY-MM-DD.dump
```

**Replace the dev database** (stop `pnpm dev` first; this deletes current data):

```bash
docker compose -f infra/docker-compose.yml exec -T postgres dropdb -U kagaz kagaz
docker compose -f infra/docker-compose.yml exec -T postgres createdb -U kagaz kagaz
docker compose -f infra/docker-compose.yml exec -T postgres \
  pg_restore -U kagaz -d kagaz --no-owner < kagaz-local-YYYY-MM-DD.dump
pnpm --filter @kagaz/api db:migrate      # must apply nothing, or only newer migrations
```

Note: `pnpm infra:down` keeps the data volumes; `docker compose … down -v` deletes them.

The all-in-one demo stack (`infra/docker-compose.demo.yml`) works the same way: add
`--env-file infra/demo.env` and use that compose file.

## 3. Managed PostgreSQL (demo / staging / production)

1. Turn on the provider's **automated daily backups and point-in-time recovery** (≥ 7 days demo,
   ≥ 30 days production). This is the main protection.
2. Also take a portable logical dump before each release and weekly:

   ```bash
   pg_dump --format=custom --no-owner --dbname "$DATABASE_URL" --file kagaz-<env>-$(date +%F).dump
   ```

   `DATABASE_URL` must include `?sslmode=require`. Run it from a machine allowed through the DB
   firewall. Don't put the URL in shell history on shared machines.

3. **Point-in-time restore** (accidental delete, bad migration): use the provider's console to
   restore to a **new** instance at a time just before the problem. Point a staging API at it,
   check, then switch `DATABASE_URL` of the environment (or copy the needed rows back). Never
   restore over the live instance in place.

4. **Restore from a dump:**

   ```bash
   createdb --maintenance-db "$ADMIN_DATABASE_URL" kagaz_restore_test
   pg_restore --no-owner --dbname "postgresql://…/kagaz_restore_test?sslmode=require" kagaz-<env>-YYYY-MM-DD.dump
   ```

## 4. Restore test (once per environment, then quarterly)

1. Restore the latest dump into an empty `kagaz_restore_test` (above).
2. Run the migrate image against it: `kagaz-api-migrate` with that `DATABASE_URL` → must say
   **"No pending migrations"** (or apply only newer ones).
3. Start an API against it (same bucket, same secrets as the environment). `GET /api/health` → ok.
4. Sign in to admin; open a recent order: event history, payment and audit are there.
5. Record date, dump size, restore time and checks in `docs/testing/backup-restore.md`. Drop the
   test database.

## 5. Object storage notes

- **Local SeaweedFS:** data is in the `seaweeddata` Docker volume. Not backed up. If lost, run
  `pnpm infra:up` again (the `storage-init` job recreates the private bucket `kagaz-local`).
- **R2/S3:** one private bucket per environment with a 7-day lifecycle rule. No backup and no
  versioning on purpose — print files must not outlive retention.
- After a DB restore, some orders may point at files that no longer exist (expired). That is
  expected: those orders are past printing. An order still in `QUEUED`/`PENDING_REVIEW` whose
  packet is gone can't print; reject and refund it ([SUPPORT_RUNBOOK.md §3](SUPPORT_RUNBOOK.md#3-refunds)).
- Never make a bucket public to "copy files out". Use the S3 API with the bucket's scoped keys.

## 6. After any restore

- Shop PCs keep working: device identities are in the DB. Revoked devices stay revoked.
- Orders that were printing at backup time may show an old status. Check the shops' **Needs
  check** and Queue tabs and the admin **Reconciliation** page for the restored period.
- Payments made after the backup time are missing from the DB but exist at the provider (live
  mode only). Reconcile them from the provider's dashboard before reopening shops.
- Write a short note in the incident log ([INCIDENT_CHECKLIST.md](INCIDENT_CHECKLIST.md)).
