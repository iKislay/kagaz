import { Module } from '@nestjs/common';
import { AdminAuthController } from './auth.controller.js';
import { AdminAuthService } from './auth.service.js';
import { AdminAuthGuard } from './admin-auth.guard.js';
import { SuperAdminService } from './super-admin.service.js';

@Module({
  controllers: [AdminAuthController],
  providers: [AdminAuthService, AdminAuthGuard, SuperAdminService],
  exports: [AdminAuthService, AdminAuthGuard, SuperAdminService],
})
export class AdminAuthModule {}
