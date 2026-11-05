/**
 * Demo seed (stage P1.1). Idempotent: safe to re-run; each run prints a fresh device
 * enrollment code for Demo Shop A.
 *
 *   pnpm --filter @kagaz/api db:seed
 *
 * Creates: 3 demo shops in Mandya (OPEN, MANUAL mode, is_demo=true) with pricing,
 * one admin, one owner + one operator per shop (no passwords until P2.3).
 * Printers are not seeded: the shop app registers the real Windows printer (P1.9).
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
    name: 'Kagaz Demo Shop A — College Road',
    address: 'College Road, Mandya, Karnataka',
    pricing: { monoRatePaise: 200, colourRatePaise: 1000, minimumChargePaise: 500 },
  },
  {
    slug: 'demo-shop-b',
    name: 'Kagaz Demo Shop B — Bus Stand',
    address: 'Near KSRTC Bus Stand, Mandya, Karnataka',
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
    name: 'Kagaz Demo Shop C — VV Nagar',
    address: 'VV Nagar, Mandya, Karnataka',
    pricing: { monoRatePaise: 200, colourRatePaise: 1200, minimumChargePaise: 500 },
  },
];

async function upsertUser(email: string, name: string, kind: 'ADMIN' | 'STAFF') {
  return prisma.user.upsert({
    where: { email },
    update: { name, kind },
    create: { email, name, kind },
  });
}

async function main() {
  await upsertUser('admin@kagaz.local', 'Kagaz Admin', 'ADMIN');

  const shops = [];
  for (const [i, def] of SHOPS.entries()) {
    const shop = await prisma.shop.upsert({
      where: { slug: def.slug },
      update: { name: def.name, address: def.address, isDemo: true },
      create: {
        slug: def.slug,
        name: def.name,
        address: def.address,
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
      );
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
  console.log(`Device enrollment code for ${shops[0]!.name}: ${formatCode(code)} (valid 24 h)`);
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
