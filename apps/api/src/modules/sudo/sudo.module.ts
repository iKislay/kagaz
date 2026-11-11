import { Module } from '@nestjs/common';
import { AdminAuthModule } from '../admin/auth/auth.module.js';
import { SudoAccountsService } from './sudo-accounts.service.js';
import { SudoBillingService } from './sudo-billing.service.js';
import { SudoController } from './sudo.controller.js';
import { SudoOverviewService } from './sudo-overview.service.js';
import { SudoShopsService } from './sudo-shops.service.js';

/**
 * Platform-owner console (/sudoadmin): tenants, team accounts, subscription plans and
 * subscriptions, platform admins. ADMIN role only.
 */
@Module({
  imports: [AdminAuthModule],
  controllers: [SudoController],
  providers: [SudoShopsService, SudoAccountsService, SudoBillingService, SudoOverviewService],
})
export class SudoModule {}
