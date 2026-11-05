# Kagaz

Multi-shop **print-order orchestration** for local print shops in Mandya, Karnataka. Customers upload a PDF, pick a shop, pay and track their order on the web. The shop's Windows app prints one combined PDF (customer pages + a pickup slip), and the customer collects it with a one-time pickup code.

> **Status:** investor prototype in development. Payments are **simulated** (demo mode, no money moves).

| Doc                                                        | What it covers                                                            |
| ---------------------------------------------------------- | ------------------------------------------------------------------------- |
| [docs/PRD.md](docs/PRD.md)                                 | Product requirements, business rules, state models, API, acceptance tests |
| [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) | Phases and stages (P0.1 → P5.7) with "done when" criteria                 |
| [CLAUDE.md](CLAUDE.md)                                     | Repo layout, commands, non-negotiable invariants, conventions             |
| [docs/architecture.png](docs/architecture.png)             | System architecture diagram                                               |

## Repository

```
apps/api/          NestJS API (TypeScript, Prisma, PostgreSQL)
apps/web/          Next.js customer website + admin dashboard
apps/shop-agent/   .NET WPF Windows shop app
packages/shared/   Shared enums, schemas and helpers
infra/             Local Postgres + MinIO (docker compose)
```

## Quick start

Prerequisites: Node 24+, pnpm 9, Docker Desktop, .NET 10 SDK (for the shop app).

```bash
pnpm install
cp .env.example .env
pnpm infra:up
pnpm dev
```

- API: http://localhost:4000/api/health
- Web: http://localhost:3000

See [CLAUDE.md](CLAUDE.md#commands) for all commands.
