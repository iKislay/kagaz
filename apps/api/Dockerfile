# syntax=docker/dockerfile:1.7
# Kagaz API image. Build from the REPO ROOT:
#   docker build -f apps/api/Dockerfile -t kagaz-api .
# Targets:
#   runtime (default) — `node dist/main.js`, non-root, healthcheck on /api/health
#   migrate           — `prisma migrate deploy`; run once per release BEFORE starting runtime
# Configuration comes from the environment (docs/runbooks/DEPLOYMENT.md); no .env is baked in.

ARG NODE_VERSION=24-bookworm-slim

FROM node:${NODE_VERSION} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /repo

# ── Dependency manifests only (cache-friendly) ──
FROM base AS manifests
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY scripts/package.json scripts/

# ── Full deps (build + prisma CLI for migrations) ──
FROM manifests AS deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @kagaz/api...

# ── Build shared + api (generates the Prisma client into src/generated) ──
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
# prisma.config.ts requires DATABASE_URL to be set; `prisma generate` never connects to it.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build \
    sh -c 'pnpm --filter @kagaz/shared build && pnpm --filter @kagaz/api build'

# ── Production-only node_modules ──
FROM manifests AS prod-deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --filter @kagaz/api...

# ── Release step: apply migrations (prisma CLI is a devDependency) ──
FROM deps AS migrate
COPY apps/api/prisma apps/api/prisma
COPY apps/api/prisma.config.ts apps/api/
WORKDIR /repo/apps/api
USER node
CMD ["pnpm", "exec", "prisma", "migrate", "deploy"]

# ── Runtime ──
FROM node:${NODE_VERSION} AS runtime
ENV NODE_ENV=production API_PORT=4000
WORKDIR /app
COPY --from=prod-deps --chown=node:node /repo /app
COPY --from=build --chown=node:node /repo/packages/shared/dist /app/packages/shared/dist
COPY --from=build --chown=node:node /repo/apps/api/dist /app/apps/api/dist
WORKDIR /app/apps/api
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "dist/main.js"]
