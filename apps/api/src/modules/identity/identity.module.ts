import { Global, Module } from '@nestjs/common';
import { DeviceAuthGuard } from '../../common/auth/device-auth.guard.js';
import { OperatorAuthGuard } from './operator-auth.guard.js';
import { OperatorController } from './operator.controller.js';
import { OperatorSessionService } from './operator-session.service.js';
import { RolesGuard, ShopScopeGuard, StaffAuthGuard } from './staff-session.js';

/**
 * Identity (P2.3): staff web sessions + roles/shop-scope guards, and operator sessions on
 * paired devices. Global so any controller can use `@RequireOperator()` or the staff guards
 * without wiring imports.
 */
@Global()
@Module({
  controllers: [OperatorController],
  providers: [
    OperatorSessionService,
    OperatorAuthGuard,
    DeviceAuthGuard,
    StaffAuthGuard,
    RolesGuard,
    ShopScopeGuard,
  ],
  exports: [OperatorSessionService, OperatorAuthGuard, StaffAuthGuard, RolesGuard, ShopScopeGuard],
})
export class IdentityModule {}
