import { Module } from '@nestjs/common';
import { APP_CONFIG } from '../../common/config/config.module.js';
import { type AppConfig } from '../../common/config/config.schema.js';
import { OrdersModule } from '../orders/orders.module.js';
import { DemoMockProvider } from './demo-mock.provider.js';
import { PAYMENT_PROVIDER, type PaymentProvider } from './payment-provider.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';

@Module({
  imports: [OrdersModule],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    {
      provide: PAYMENT_PROVIDER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): PaymentProvider => {
        switch (config.PAYMENT_PROVIDER) {
          case 'demo':
            // loadConfig already refuses demo payments in production.
            return new DemoMockProvider(config.DEMO_WEBHOOK_SECRET ?? 'demo-webhook-secret');
          default:
            // Live gateways are gated on the merchant-of-record decision (P3.8/P3.9, D6).
            throw new Error(`Payment provider "${config.PAYMENT_PROVIDER}" is not implemented yet`);
        }
      },
    },
  ],
  exports: [PaymentsService, PAYMENT_PROVIDER],
})
export class PaymentsModule {}
