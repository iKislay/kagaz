import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import {
  type AdminCreatePricingRequest,
  AdminCreatePricingRequestSchema,
  AdminPricingListSchema,
  AdminPricingVersionSchema,
} from '@kagaz/shared';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe.js';
import {
  CurrentStaff,
  Roles,
  RolesGuard,
  ShopScopeGuard,
  StaffAuthGuard,
  type StaffContext,
} from '../identity/staff-session.js';
import { PricingAdminService } from './pricing-admin.service.js';
import { UuidParam } from './shops.controller.js';

/** Pricing versions (FR-ADMIN-06) — admins, and owners for their own shop. */
@Controller('admin/shops/:id/pricing')
@UseGuards(StaffAuthGuard, RolesGuard, ShopScopeGuard)
@Roles('ADMIN', 'SHOP_OWNER')
export class PricingAdminController {
  constructor(private readonly pricing: PricingAdminService) {}

  @Get()
  async list(@Param('id', UuidParam) shopId: string) {
    return AdminPricingListSchema.parse({ versions: await this.pricing.list(shopId) });
  }

  @Post()
  @HttpCode(201)
  async create(
    @CurrentStaff() staff: StaffContext,
    @Param('id', UuidParam) shopId: string,
    @Body(new ZodValidationPipe(AdminCreatePricingRequestSchema)) body: AdminCreatePricingRequest,
  ) {
    return AdminPricingVersionSchema.parse(await this.pricing.create(staff, shopId, body));
  }
}
