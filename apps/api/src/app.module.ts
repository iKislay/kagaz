import { randomUUID } from 'node:crypto';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from './common/config/config.module.js';
import { loadConfig } from './common/config/config.schema.js';
import { ApiExceptionFilter } from './common/http/api-exception.filter.js';
import { PrismaModule } from './common/prisma/prisma.module.js';
import { HealthController } from './health/health.controller.js';
import { FilesModule } from './modules/files/files.module.js';
import { OrdersModule } from './modules/orders/orders.module.js';
import { DevicesModule } from './modules/devices/devices.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';
import { ShopModule } from './modules/shop/shop.module.js';
import { PickupModule } from './modules/pickup/pickup.module.js';
import { ShopsModule } from './modules/shops/shops.module.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { IdentityModule } from './modules/identity/identity.module.js';

const REQUEST_ID_HEADER = 'x-request-id';
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

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
                'res.headers["set-cookie"]',
              ],
              censor: '[redacted]',
            },
            autoLogging: { ignore: (req: IncomingMessage) => req.url === '/api/health' },
          },
        };
      },
    }),
    PrismaModule,
    FilesModule,
    PickupModule,
    ShopsModule,
    OrdersModule,
    PaymentsModule,
    DevicesModule,
    ShopModule,
    AdminModule,
    IdentityModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: ApiExceptionFilter }],
})
export class AppModule {}
