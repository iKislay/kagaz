import { Module } from '@nestjs/common';
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
import { PricingAdminController } from './pricing-admin.controller.js';
import { PricingAdminService } from './pricing-admin.service.js';
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
    PricingAdminController,
    OrdersController,
    AuditController,
    InsightsController,
  ],
  providers: [
    ShopsService,
    ShopSettingsService,
    DevicesAdminService,
    PrintersAdminService,
    PricingAdminService,
    OrdersService,
    AuditService,
    HealthService,
    PrinterUptimeSampler,
    ReconciliationService,
    OverviewService,
  ],
})
export class AdminModule {}
