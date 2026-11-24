import { randomUUID } from 'node:crypto';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from './common/config/config.module.js';
import { EventsModule } from './common/events/events.module.js';
import { loadConfig } from './common/config/config.schema.js';
import { ApiExceptionFilter } from './common/http/api-exception.filter.js';
import { PrismaModule } from './common/prisma/prisma.module.js';
import { runInTenantScope } from './common/prisma/tenant-scope.js';
import { HealthController } from './health/health.controller.js';
import { FilesModule } from './modules/files/files.module.js';
import { OrdersModule } from './modules/orders/orders.module.js';
import { DevicesModule } from './modules/devices/devices.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';
import { ShopModule } from './modules/shop/shop.module.js';
import { PickupModule } from './modules/pickup/pickup.module.js';
import { ShopsModule } from './modules/shops/shops.module.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { IdentityModule } from './modules/identity/identity.module.js';
import { CustomerAuthModule } from './modules/customer-auth/customer-auth.module.js';
import { RealtimeModule } from './modules/realtime/realtime.module.js';

const REQUEST_ID_HEADER = 'x-request-id';
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * CSRF defence in depth (security audit 2026-11-24, L-7): every API body is JSON, so a mutating
 * request with a body of any other type (an HTML form: urlencoded, multipart, text/plain) is
 * refused before parsing. Cross-origin JSON needs a CORS preflight, which only PUBLIC_WEB_URL
 * passes; SameSite=Lax cookies alone don't separate kaggaz.in from other *.kaggaz.in sites.
 */
export function requireJsonBodies(req: IncomingMessage, res: ServerResponse, next: () => void) {
  const length = Number(req.headers['content-length'] ?? 0);
  const hasBody = length > 0 || req.headers['transfer-encoding'] !== undefined;
  const type = (req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase();
  // Payment webhooks carry no cookies and gateways pick their own content type.
  const url = (req as IncomingMessage & { originalUrl?: string }).originalUrl ?? req.url ?? '';
  const webhook = url.startsWith('/api/webhooks/');
  if (MUTATING.has(req.method ?? '') && hasBody && !webhook && type !== 'application/json') {
    res.statusCode = 415;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(
      JSON.stringify({
        error: {
          code: 'UNSUPPORTED_MEDIA_TYPE',
          message: 'Request bodies must be application/json',
        },
      }),
    );
    return;
  }
  next();
}

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({
      useFactory: () => {
        const config = loadConfig(process.env);
        const pretty = config.APP_ENV === 'local';
        return {
          pinoHttp: {
            level: config.LOG_LEVEL,
            ...(pretty
              ? { transport: { target: 'pino-pretty', options: { singleLine: true } } }
              : {}),
            // Request IDs: reuse a well-formed incoming id, otherwise mint one; echo it back.
            genReqId: (req: IncomingMessage, res: ServerResponse) => {
              const incoming = req.headers[REQUEST_ID_HEADER];
              const id =
                typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming)
                  ? incoming
                  : randomUUID();
              res.setHeader(REQUEST_ID_HEADER, id);
              return id;
            },
            customProps: (req: IncomingMessage) => ({ requestId: (req as { id?: unknown }).id }),
            // Never log credentials, device tokens or signed URLs' query strings.
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'req.headers["idempotency-key"]',
                'req.headers["x-operator-token"]',
                'req.headers["x-tracking-token"]',
                'req.headers["x-demo-signature"]',
                'res.headers["set-cookie"]',
              ],
              censor: '[redacted]',
            },
            autoLogging: { ignore: (req: IncomingMessage) => req.url === '/api/health' },
          },
        };
      },
    }),
    EventsModule,
    ScheduleModule.forRoot(),
    PrismaModule,
    AuditModule,
    RealtimeModule,
    FilesModule,
    PickupModule,
    ShopsModule,
    OrdersModule,
    PaymentsModule,
    DevicesModule,
    ShopModule,
    AdminModule,
    IdentityModule,
    CustomerAuthModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: ApiExceptionFilter }],
})
export class AppModule implements NestModule {
  /** Every request gets its own tenant scope; DeviceAuthGuard binds it to the device's shop (P4.1). */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(requireJsonBodies).forRoutes('*');
    consumer
      .apply((_req: unknown, _res: unknown, next: () => void) => runInTenantScope(next))
      .forRoutes('*');
  }
}
