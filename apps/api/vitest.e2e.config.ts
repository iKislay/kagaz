import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * End-to-end tests against real Postgres + S3 (pnpm infra:up first).
 * Uses a separate database (<dev db>_test) that global-setup drops and re-migrates each run,
 * so local dev data is never touched.
 */
const rootEnv = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const testUrl = new URL(
  process.env.DATABASE_URL ?? 'postgresql://kagaz:kagaz@localhost:5432/kagaz',
);
testUrl.pathname = `${testUrl.pathname}_test`;

const testEnv = {
  APP_ENV: 'local',
  DATABASE_URL: testUrl.toString(),
  LOG_LEVEL: 'silent',
  PAYMENT_PROVIDER: 'demo',
};
// global-setup runs in this process; workers get the same values via test.env.
Object.assign(process.env, testEnv);

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/e2e/**/*.e2e.test.ts'],
    globalSetup: ['test/e2e/global-setup.ts'],
    env: testEnv,
    // One DB for the whole run: keep files sequential to avoid cross-test interference.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
