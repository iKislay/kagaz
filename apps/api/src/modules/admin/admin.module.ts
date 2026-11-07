import { Module } from '@nestjs/common';
import { AdminAuthModule } from './auth/auth.module.js';
import { ShopsController } from './shops.controller.js';
import { ShopsService } from './shops.service.js';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { AuditController } from './audit.controller.js';
import { AuditService } from './audit.service.js';

@Module({
  imports: [AdminAuthModule],
  controllers: [ShopsController, OrdersController, AuditController],
  providers: [ShopsService, OrdersService, AuditService],
})
export class AdminModule {}
