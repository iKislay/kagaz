/**
 * Demo seed (stage P1.1). Idempotent: safe to re-run; each run prints a fresh device
 * enrollment code for Demo Shop A.
 *
 *   pnpm --filter @kagaz/api db:seed
 *
 * Creates: 3 demo shops in Mandya (OPEN, MANUAL mode, is_demo=true) with pricing,
 * one admin, one owner + one operator per shop. Staff passwords come from SEED_STAFF_PASSWORD
 * (local/demo default "kagaz-demo-123"; other environments must set it) and are printed.
 * Printers are not seeded: the shop app registers the real Windows printer (P1.9).
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { hash } from '@node-rs/argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { formatCode, randomCode, sha256Hex } from '../src/common/crypto/tokens.js';

const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const appEnv = process.env.APP_ENV ?? 'local';
if (appEnv === 'production') {
  console.error('Refusing to seed demo data into production.');
  process.exit(1);
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const DEFAULT_AUTO_LIMITS = { maxPages: 50, maxCopies: 5, maxSides: 250, maxQueueDepth: 10 };
const DAILY = [['08:00', '21:00']];
const OPENING_HOURS = {
  mon: DAILY,
  tue: DAILY,
  wed: DAILY,
  thu: DAILY,
  fri: DAILY,
  sat: DAILY,
  sun: [],
};

const SHOPS = [
  {
    slug: 'demo-shop-a',
    name: 'Kaggaz Demo Shop A — College Road',
    address: 'College Road, Mandya, Karnataka',
    location: { latitude: 12.5243, longitude: 76.8968 },
    pricing: { monoRatePaise: 200, colourRatePaise: 1000, minimumChargePaise: 500 },
  },
  {
    slug: 'demo-shop-b',
    name: 'Kaggaz Demo Shop B — Bus Stand',
    address: 'Near KSRTC Bus Stand, Mandya, Karnataka',
    location: { latitude: 12.5218, longitude: 76.8951 },
    pricing: {
      monoRatePaise: 150,
      colourRatePaise: 800,
      monoDuplexRatePaise: 120,
      colourDuplexRatePaise: 700,
      duplexRule: 'DISCOUNTED_SIDE_RATE' as const,
      minimumChargePaise: 300,
    },
  },
  {
    slug: 'demo-shop-c',
    name: 'Kaggaz Demo Shop C — VV Nagar',
    address: 'VV Nagar, Mandya, Karnataka',
    location: { latitude: 12.5334, longitude: 76.8901 },
    pricing: { monoRatePaise: 200, colourRatePaise: 1200, minimumChargePaise: 500 },
  },
];

async function upsertUser(
  email: string,
  name: string,
  kind: 'ADMIN' | 'STAFF',
  passwordHash?: string,
) {
  return prisma.user.upsert({
    where: { email },
    update: passwordHash ? { name, kind, passwordHash } : { name, kind },
    create: { email, name, kind, ...(passwordHash ? { passwordHash } : {}) },
  });
}

/** Local/demo-only default for seeded shop staff (contract §4). Never used elsewhere. */
const DEMO_STAFF_PASSWORD = 'kagaz-demo-123';

async function main() {
  const staffPassword =
    process.env.SEED_STAFF_PASSWORD ??
    (appEnv === 'local' || appEnv === 'demo' ? DEMO_STAFF_PASSWORD : undefined);
  if (!staffPassword) {
    console.error(`SEED_STAFF_PASSWORD is required when APP_ENV=${appEnv}.`);
    process.exit(1);
  }
  const staffPasswordHash = await hash(staffPassword);
  const staffLogins: string[] = [];

  const adminEmail = 'admin@kagaz.local';
  const seedPassword = process.env.SEED_ADMIN_PASSWORD;
  let adminPasswordHash: string | undefined;
  let printedPassword: string | undefined;

  if (seedPassword) {
    adminPasswordHash = await hash(seedPassword);
  } else {
    const existing = await prisma.user.findUnique({
      where: { email: adminEmail },
      select: { passwordHash: true },
    });
    if (!existing?.passwordHash) {
      const generated = randomBytes(24).toString('base64url');
      adminPasswordHash = await hash(generated);
      printedPassword = generated;
    }
  }

  await upsertUser(adminEmail, 'Kaggaz Admin', 'ADMIN', adminPasswordHash);
  if (printedPassword) {
    console.log(`Admin password for ${adminEmail}: ${printedPassword}`);
  }

  const shops = [];
  for (const [i, def] of SHOPS.entries()) {
    const shop = await prisma.shop.upsert({
      where: { slug: def.slug },
      update: { name: def.name, address: def.address, isDemo: true, ...def.location },
      create: {
        slug: def.slug,
        name: def.name,
        address: def.address,
        ...def.location,
        status: 'OPEN',
        approvalMode: 'MANUAL',
        autoLimits: DEFAULT_AUTO_LIMITS,
        openingHours: OPENING_HOURS,
        isDemo: true,
      },
    });
    shops.push(shop);

    const hasPricing = await prisma.shopPricing.count({ where: { shopId: shop.id } });
    if (!hasPricing) {
      await prisma.shopPricing.create({
        data: { shopId: shop.id, effectiveFrom: new Date(0), ...def.pricing },
      });
    }

    const letter = String.fromCharCode(97 + i); // a, b, c
    for (const role of ['OWNER', 'OPERATOR'] as const) {
      const user = await upsertUser(
        `${role.toLowerCase()}-${letter}@kagaz.local`,
        `Shop ${letter.toUpperCase()} ${role === 'OWNER' ? 'Owner' : 'Operator'}`,
        'STAFF',
        staffPasswordHash,
      );
      staffLogins.push(`${user.email} (${role.toLowerCase()}, ${def.slug})`);
      await prisma.shopUser.upsert({
        where: { shopId_userId: { shopId: shop.id, userId: user.id } },
        update: { role },
        create: { shopId: shop.id, userId: user.id, role },
      });
    }
  }

  // One-time device enrollment code for Shop A (the shop with the real demo printer).
  const code = randomCode(8);
  await prisma.enrollmentCode.create({
    data: {
      shopId: shops[0]!.id,
      codeHash: sha256Hex(code),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  console.log(`Seeded ${shops.length} demo shops (APP_ENV=${appEnv}).`);
  const shownPassword =
    staffPassword === DEMO_STAFF_PASSWORD ? staffPassword : 'value of SEED_STAFF_PASSWORD';
  console.log(`Shop staff logins (password: ${shownPassword}):`);
  for (const login of staffLogins) console.log(`  ${login}`);
  console.log(`Device enrollment code for ${shops[0]!.name}: ${formatCode(code)} (valid 24 h)`);
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
