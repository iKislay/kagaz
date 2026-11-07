import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module.js';
import { PrintLeaseService } from './print-leases.service.js';

/** Printer leases + the 15 s lease sweeper (P2.7). */
@Module({
  imports: [OrdersModule],
  providers: [PrintLeaseService],
  exports: [PrintLeaseService],
})
export class PrintingModule {}
