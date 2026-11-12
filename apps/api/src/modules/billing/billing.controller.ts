import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import {
  AdminBillingOverviewSchema,
  AdminShopBillingSchema,
  type CancelSubscriptionRequest,
  CancelSubscriptionRequestSchema,
  type ChangeEndDateRequest,
  ChangeEndDateRequestSchema,
  type ChangePlanRequest,
  ChangePlanRequestSchema,
  type CreateSubscriptionRequest,
  CreateSubscriptionRequestSchema,
  type RecordSubscriptionPaymentRequest,
  RecordSubscriptionPaymentRequestSchema,
} from '@kagaz/shared';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe.js';
import { AdminAuthGuard } from '../admin/auth/admin-auth.guard.js';
import { UuidParam } from '../admin/shops.controller.js';
import { CurrentStaff, type StaffContext } from '../identity/staff-session.js';
import { BillingService } from './billing.service.js';

/** Subscriptions (ADR-004) — Kaggaz admins only (/superadmin). */
@Controller('admin')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('billing')
  @UseGuards(AdminAuthGuard)
  async overview() {
    return AdminBillingOverviewSchema.parse(await this.billing.overview());
  }

  @Get('shops/:id/billing')
  @UseGuards(AdminAuthGuard)
  async shop(@Param('id', UuidParam) shopId: string) {
    return AdminShopBillingSchema.parse(await this.billing.shopBilling(shopId));
  }

  @Post('shops/:id/subscriptions')
  @HttpCode(200)
  @UseGuards(AdminAuthGuard)
  async create(
    @CurrentStaff() staff: StaffContext,
    @Param('id', UuidParam) shopId: string,
    @Body(new ZodValidationPipe(CreateSubscriptionRequestSchema)) body: CreateSubscriptionRequest,
  ) {
    return AdminShopBillingSchema.parse(await this.billing.create(staff, shopId, body));
  }

  @Post('shops/:id/subscriptions/:subId/payments')
  @HttpCode(200)
  @UseGuards(AdminAuthGuard)
  async pay(
    @CurrentStaff() staff: StaffContext,
    @Param('id', UuidParam) shopId: string,
    @Param('subId', UuidParam) subId: string,
    @Body(new ZodValidationPipe(RecordSubscriptionPaymentRequestSchema))
    body: RecordSubscriptionPaymentRequest,
  ) {
    return AdminShopBillingSchema.parse(
      await this.billing.recordPayment(staff, shopId, subId, body),
    );
  }

  @Post('shops/:id/subscriptions/:subId/change-plan')
  @HttpCode(200)
  @UseGuards(AdminAuthGuard)
  async changePlan(
    @CurrentStaff() staff: StaffContext,
    @Param('id', UuidParam) shopId: string,
    @Param('subId', UuidParam) subId: string,
    @Body(new ZodValidationPipe(ChangePlanRequestSchema)) body: ChangePlanRequest,
  ) {
    return AdminShopBillingSchema.parse(await this.billing.changePlan(staff, shopId, subId, body));
  }

  @Post('shops/:id/subscriptions/:subId/end-date')
  @HttpCode(200)
  @UseGuards(AdminAuthGuard)
  async changeEndDate(
    @CurrentStaff() staff: StaffContext,
    @Param('id', UuidParam) shopId: string,
    @Param('subId', UuidParam) subId: string,
    @Body(new ZodValidationPipe(ChangeEndDateRequestSchema)) body: ChangeEndDateRequest,
  ) {
    return AdminShopBillingSchema.parse(
      await this.billing.changeEndDate(staff, shopId, subId, body),
    );
  }

  @Post('shops/:id/subscriptions/:subId/cancel')
  @HttpCode(200)
  @UseGuards(AdminAuthGuard)
  async cancel(
    @CurrentStaff() staff: StaffContext,
    @Param('id', UuidParam) shopId: string,
    @Param('subId', UuidParam) subId: string,
    @Body(new ZodValidationPipe(CancelSubscriptionRequestSchema)) body: CancelSubscriptionRequest,
  ) {
    return AdminShopBillingSchema.parse(await this.billing.cancel(staff, shopId, subId, body));
  }
}
