#!/usr/bin/env node
/**
 * Writes infra/pilot.env for infra/docker-compose.pilot.yml with every secret generated here.
 * You only supply the domain (on Cloudflare) and the Cloudflare Tunnel token.
 *
 *   node scripts/pilot-env.mjs --domain kagaz.example.in [--tunnel-token <token>] [--force]
 *
 * Also copies infra/pilot-shops.example.json → infra/pilot-shops.json if it does not exist
 * (fill in the real shop, prices and staff). Both outputs are gitignored. Re-running never
 * overwrites existing secrets unless --force (rotating keys breaks existing data: see the runbook).
 */
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, 'infra', 'pilot.env');
const shopsPath = join(root, 'infra', 'pilot-shops.json');
const shopsExample = join(root, 'infra', 'pilot-shops.example.json');

const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const domain = (arg('domain') ?? '')
  .trim()
  .toLowerCase()
  .replace(/^https?:\/\//, '')
  .replace(/\/+$/, '');
if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(domain)) {
  console.error(
    'usage: node scripts/pilot-env.mjs --domain <your-domain.in> [--tunnel-token <token>] [--force]',
  );
  process.exit(2);
}
if (existsSync(envPath) && !args.includes('--force')) {
  console.error(
    `${envPath} already exists — not overwriting secrets. Use --force only for a fresh install.`,
  );
  process.exit(1);
}

const b64 = (n) => randomBytes(n).toString('base64');
const hex = (n) => randomBytes(n).toString('hex');
const tunnel = arg('tunnel-token') ?? 'PASTE-CLOUDFLARE-TUNNEL-TOKEN-HERE';

const env = `# Kagaz pilot environment — generated ${new Date().toISOString()} by scripts/pilot-env.mjs
# SECRET: keep this file only on the pilot server. Back it up somewhere safe (password manager).
# Changing PICKUP_CODE_ENC_KEY or PAYMENT_SECRETS_KEY later breaks existing orders / shop setups.

PILOT_DOMAIN=${domain}
# Cloudflare Zero Trust → Networks → Tunnels → your tunnel → "Install connector" token.
CLOUDFLARE_TUNNEL_TOKEN=${tunnel}

POSTGRES_PASSWORD=${hex(24)}
S3_ACCESS_KEY_ID=kagaz${hex(8)}
S3_SECRET_ACCESS_KEY=${hex(32)}

SESSION_JWT_SECRET=${b64(48)}
PICKUP_CODE_PEPPER=${b64(48)}
PICKUP_CODE_ENC_KEY=${b64(32)}
PAYMENT_SECRETS_KEY=${b64(32)}

YOUPI_ADMIN_TOKEN=${hex(32)}
YOUPI_ANDROID_ENROLLMENT_SECRET=${hex(32)}
# Where the YouPI-PG checkout lives on this machine (relative to infra/).
YOUPI_SRC=../../YouPI-PG

# Customer may report "I paid" this many seconds after starting checkout.
PAYMENT_CLAIM_AFTER_SECONDS=90
LOG_LEVEL=info
SENTRY_DSN=
`;
writeFileSync(envPath, env, { mode: 0o600 });
console.log(`Wrote ${envPath}`);
if (!existsSync(shopsPath)) {
  copyFileSync(shopsExample, shopsPath);
  console.log(`Wrote ${shopsPath} — edit it with the real shop, prices and staff.`);
}
console.log(`
Next:
  1. ${tunnel.startsWith('PASTE') ? 'Paste the Cloudflare Tunnel token into infra/pilot.env.\n  2.' : '1b.'} In the tunnel, add public hostnames:
       app.${domain}     → http://web:3000
       api.${domain}     → http://api:4000
       files.${domain}   → http://seaweedfs:8333
       pay.${domain}     → http://youpi:7000
       pay-api.${domain} → http://youpi:6100
  3. docker compose -f infra/docker-compose.pilot.yml --env-file infra/pilot.env up -d --build
  4. docker compose -f infra/docker-compose.pilot.yml --env-file infra/pilot.env exec api node dist/cli/pilot-bootstrap.js /config/pilot-shops.json
Full guide: docs/runbooks/PILOT_SHOP_TEST.md`);
