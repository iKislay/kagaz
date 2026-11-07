import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminAuthGuard } from './auth/admin-auth.guard.js';
import { ShopsService } from './shops.service.js';
import { AdminShopsSchema } from '@kagaz/shared';

/** Admin read API for shops (PRD §11.3, FR-ADMIN-02). */
@Controller('admin/shops')
@UseGuards(AdminAuthGuard)
export class ShopsController {
  constructor(private readonly shops: ShopsService) {}

  @Get()
  async list() {
    return AdminShopsSchema.parse({ shops: await this.shops.listAdminShops() });
  }
}
