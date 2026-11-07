/**
 * Direct database access for dev tooling only (verify-run, demo-reset, minting pairing codes).
 * Uses the API's generated Prisma client — run `pnpm --filter @kagaz/api prisma:generate` first.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../apps/api/src/generated/prisma/client.js';

export type Db = PrismaClient;

export function openDb(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set (copy .env.example to .env).');
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}

/** Database name from DATABASE_URL, for reports and safety prompts. */
export function dbName(): string {
  try {
    return new URL(process.env.DATABASE_URL ?? '').pathname.slice(1) || '(unknown)';
  } catch {
    return '(unknown)';
  }
}

/** Dev tooling that writes to the DB must never run against production. */
export function refuseInProduction(what: string): void {
  if ((process.env.APP_ENV ?? 'local') === 'production') {
    console.error(`Refusing to ${what}: APP_ENV=production.`);
    process.exit(1);
  }
}
