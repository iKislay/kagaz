import { Module } from '@nestjs/common';
import { AgentVersionGuard } from '../../common/auth/agent-version.guard.js';
import { DeviceAuthGuard } from '../../common/auth/device-auth.guard.js';
import { IdempotencyInterceptor } from '../../common/http/idempotency.interceptor.js';
import { ApprovalModule } from '../approval/approval.module.js';
import { FilesModule } from '../files/files.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { PrintPreparationService } from '../printing/print-preparation.service.js';
import { PrintingModule } from '../printing/printing.module.js';
import { PrintJobsService } from './print-jobs.service.js';
import { ShopController } from './shop.controller.js';
import { ShopPaymentsController } from './shop-payments.controller.js';
import { ShopJobsService } from './shop-jobs.service.js';
import { ShopPrintersService } from './shop-printers.service.js';

@Module({
  imports: [FilesModule, OrdersModule, PaymentsModule, PrintingModule, ApprovalModule],
  controllers: [ShopController, ShopPaymentsController],
  providers: [
    DeviceAuthGuard,
    AgentVersionGuard,
    IdempotencyInterceptor,
    ShopJobsService,
    PrintJobsService,
    ShopPrintersService,
    PrintPreparationService,
  ],
})
export class ShopModule {}
