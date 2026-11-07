import { Module } from '@nestjs/common';
import { CustomerSessionService } from '../../common/auth/customer-session.js';
import { FilesModule } from '../files/files.module.js';
import { PricingModule } from '../pricing/pricing.module.js';
import { ShopsModule } from '../shops/shops.module.js';
import { OrderStateMachine } from './order-state-machine.js';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { TrackingGuard } from './tracking.guard.js';

@Module({
  imports: [FilesModule, PricingModule, ShopsModule],
  controllers: [OrdersController],
  providers: [OrdersService, OrderStateMachine, TrackingGuard, CustomerSessionService],
  exports: [OrdersService, OrderStateMachine, TrackingGuard, CustomerSessionService],
})
export class OrdersModule {}
