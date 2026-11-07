import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * P3.2 / FR-PAY-03: the real entrypoint must exit non-zero when production is configured with
 * the demo payment provider or demo OTP — before Nest, the DB or anything else starts.
 */
const apiDir = fileURLToPath(new URL('..', import.meta.url));

const env = {
  PATH: process.env.PATH,
  SystemRoot: process.env.SystemRoot,
  APP_ENV: 'production',
  PUBLIC_WEB_URL: 'https://kagaz.example',
  DATABASE_URL: 'postgresql://kagaz:kagaz@127.0.0.1:1/never',
  S3_ENDPOINT: 'https://s3.example',
  S3_BUCKET: 'kagaz-prod',
  S3_ACCESS_KEY_ID: 'key',
  S3_SECRET_ACCESS_KEY: 'secret',
  PAYMENT_PROVIDER: 'demo',
  OTP_PROVIDER: 'demo',
  DEMO_WEBHOOK_SECRET: 'w'.repeat(40),
  SESSION_JWT_SECRET: 'x'.repeat(40),
  PICKUP_CODE_PEPPER: 'y'.repeat(40),
  PICKUP_CODE_ENC_KEY: Buffer.alloc(32, 7).toString('base64'),
};

function boot(overrides: Record<string, string>) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
    cwd: apiDir,
    env: { ...env, ...overrides },
    encoding: 'utf8',
    timeout: 60_000,
  });
}

describe('boot-time production guard', () => {
  it('exits non-zero with production + demo payment provider', () => {
    const run = boot({});
    expect(run.status).not.toBe(0);
    expect(run.status).not.toBeNull();
    expect(run.stderr).toMatch(/PAYMENT_PROVIDER=demo/);
  }, 60_000);

  it('exits non-zero with production + demo OTP provider', () => {
    const run = boot({ PAYMENT_PROVIDER: 'razorpay' });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/OTP_PROVIDER=demo/);
  }, 60_000);
});
