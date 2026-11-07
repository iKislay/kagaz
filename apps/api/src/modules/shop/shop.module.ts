import { Module } from '@nestjs/common';
import { DeviceAuthGuard } from '../../common/auth/device-auth.guard.js';
import { ApprovalModule } from '../approval/approval.module.js';
import { FilesModule } from '../files/files.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { PrintPreparationService } from '../printing/print-preparation.service.js';
import { PrintJobsService } from './print-jobs.service.js';
import { ShopController } from './shop.controller.js';
import { ShopJobsService } from './shop-jobs.service.js';
import { ShopPrintersService } from './shop-printers.service.js';

@Module({
  imports: [FilesModule, OrdersModule, PaymentsModule, ApprovalModule],
  controllers: [ShopController],
  providers: [
    DeviceAuthGuard,
    ShopJobsService,
    PrintJobsService,
    ShopPrintersService,
    PrintPreparationService,
  ],
})
export class ShopModule {}
