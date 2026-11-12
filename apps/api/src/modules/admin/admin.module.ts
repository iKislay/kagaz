import { Module } from '@nestjs/common';
import { BillingController } from '../billing/billing.controller.js';
import { BillingService } from '../billing/billing.service.js';
import { AdminAuthModule } from './auth/auth.module.js';
import { ShopsController } from './shops.controller.js';
import { ShopsService } from './shops.service.js';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { AuditController } from './audit.controller.js';
import { AuditService } from './audit.service.js';
import { ShopSettingsService } from './shop-settings.service.js';
import { ShopDevicesController, ShopPrintersController } from './shop-resources.controller.js';
import { DevicesAdminService } from './devices-admin.service.js';
import { PrintersAdminService } from './printers-admin.service.js';
import { InsightsController } from './insights.controller.js';
import { HealthService, PrinterUptimeSampler } from './health.service.js';
import { ReconciliationService } from './reconciliation.service.js';
import { OverviewService } from './overview.service.js';

@Module({
  imports: [AdminAuthModule],
  controllers: [
    ShopsController,
    ShopDevicesController,
    ShopPrintersController,
    // Minimal pricing endpoints until the payments workstream's version is merged (P4.3 note).
    OrdersController,
    AuditController,
    InsightsController,
    BillingController,
  ],
  providers: [
    ShopsService,
    ShopSettingsService,
    DevicesAdminService,
    PrintersAdminService,
    OrdersService,
    AuditService,
    HealthService,
    PrinterUptimeSampler,
    ReconciliationService,
    OverviewService,
    BillingService,
  ],
})
export class AdminModule {}
