import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module.js';
import { PricingModule } from '../pricing/pricing.module.js';
import { ShopsModule } from '../shops/shops.module.js';
import { OrderStateMachine } from './order-state-machine.js';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { RetentionService } from './retention.service.js';
import { TrackingGuard } from './tracking.guard.js';

@Module({
  imports: [FilesModule, PricingModule, ShopsModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrderStateMachine, TrackingGuard, RetentionService],
  exports: [OrdersService, OrderStateMachine, TrackingGuard, RetentionService],
})
export class OrdersModule {}
