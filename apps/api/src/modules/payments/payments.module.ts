import { Module } from '@nestjs/common';
import { APP_CONFIG } from '../../common/config/config.module.js';
import { type AppConfig } from '../../common/config/config.schema.js';
import { AdminAuthModule } from '../admin/auth/auth.module.js';
import { ApprovalModule } from '../approval/approval.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { PricingModule } from '../pricing/pricing.module.js';
import { ShopsModule } from '../shops/shops.module.js';
import { AdminOrderActionsService } from './admin-order-actions.service.js';
import { AdminPaymentsController, DemoPaymentsController } from './admin-payments.controller.js';
import { DemoControlsService } from './demo-controls.service.js';
import { DemoMockProvider } from './demo-mock.provider.js';
import { ManualRefundsService } from './manual-refunds.service.js';
import { PaymentReportsService } from './payment-reports.service.js';
import { YoupiClient } from './providers/youpi/youpi-client.js';
import { YoupiProvider } from './providers/youpi/youpi.provider.js';
import { ShopPaymentAccountsService, YOUPI_CLIENT } from './shop-payment-accounts.service.js';
import { PAYMENT_PROVIDER, type PaymentProvider } from './payment-provider.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';
import { RefundsService } from './refunds.service.js';
import { WebhooksController } from './webhooks.controller.js';
import { WebhooksService } from './webhooks.service.js';

@Module({
  imports: [OrdersModule, PricingModule, ApprovalModule, ShopsModule, AdminAuthModule],
  controllers: [
    PaymentsController,
    WebhooksController,
    AdminPaymentsController,
    DemoPaymentsController,
  ],
  providers: [
    PaymentsService,
    RefundsService,
    WebhooksService,
    DemoControlsService,
    AdminOrderActionsService,
    ShopPaymentAccountsService,
    PaymentReportsService,
    ManualRefundsService,
    {
      provide: YOUPI_CLIENT,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): YoupiClient | null =>
        config.PAYMENT_PROVIDER === 'youpi'
          ? new YoupiClient({
              // loadConfig refuses to start youpi without these.
              baseUrl: config.YOUPI_API_URL!,
              adminToken: config.YOUPI_ADMIN_TOKEN!,
              timeoutMs: config.YOUPI_HTTP_TIMEOUT_MS,
            })
          : null,
    },
    {
      provide: PAYMENT_PROVIDER,
      inject: [APP_CONFIG, YOUPI_CLIENT, ShopPaymentAccountsService],
      useFactory: (
        config: AppConfig,
        youpi: YoupiClient | null,
        accounts: ShopPaymentAccountsService,
      ): PaymentProvider => {
        switch (config.PAYMENT_PROVIDER) {
          case 'youpi':
            // ADR-003 default: customers pay the shop's own UPI ID; YouPI detects the credit.
            return new YoupiProvider(youpi!, accounts);
          case 'demo':
            // loadConfig already refuses demo payments in production.
            return new DemoMockProvider({
              webhookSecret: config.DEMO_WEBHOOK_SECRET ?? 'local-demo-webhook-secret',
              webhookDelayMs: config.DEMO_WEBHOOK_DELAY_MS,
              pendingResolveMs: config.DEMO_PENDING_RESOLVE_SECONDS * 1000,
            });
          default:
            // Live gateways are gated on the merchant-of-record decision (P3.8/P3.9, D6).
            throw new Error(`Payment provider "${config.PAYMENT_PROVIDER}" is not implemented yet`);
        }
      },
    },
  ],
  exports: [
    PaymentsService,
    RefundsService,
    PAYMENT_PROVIDER,
    ShopPaymentAccountsService,
    PaymentReportsService,
    ManualRefundsService,
  ],
})
export class PaymentsModule {}
