import { type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { APP_CONFIG } from '../common/config/config.module.js';
import { loadConfig } from '../common/config/config.schema.js';
import { ApiExceptionFilter } from '../common/http/api-exception.filter.js';
import { PrismaService } from '../common/prisma/prisma.service.js';
import { StorageService } from '../modules/files/storage.service.js';
import { HealthController } from './health.controller.js';

const config = loadConfig({
  APP_ENV: 'local',
  PUBLIC_WEB_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgresql://x:y@localhost:5432/z',
  S3_ENDPOINT: 'http://localhost:9000',
  S3_BUCKET: 'b',
  S3_ACCESS_KEY_ID: 'k',
  S3_SECRET_ACCESS_KEY: 's',
  PAYMENT_PROVIDER: 'demo',
  OTP_PROVIDER: 'demo',
  SESSION_JWT_SECRET: 'x'.repeat(32),
});

async function makeApp(dbOk: boolean, storageOk: boolean): Promise<INestApplication> {
  const probe = (ok: boolean) => async () => {
    if (!ok) throw new Error('down');
  };
  const moduleRef = await Test.createTestingModule({
    controllers: [HealthController],
    providers: [
      { provide: APP_CONFIG, useValue: config },
      { provide: PrismaService, useValue: { ping: probe(dbOk) } },
      { provide: StorageService, useValue: { ping: probe(storageOk) } },
    ],
  }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.init();
  return app;
}

describe('HealthController', () => {
  let app: INestApplication | undefined;
  afterEach(async () => {
    await app?.close();
  });

  it('GET /api/health → 200 ok when db and storage are reachable', async () => {
    app = await makeApp(true, true);
    const res = await request(app.getHttpServer()).get('/api/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', db: 'ok', storage: 'ok' });
  });

  it('GET /api/health → 503 and names the failing dependency', async () => {
    app = await makeApp(true, false);
    const res = await request(app.getHttpServer()).get('/api/health').expect(503);
    expect(res.body).toMatchObject({ status: 'error', db: 'ok', storage: 'error' });
  });

  it('GET /api/config exposes DEMO payment mode', async () => {
    app = await makeApp(true, true);
    const res = await request(app.getHttpServer()).get('/api/config').expect(200);
    expect(res.body.paymentMode).toBe('DEMO');
  });

  it('unknown routes return the standard error envelope', async () => {
    app = await makeApp(true, true);
    const res = await request(app.getHttpServer()).get('/api/nope').expect(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: expect.any(String) } });
  });
});
