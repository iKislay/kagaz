import 'reflect-metadata';
import { type INestApplication } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { type CreateOrderResponse, type PrintOptions, type UploadUrlResponse } from '@kagaz/shared';
import { AppModule } from '../../src/app.module.js';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { randomCode } from '../../src/common/crypto/tokens.js';

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
