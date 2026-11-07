import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin/auth/auth.module.js';
import { AdminPricingController } from './admin-pricing.controller.js';
import { PricingService } from './pricing.service.js';

@Module({
  imports: [AdminAuthModule],
  controllers: [AdminPricingController],
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}
