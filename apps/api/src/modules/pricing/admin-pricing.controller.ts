import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { type Request } from 'express';
import {
  type AdminPricingList,
  type AdminPricingVersion,
  type CreatePricingVersion,
  CreatePricingVersionSchema,
} from '@kagaz/shared';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe.js';
import { AdminAuthGuard } from '../admin/auth/admin-auth.guard.js';
import { PricingService } from './pricing.service.js';

/**
 * Pricing versions (P2.5, PRD §11.3 `GET/POST /api/admin/shops/{id}/pricing`). Admin only for
 * now; shop-owner access arrives with staff roles (identity workstream).
 */
@Controller('admin/shops/:shopId/pricing')
@UseGuards(AdminAuthGuard)
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
    @Req() req: Request & { admin?: { userId: string } },
  ): Promise<AdminPricingVersion> {
    return this.pricing.createVersion(shopId, body, {
      type: 'ADMIN',
      id: req.admin?.userId ?? null,
    });
  }
}
