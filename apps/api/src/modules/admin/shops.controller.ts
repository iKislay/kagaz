import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import {
  type AdminShopCreateRequest,
  AdminShopCreateRequestSchema,
  AdminShopDetailSchema,
  type AdminShopMemberRequest,
  AdminShopMemberRequestSchema,
  type AdminShopUpdateRequest,
  AdminShopUpdateRequestSchema,
  AdminShopsSchema,
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
import { AdminAuthGuard } from './auth/admin-auth.guard.js';
import { ShopSettingsService } from './shop-settings.service.js';
import { ShopsService } from './shops.service.js';

export const UuidParam = new ZodValidationPipe(z.uuid());

/**
 * Admin shop API (PRD §11.3, FR-ADMIN-02/03). Admins see and edit every shop; shop owners
 * see only their own shops and edit only owner-editable fields.
 */
@Controller('admin/shops')
export class ShopsController {
  constructor(
    private readonly shops: ShopsService,
    private readonly settings: ShopSettingsService,
  ) {}

  @Get()
  @UseGuards(StaffAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SHOP_OWNER')
  async list(@CurrentStaff() staff: StaffContext) {
    const only = staff.role === 'ADMIN' ? undefined : staff.shopIds;
    return AdminShopsSchema.parse({ shops: await this.shops.listAdminShops(only) });
  }

  @Post()
  @UseGuards(AdminAuthGuard)
  async create(
    @CurrentStaff() staff: StaffContext,
    @Body(new ZodValidationPipe(AdminShopCreateRequestSchema)) body: AdminShopCreateRequest,
  ) {
    return AdminShopDetailSchema.parse(await this.settings.create(staff, body));
  }

  @Get(':id')
  @UseGuards(StaffAuthGuard, RolesGuard, ShopScopeGuard)
  @Roles('ADMIN', 'SHOP_OWNER')
  async detail(@Param('id', UuidParam) id: string) {
    return AdminShopDetailSchema.parse(await this.settings.detail(id));
  }

  /** Add a shop login by phone, or reset an existing member's password/role. */
  @Post(':id/members')
  @HttpCode(200)
  @UseGuards(StaffAuthGuard, RolesGuard, ShopScopeGuard)
  @Roles('ADMIN', 'SHOP_OWNER')
  async addMember(
    @CurrentStaff() staff: StaffContext,
    @Param('id', UuidParam) id: string,
    @Body(new ZodValidationPipe(AdminShopMemberRequestSchema)) body: AdminShopMemberRequest,
  ) {
    return AdminShopDetailSchema.parse(await this.settings.addMember(staff, id, body));
  }

  @Delete(':id/members/:userId')
  @UseGuards(StaffAuthGuard, RolesGuard, ShopScopeGuard)
  @Roles('ADMIN', 'SHOP_OWNER')
  async removeMember(
    @CurrentStaff() staff: StaffContext,
    @Param('id', UuidParam) id: string,
    @Param('userId', UuidParam) userId: string,
  ) {
    return AdminShopDetailSchema.parse(await this.settings.removeMember(staff, id, userId));
  }

  @Patch(':id')
  @HttpCode(200)
  @UseGuards(StaffAuthGuard, RolesGuard, ShopScopeGuard)
  @Roles('ADMIN', 'SHOP_OWNER')
  async update(
    @CurrentStaff() staff: StaffContext,
    @Param('id', UuidParam) id: string,
    @Body(new ZodValidationPipe(AdminShopUpdateRequestSchema)) body: AdminShopUpdateRequest,
  ) {
    return AdminShopDetailSchema.parse(await this.settings.update(staff, id, body));
  }
}
