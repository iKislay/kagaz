import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { type CreateOrderResponse, type PrintOptions, type UploadUrlResponse } from '@kagaz/shared';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { randomCode, sha256Hex } from '../../src/common/crypto/tokens.js';
import { hashPassword } from '../../src/modules/identity/passwords.js';

export interface Harness {
  app: INestApplication;
  prisma: PrismaService;
  http: () => ReturnType<typeof request>;
  close: () => Promise<void>;
}

export async function createHarness(): Promise<Harness> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  await app.init();
  stopBackgroundJobs(app);
  return {
    app,
    prisma: app.get(PrismaService),
    http: () => request(app.getHttpServer()),
    close: () => app.close(),
  };
}

/**
 * Background jobs (lease sweeper, retention, offline detector) are driven explicitly by the
 * tests that need them (e.g. `app.get(PrintLeaseService).sweep()`), never by timers.
 */
function stopBackgroundJobs(app: INestApplication): void {
  const registry = app.get(SchedulerRegistry);
  for (const name of registry.getIntervals()) registry.deleteInterval(name);
  for (const [name] of registry.getCronJobs()) registry.deleteCronJob(name);
}

export interface ShopOptions {
  status?: 'OPEN' | 'CLOSED' | 'MAINTENANCE';
  colour?: boolean;
  duplex?: boolean;
  /** Register a printer with these capabilities (needed for colour/duplex orders). */
  printer?: boolean;
}

/** Creates an isolated shop with pricing: mono ₹2/side, colour ₹10/side, min ₹5. */
export async function createShop(prisma: PrismaService, opts: ShopOptions = {}) {
  const slug = `e2e-${randomCode(8).toLowerCase()}`;
  const shop = await prisma.shop.create({
    data: {
      slug,
      name: `E2E Shop ${slug}`,
      address: 'Test Road, Mandya',
      status: opts.status ?? 'OPEN',
      autoLimits: { maxPages: 50, maxCopies: 5, maxSides: 250, maxQueueDepth: 10 },
      openingHours: {},
      isDemo: true,
      pricing: {
        create: {
          monoRatePaise: 200,
          colourRatePaise: 1000,
          minimumChargePaise: 500,
          effectiveFrom: new Date(0),
        },
      },
    },
  });
  if (opts.printer) {
    await prisma.printer.create({
      data: {
        shopId: shop.id,
        printerName: `E2E Printer ${slug}`,
        displayName: 'E2E Printer',
        colourCapable: opts.colour ?? false,
        duplexCapable: opts.duplex ?? false,
        capabilitiesConfirmed: true,
        isDefault: true,
      },
    });
  }
  return shop;
}

export const MONO: PrintOptions = { copies: 1, colour: false, duplex: false, paperSize: 'A4' };

export async function createOrder(
  h: Harness,
  shopId: string,
  options: PrintOptions = MONO,
): Promise<CreateOrderResponse> {
  const res = await h.http().post('/api/orders').send({ shopId, options }).expect(201);
  return res.body as CreateOrderResponse;
}

/** Full upload: get signed URL, PUT bytes to storage, call upload-complete. */
export async function uploadPdf(
  h: Harness,
  order: CreateOrderResponse,
  pdf: Buffer,
): Promise<request.Response> {
  const tok = { 'x-tracking-token': order.trackingToken };
  const urlRes = await h
    .http()
    .post(`/api/orders/${order.order.id}/upload-url`)
    .set(tok)
    .send({ bytes: pdf.length })
    .expect(200);
  const upload = urlRes.body as UploadUrlResponse;
  const put = await fetch(upload.uploadUrl, {
    method: 'PUT',
    headers: upload.headers,
    body: new Uint8Array(pdf),
  });
  if (!put.ok) throw new Error(`storage PUT failed: ${put.status} ${await put.text()}`);
  return h
    .http()
    .post(`/api/orders/${order.order.id}/upload-complete`)
    .set(tok)
    .send({ fileId: upload.fileId });
}

// ─── Devices + operators (contract §4) ───

/** Password of every staff user created by createStaff(). */
export const E2E_STAFF_PASSWORD = 'E2e-Operator-Pass-1!';
let staffHash: Promise<string> | null = null;

/** A staff user (Argon2id password = E2E_STAFF_PASSWORD) who is a member of the shop. */
export async function createStaff(
  prisma: PrismaService,
  shopId: string,
  role: 'OWNER' | 'OPERATOR' = 'OPERATOR',
): Promise<{ userId: string; email: string; name: string }> {
  staffHash ??= hashPassword(E2E_STAFF_PASSWORD);
  const tag = randomCode(8).toLowerCase();
  const email = `${role.toLowerCase()}-${tag}@e2e.kagaz.local`;
  const name = `E2E ${role === 'OWNER' ? 'Owner' : 'Operator'} ${tag}`;
  const user = await prisma.user.create({
    data: { email, name, kind: 'STAFF', passwordHash: await staffHash },
  });
  await prisma.shopUser.create({ data: { shopId, userId: user.id, role } });
  return { userId: user.id, email, name };
}

export interface PairedDevice {
  deviceId: string;
  deviceToken: string;
  operatorToken: string;
  operatorId: string;
  operatorName: string;
  /** Device token only — agent calls (jobs, lease, status, heartbeat). */
  auth: Record<string, string>;
  /** Device token + X-Operator-Token — human actions (accept, reject, ready, verify, …). */
  opAuth: Record<string, string>;
}

/**
 * Pairs a new device to the shop with a one-time code, creates a shop member and signs them
 * in on that device through the real API. Returns both tokens and ready-made header sets.
 */
export async function pairDevice(
  h: Harness,
  shopId: string,
  opts: { role?: 'OWNER' | 'OPERATOR'; deviceName?: string } = {},
): Promise<PairedDevice> {
  const code = randomCode(8);
  await h.prisma.enrollmentCode.create({
    data: { shopId, codeHash: sha256Hex(code), expiresAt: new Date(Date.now() + 60_000) },
  });
  const enrolled = await h
    .http()
    .post('/api/devices/enroll')
    .send({ code, name: opts.deviceName ?? 'Counter PC' })
    .expect(201);
  const deviceToken = enrolled.body.deviceToken as string;
  const auth = { Authorization: `Bearer ${deviceToken}` };

  const staff = await createStaff(h.prisma, shopId, opts.role ?? 'OPERATOR');
  const login = await h
    .http()
    .post('/api/shop/operator/login')
    .set(auth)
    .send({ login: staff.email, password: E2E_STAFF_PASSWORD })
    .expect(200);
  const operatorToken = login.body.operatorToken as string;
  return {
    deviceId: enrolled.body.device.id as string,
    deviceToken,
    operatorToken,
    operatorId: staff.userId,
    operatorName: staff.name,
    auth,
    opAuth: { ...auth, 'X-Operator-Token': operatorToken },
  };
}
