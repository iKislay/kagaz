import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import {
  type AdminPricingList,
  type AdminPricingVersion,
  type CreatePricingVersion,
  CreatePricingVersionSchema,
} from '@kagaz/shared';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe.js';
import {
  CurrentStaff,
  Roles,
  RolesGuard,
  ShopScopeGuard,
  StaffAuthGuard,
  type StaffContext,
  staffActor,
} from '../identity/staff-session.js';
import { PricingService } from './pricing.service.js';

/**
 * Pricing versions (P2.5, PRD §11.3 `GET/POST /api/admin/shops/{id}/pricing`). Admins for any
 * shop; shop owners for their own shop only (another shop → 404).
 */
@Controller('admin/shops/:shopId/pricing')
@UseGuards(StaffAuthGuard, RolesGuard, ShopScopeGuard)
@Roles('ADMIN', 'SHOP_OWNER')
export class AdminPricingController {
  constructor(private readonly pricing: PricingService) {}

  @Get()
  async list(@Param('shopId') shopId: string): Promise<AdminPricingList> {
    return { versions: await this.pricing.listVersions(shopId) };
  }

  @Post()
  create(
    @Param('shopId') shopId: string,
    @Body(new ZodValidationPipe(CreatePricingVersionSchema)) body: CreatePricingVersion,
    @CurrentStaff() staff: StaffContext,
  ): Promise<AdminPricingVersion> {
    return this.pricing.createVersion(shopId, body, staffActor(staff));
  }
}
