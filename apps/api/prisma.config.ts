import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, env } from 'prisma/config';

// Prisma 7 does not load .env automatically; use the repo-root .env when present.
const rootEnv = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
