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
import {
  type SudoAdminCreateRequest,
  SudoAdminCreateRequestSchema,
  SudoAdminCreatedSchema,
  SudoAdminListSchema,
  type SudoMemberCreateRequest,
  SudoMemberCreateRequestSchema,
  SudoMemberCreatedSchema,
  SudoMemberSchema,
  type SudoMemberUpdateRequest,
  SudoMemberUpdateRequestSchema,
  SudoOverviewSchema,
  type SudoPasswordResetRequest,
  SudoPasswordResetRequestSchema,
  SudoPasswordResetSchema,
  type SudoPlanCreateRequest,
  SudoPlanCreateRequestSchema,
  SudoPlanListSchema,
  SudoPlanSchema,
  type SudoPlanUpdateRequest,
  SudoPlanUpdateRequestSchema,
  type SudoShopCreateRequest,
  SudoShopCreateRequestSchema,
  SudoShopCreatedSchema,
  type SudoShopDeleteRequest,
  SudoShopDeleteRequestSchema,
  SudoShopDetailSchema,
  SudoShopListSchema,
  type SudoShopReasonRequest,
  SudoShopReasonRequestSchema,
  type SudoSubscriptionCancelRequest,
  SudoSubscriptionCancelRequestSchema,
  type SudoSubscriptionCreateRequest,
  SudoSubscriptionCreateRequestSchema,
  type SudoSubscriptionPaymentCreateRequest,
  SudoSubscriptionPaymentCreateRequestSchema,
  SudoSubscriptionPaymentSchema,
  SudoSubscriptionSchema,
  type SudoSubscriptionUpdateRequest,
  SudoSubscriptionUpdateRequestSchema,
} from '@kagaz/shared';
import { type ZodType } from 'zod';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe.js';
import { CurrentStaff, type StaffContext } from '../identity/staff-session.js';
import { AdminAuthGuard } from '../admin/auth/admin-auth.guard.js';
import { UuidParam } from '../admin/shops.controller.js';
import { SudoAccountsService } from './sudo-accounts.service.js';
import { SudoBillingService } from './sudo-billing.service.js';
import { SudoOverviewService } from './sudo-overview.service.js';
import { SudoShopsService } from './sudo-shops.service.js';

const OK = { ok: true as const };
const pipe = <T>(schema: ZodType<T>) => new ZodValidationPipe(schema);

/**
 * Platform-owner console API (/sudoadmin). Kagaz platform admins only (role ADMIN); shop owners
 * and operators get 403. Responses are validated against the shared schemas before sending.
 */
@Controller('sudo')
@UseGuards(AdminAuthGuard)
export class SudoController {
  constructor(
    private readonly shops: SudoShopsService,
    private readonly accounts: SudoAccountsService,
    private readonly billing: SudoBillingService,
    private readonly overviewService: SudoOverviewService,
  ) {}

  @Get('overview')
  async overview() {
    return SudoOverviewSchema.parse(await this.overviewService.overview());
  }

  // ─── Shops ───

  @Get('shops')
  async listShops() {
    return SudoShopListSchema.parse({ shops: await this.shops.list() });
  }

  @Post('shops')
  async onboard(
    @CurrentStaff() staff: StaffContext,
    @Body(pipe(SudoShopCreateRequestSchema)) body: SudoShopCreateRequest,
  ) {
    return SudoShopCreatedSchema.parse(await this.shops.onboard(staff, body));
  }

  @Get('shops/:id')
  async shop(@Param('id', UuidParam) id: string) {
    return SudoShopDetailSchema.parse(await this.shops.detail(id));
  }

  @Post('shops/:id/suspend')
  @HttpCode(200)
  async suspend(
    @CurrentStaff() staff: StaffContext,
    @Param('id', UuidParam) id: string,
    @Body(pipe(SudoShopReasonRequestSchema)) body: SudoShopReasonRequest,
  ) {
    return SudoShopDetailSchema.parse(await this.shops.suspend(staff, id, body.reason));
  }

  @Post('shops/:id/reactivate')
  @HttpCode(200)
  async reactivate(@CurrentStaff() staff: StaffContext, @Param('id', UuidParam) id: string) {
    return SudoShopDetailSchema.parse(await this.shops.reactivate(staff, id));
  }

  @Post('shops/:id/archive')
  @HttpCode(200)
  async archive(
    @CurrentStaff() staff: StaffContext,
    @Param('id', UuidParam) id: string,
    @Body(pipe(SudoShopReasonRequestSchema)) body: SudoShopReasonRequest,
  ) {
    return SudoShopDetailSchema.parse(await this.shops.archive(staff, id, body.reason));
  }

  @Post('shops/:id/restore')
  @HttpCode(200)
  async restore(@CurrentStaff() staff: StaffContext, @Param('id', UuidParam) id: string) {
    return SudoShopDetailSchema.parse(await this.shops.restore(staff, id));
  }

  @Delete('shops/:id')
  @HttpCode(200)
  async deleteShop(
    @CurrentStaff() staff: StaffContext,
    @Param('id', UuidParam) id: string,
    @Body(pipe(SudoShopDeleteRequestSchema)) body: SudoShopDeleteRequest,
  ) {
    await this.shops.remove(staff, id, body.confirmSlug);
    return OK;
  }

  // ─── Shop team ───

  @Post('shops/:id/members')
  async addMember(
    @CurrentStaff() staff: StaffContext,
    @Param('id', UuidParam) id: string,
    @Body(pipe(SudoMemberCreateRequestSchema)) body: SudoMemberCreateRequest,
  ) {
    return SudoMemberCreatedSchema.parse(await this.accounts.addMember(staff, id, body));
  }

  @Patch('shops/:id/members/:userId')
  async updateMember(
    @CurrentStaff() staff: StaffContext,
    @Param('id', UuidParam) id: string,
    @Param('userId', UuidParam) userId: string,
    @Body(pipe(SudoMemberUpdateRequestSchema)) body: SudoMemberUpdateRequest,
  ) {
    return SudoMemberSchema.parse(
      await this.accounts.updateMemberRole(staff, id, userId, body.role),
    );
  }

  @Post('shops/:id/members/:userId/reset-password')
  @HttpCode(200)
  async resetMemberPassword(
    @CurrentStaff() staff: StaffContext,
    @Param('id', UuidParam) id: string,
    @Param('userId', UuidParam) userId: string,
    @Body(pipe(SudoPasswordResetRequestSchema)) body: SudoPasswordResetRequest,
  ) {
    return SudoPasswordResetSchema.parse(
      await this.accounts.resetMemberPassword(staff, id, userId, body.password),
    );
  }

  @Delete('shops/:id/members/:userId')
  @HttpCode(200)
  async removeMember(
    @CurrentStaff() staff: StaffContext,
    @Param('id', UuidParam) id: string,
    @Param('userId', UuidParam) userId: string,
  ) {
    await this.accounts.removeMember(staff, id, userId);
    return OK;
  }

  // ─── Subscriptions ───

  @Post('shops/:id/subscriptions')
  async createSubscription(
    @CurrentStaff() staff: StaffContext,
    @Param('id', UuidParam) id: string,
    @Body(pipe(SudoSubscriptionCreateRequestSchema)) body: SudoSubscriptionCreateRequest,
  ) {
    return SudoSubscriptionSchema.parse(await this.billing.createSubscription(staff, id, body));
  }

  @Patch('shops/:id/subscriptions/:subId')
  async updateSubscription(
    @CurrentStaff() staff: StaffContext,
    @Param('id', UuidParam) id: string,
    @Param('subId', UuidParam) subId: string,
    @Body(pipe(SudoSubscriptionUpdateRequestSchema)) body: SudoSubscriptionUpdateRequest,
  ) {
    return SudoSubscriptionSchema.parse(
      await this.billing.updateSubscription(staff, id, subId, body),
    );
  }

  @Post('shops/:id/subscriptions/:subId/cancel')
  @HttpCode(200)
  async cancelSubscription(
    @CurrentStaff() staff: StaffContext,
    @Param('id', UuidParam) id: string,
    @Param('subId', UuidParam) subId: string,
    @Body(pipe(SudoSubscriptionCancelRequestSchema)) body: SudoSubscriptionCancelRequest,
  ) {
    return SudoSubscriptionSchema.parse(
      await this.billing.cancelSubscription(staff, id, subId, body),
    );
  }

  @Delete('shops/:id/subscriptions/:subId')
  @HttpCode(200)
  async deleteSubscription(
    @CurrentStaff() staff: StaffContext,
    @Param('id', UuidParam) id: string,
    @Param('subId', UuidParam) subId: string,
  ) {
    await this.billing.deleteSubscription(staff, id, subId);
    return OK;
  }

  @Post('shops/:id/subscriptions/:subId/payments')
  async recordPayment(
    @CurrentStaff() staff: StaffContext,
    @Param('id', UuidParam) id: string,
    @Param('subId', UuidParam) subId: string,
    @Body(pipe(SudoSubscriptionPaymentCreateRequestSchema))
    body: SudoSubscriptionPaymentCreateRequest,
  ) {
    return SudoSubscriptionPaymentSchema.parse(
      await this.billing.recordPayment(staff, id, subId, body),
    );
  }

  @Delete('shops/:id/payments/:paymentId')
  @HttpCode(200)
  async deletePayment(
    @CurrentStaff() staff: StaffContext,
    @Param('id', UuidParam) id: string,
    @Param('paymentId', UuidParam) paymentId: string,
  ) {
    await this.billing.deletePayment(staff, id, paymentId);
    return OK;
  }

  // ─── Plans ───

  @Get('plans')
  async plans() {
    return SudoPlanListSchema.parse({ plans: await this.billing.listPlans() });
  }

  @Post('plans')
  async createPlan(
    @CurrentStaff() staff: StaffContext,
    @Body(pipe(SudoPlanCreateRequestSchema)) body: SudoPlanCreateRequest,
  ) {
    return SudoPlanSchema.parse(await this.billing.createPlan(staff, body));
  }

  @Patch('plans/:planId')
  async updatePlan(
    @CurrentStaff() staff: StaffContext,
    @Param('planId', UuidParam) planId: string,
    @Body(pipe(SudoPlanUpdateRequestSchema)) body: SudoPlanUpdateRequest,
  ) {
    return SudoPlanSchema.parse(await this.billing.updatePlan(staff, planId, body));
  }

  @Delete('plans/:planId')
  @HttpCode(200)
  async deletePlan(
    @CurrentStaff() staff: StaffContext,
    @Param('planId', UuidParam) planId: string,
  ) {
    await this.billing.deletePlan(staff, planId);
    return OK;
  }

  // ─── Platform admins ───

  @Get('admins')
  async admins(@CurrentStaff() staff: StaffContext) {
    return SudoAdminListSchema.parse({ admins: await this.accounts.listAdmins(staff) });
  }

  @Post('admins')
  async createAdmin(
    @CurrentStaff() staff: StaffContext,
    @Body(pipe(SudoAdminCreateRequestSchema)) body: SudoAdminCreateRequest,
  ) {
    return SudoAdminCreatedSchema.parse(await this.accounts.createAdmin(staff, body));
  }

  @Post('admins/:userId/reset-password')
  @HttpCode(200)
  async resetAdminPassword(
    @CurrentStaff() staff: StaffContext,
    @Param('userId', UuidParam) userId: string,
    @Body(pipe(SudoPasswordResetRequestSchema)) body: SudoPasswordResetRequest,
  ) {
    return SudoPasswordResetSchema.parse(
      await this.accounts.resetAdminPassword(staff, userId, body.password),
    );
  }

  @Delete('admins/:userId')
  @HttpCode(200)
  async removeAdmin(
    @CurrentStaff() staff: StaffContext,
    @Param('userId', UuidParam) userId: string,
  ) {
    await this.accounts.removeAdmin(staff, userId);
    return OK;
  }
}
