/**
 * Pilot bootstrap: creates the Kagaz admin and the REAL pilot shops (not demo shops) from a JSON
 * file, idempotently. Prints new passwords and a fresh device pairing code per shop.
 *
 * Inside the pilot stack (infra/docker-compose.pilot.yml):
 *   docker compose -f infra/docker-compose.pilot.yml --env-file infra/pilot.env \
 *     exec api node dist/cli/pilot-bootstrap.js /config/pilot-shops.json
 * Locally:
 *   pnpm --filter @kagaz/api exec tsx src/cli/pilot-bootstrap.ts ../../infra/pilot-shops.json
 *
 * Passwords are generated only when an account is created (or with --reset-passwords) and are
 * printed once — they are never stored in the file. Never prints secrets other than those.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { hash } from '@node-rs/argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { z } from 'zod';
import { formatCode, randomCode, sha256Hex } from '../common/crypto/tokens.js';
import { PrismaClient } from '../generated/prisma/client.js';

const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'use HH:MM (24 h)');
const Paise = z.int().nonnegative();
const Day = z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);

const ConfigSchema = z.strictObject({
  admin: z.strictObject({ email: z.email(), name: z.string().min(1).default('Kagaz Admin') }),
  shops: z
    .array(
      z.strictObject({
        slug: z.string().regex(/^[a-z0-9-]{3,40}$/),
        name: z.string().min(2).max(80),
        address: z.string().min(2).max(200),
        contactPhone: z
          .string()
          .regex(/^\+91[6-9]\d{9}$/)
          .optional(),
        approvalMode: z.enum(['MANUAL', 'AUTO']).default('MANUAL'),
        open: z.boolean().default(true),
        hours: z
          .strictObject({
            days: z.array(Day).min(1).default(['mon', 'tue', 'wed', 'thu', 'fri', 'sat']),
            from: Time.default('09:00'),
            to: Time.default('20:00'),
          })
          .default({
            days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'],
            from: '09:00',
            to: '20:00',
          }),
        pricing: z.strictObject({
          monoRatePaise: Paise,
          colourRatePaise: Paise,
          minimumChargePaise: Paise.default(0),
          monoDuplexRatePaise: Paise.optional(),
          colourDuplexRatePaise: Paise.optional(),
          duplexRule: z
            .enum(['SAME_AS_SIMPLEX', 'DISCOUNTED_SIDE_RATE'])
            .default('SAME_AS_SIMPLEX'),
        }),
        staff: z
          .array(
            z.strictObject({
              name: z.string().min(1),
              email: z.email().optional(),
              phone: z
                .string()
                .regex(/^\+91[6-9]\d{9}$/)
                .optional(),
              role: z.enum(['OWNER', 'OPERATOR']).default('OWNER'),
            }),
          )
          .min(1),
      }),
    )
    .min(1),
});

type Config = z.infer<typeof ConfigSchema>;

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const resetPasswords = args.includes('--reset-passwords');
if (!file) {
  console.error('usage: pilot-bootstrap <pilot-shops.json> [--reset-passwords]');
  process.exit(2);
}
if (process.env.APP_ENV === 'production') {
  // Production would also need a real OTP provider; the pilot runs as APP_ENV=staging.
  console.error('Refusing to run with APP_ENV=production (pilot runs as staging).');
  process.exit(1);
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});
const newPassword = () => randomBytes(9).toString('base64url');

async function upsertUser(
  who: { email?: string; phone?: string; name: string },
  kind: 'ADMIN' | 'STAFF',
): Promise<{ id: string; login: string; password: string | null }> {
  if (!who.email && !who.phone) throw new Error(`${who.name}: give an email or a phone`);
  const where = who.email ? { email: who.email.toLowerCase() } : { phone: who.phone! };
  const existing = await prisma.user.findUnique({ where });
  const password = !existing?.passwordHash || resetPasswords ? newPassword() : null;
  const passwordHash = password ? await hash(password) : undefined;
  const data = {
    name: who.name,
    kind,
    ...(who.email ? { email: who.email.toLowerCase() } : {}),
    ...(who.phone ? { phone: who.phone } : {}),
    ...(passwordHash ? { passwordHash } : {}),
  };
  const user = existing
    ? await prisma.user.update({ where: { id: existing.id }, data })
    : await prisma.user.create({ data });
  return { id: user.id, login: who.email?.toLowerCase() ?? who.phone!, password };
}

async function main(config: Config) {
  const lines: string[] = [];
  const admin = await upsertUser(config.admin, 'ADMIN');
  lines.push(
    `Admin  ${admin.login}  ${admin.password ? `password: ${admin.password}` : '(password unchanged)'}`,
  );

  for (const def of config.shops) {
    const hoursRange = [[def.hours.from, def.hours.to]];
    const openingHours = Object.fromEntries(def.hours.days.map((d) => [d, hoursRange]));
    const shop = await prisma.shop.upsert({
      where: { slug: def.slug },
      update: {
        name: def.name,
        address: def.address,
        contactPhone: def.contactPhone ?? null,
        openingHours,
        isDemo: false,
      },
      create: {
        slug: def.slug,
        name: def.name,
        address: def.address,
        contactPhone: def.contactPhone ?? null,
        status: def.open ? 'OPEN' : 'CLOSED',
        approvalMode: def.approvalMode,
        autoLimits: { maxPages: 50, maxCopies: 5, maxSides: 250, maxQueueDepth: 10 },
        openingHours,
        isDemo: false,
      },
    });

    const latest = await prisma.shopPricing.findFirst({
      where: { shopId: shop.id },
      orderBy: { effectiveFrom: 'desc' },
    });
    const p = def.pricing;
    const samePricing =
      latest &&
      latest.monoRatePaise === p.monoRatePaise &&
      latest.colourRatePaise === p.colourRatePaise &&
      latest.minimumChargePaise === p.minimumChargePaise &&
      latest.duplexRule === p.duplexRule &&
      (latest.monoDuplexRatePaise ?? undefined) === p.monoDuplexRatePaise &&
      (latest.colourDuplexRatePaise ?? undefined) === p.colourDuplexRatePaise;
    if (!samePricing) {
      // Prices are versioned (never edited): a change is a new row effective now.
      await prisma.shopPricing.create({
        data: { shopId: shop.id, effectiveFrom: latest ? new Date() : new Date(0), ...p },
      });
    }

    lines.push('', `Shop   ${shop.name}  (${shop.slug}, id ${shop.id})`);
    for (const member of def.staff) {
      const user = await upsertUser(member, 'STAFF');
      await prisma.shopUser.upsert({
        where: { shopId_userId: { shopId: shop.id, userId: user.id } },
        update: { role: member.role },
        create: { shopId: shop.id, userId: user.id, role: member.role },
      });
      lines.push(
        `  ${member.role.toLowerCase().padEnd(8)} ${user.login}  ${user.password ? `password: ${user.password}` : '(password unchanged)'}`,
      );
    }

    const code = randomCode(8);
    await prisma.enrollmentCode.create({
      data: {
        shopId: shop.id,
        codeHash: sha256Hex(code),
        expiresAt: new Date(Date.now() + 24 * 3600_000),
      },
    });
    lines.push(`  PC pairing code: ${formatCode(code)}  (one use, valid 24 h)`);
  }

  console.log(
    [
      '',
      '=== Kagaz pilot bootstrap ===',
      ...lines,
      '',
      'Store these passwords now: they are not shown again.',
      '',
    ].join('\n'),
  );
}

const parsed = ConfigSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
if (!parsed.success) {
  console.error('Invalid pilot config:');
  for (const issue of parsed.error.issues)
    console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
  process.exit(1);
}
main(parsed.data)
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
