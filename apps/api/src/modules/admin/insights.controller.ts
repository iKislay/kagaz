import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  AdminHealthSchema,
  type AdminOverviewQuery,
  AdminOverviewQuerySchema,
  AdminOverviewSchema,
  type AdminReconciliationQuery,
  AdminReconciliationQuerySchema,
  AdminReconciliationSchema,
} from '@kagaz/shared';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe.js';
import { AdminAuthGuard } from './auth/admin-auth.guard.js';
import { HealthService } from './health.service.js';
import { OverviewService } from './overview.service.js';
import { ReconciliationService } from './reconciliation.service.js';

/** Platform-admin read models: health (P4.4), reconciliation (P3.7), overview (P4.8). */
@Controller('admin')
@UseGuards(AdminAuthGuard)
export class InsightsController {
  constructor(
    private readonly healthService: HealthService,
    private readonly reconciliation: ReconciliationService,
    private readonly overviewService: OverviewService,
  ) {}

  @Get('health')
  async health() {
    return AdminHealthSchema.parse(await this.healthService.health());
  }

  @Get('reconciliation')
  async reconcile(
    @Query(new ZodValidationPipe(AdminReconciliationQuerySchema)) q: AdminReconciliationQuery,
  ) {
    return AdminReconciliationSchema.parse(await this.reconciliation.report(q));
  }

  @Get('overview')
  async overview(@Query(new ZodValidationPipe(AdminOverviewQuerySchema)) q: AdminOverviewQuery) {
    return AdminOverviewSchema.parse(await this.overviewService.overview(q));
  }
}
