import { Module } from '@nestjs/common';
import { DeviceAuthGuard } from '../../common/auth/device-auth.guard.js';
import { FilesModule } from '../files/files.module.js';
import { OrdersModule } from '../orders/orders.module.js';
import { PrintPreparationService } from '../printing/print-preparation.service.js';
import { ApprovalService } from './approval.service.js';
import { OrderAcceptanceService } from './order-acceptance.service.js';
import { ShopModeController } from './shop-mode.controller.js';

/** Approval modes, guarded auto-accept and the shared accept path (P2.6). */
@Module({
  imports: [FilesModule, OrdersModule],
  controllers: [ShopModeController],
  providers: [ApprovalService, OrderAcceptanceService, PrintPreparationService, DeviceAuthGuard],
  exports: [ApprovalService, OrderAcceptanceService],
})
export class ApprovalModule {}
