import { Module } from '@nestjs/common';
import { AdminAuthController } from './auth.controller.js';
import { AdminAuthService } from './auth.service.js';
import { AdminAuthGuard } from './admin-auth.guard.js';

@Module({
  controllers: [AdminAuthController],
  providers: [AdminAuthService, AdminAuthGuard],
  exports: [AdminAuthService, AdminAuthGuard],
})
export class AdminAuthModule {}
