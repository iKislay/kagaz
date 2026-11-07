import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AdminAuthGuard } from './auth/admin-auth.guard.js';
import { AuditService } from './audit.service.js';
import { AdminAuditQuerySchema, AdminAuditListSchema } from '@kagaz/shared';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe.js';

/** Admin audit log viewer (PRD §11.3, FR-ADMIN-08). */
@Controller('admin/audit')
@UseGuards(AdminAuthGuard)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(AdminAuditQuerySchema))
    query: {
      shopId?: string;
      orderId?: string;
      action?: string;
      page: number;
      pageSize: number;
    },
  ) {
    return AdminAuditListSchema.parse(await this.audit.list(query));
  }
}
