import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  type ConfirmManualRefundRequest,
  ConfirmManualRefundRequestSchema,
  type DeclinePaymentReportRequest,
  DeclinePaymentReportRequestSchema,
  type ShopManualRefundList,
  type ShopPaymentReport,
  type ShopPaymentReportList,
  type ShopPaymentSetup,
  type ShopPhonePairing,
  type UpdateShopPaymentSetupRequest,
  UpdateShopPaymentSetupRequestSchema,
} from '@kagaz/shared';
import { AgentVersionGuard } from '../../common/auth/agent-version.guard.js';
import {
  CurrentDevice,
  DeviceAuthGuard,
  type DeviceContext,
  deviceActor,
} from '../../common/auth/device-auth.guard.js';
import { IdempotencyInterceptor } from '../../common/http/idempotency.interceptor.js';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe.js';
import { RequireOperator } from '../identity/operator-auth.guard.js';
import { ManualRefundsService } from '../payments/manual-refunds.service.js';
import { PaymentReportsService } from '../payments/payment-reports.service.js';
import { ShopPaymentAccountsService } from '../payments/shop-payment-accounts.service.js';

/**
 * ADR-003 shop endpoints (docs/contracts/UPI_PAYMENTS_CONTRACT.md): payment setup (UPI ID +
 * phone pairing), customer payment reports and manual refunds. Shop = authenticated device's
 * shop (invariant 10); human actions need the signed-in operator and are audited.
 */
@Controller('shop')
@UseGuards(DeviceAuthGuard, AgentVersionGuard)
@UseInterceptors(IdempotencyInterceptor)
export class ShopPaymentsController {
  constructor(
    private readonly accounts: ShopPaymentAccountsService,
    private readonly reports: PaymentReportsService,
    private readonly refunds: ManualRefundsService,
  ) {}

  @Get('payments/setup')
  getSetup(@CurrentDevice() device: DeviceContext): Promise<ShopPaymentSetup> {
    return this.accounts.getSetup(device.shopId);
  }

  @Put('payments/setup')
  @RequireOperator()
  saveSetup(
    @CurrentDevice() device: DeviceContext,
    @Body(new ZodValidationPipe(UpdateShopPaymentSetupRequestSchema))
    body: UpdateShopPaymentSetupRequest,
  ): Promise<ShopPaymentSetup> {
    return this.accounts.saveSetup(device.shopId, body, deviceActor(device));
  }

  @Post('payments/pairing')
  @HttpCode(200)
  @RequireOperator()
  pairing(@CurrentDevice() device: DeviceContext): Promise<ShopPhonePairing> {
    return this.accounts.pairing(device.shopId, deviceActor(device));
  }

  @Get('payment-reports')
  async listReports(
    @CurrentDevice() device: DeviceContext,
    @Query('status') status?: string,
  ): Promise<ShopPaymentReportList> {
    return { reports: await this.reports.list(device.shopId, status === 'ALL' ? 'ALL' : 'OPEN') };
  }

  @Post('payment-reports/:id/approve')
  @HttpCode(200)
  @RequireOperator()
  approve(
    @CurrentDevice() device: DeviceContext,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ShopPaymentReport> {
    return this.reports.approve(device.shopId, id, deviceActor(device));
  }

  @Post('payment-reports/:id/decline')
  @HttpCode(200)
  @RequireOperator()
  decline(
    @CurrentDevice() device: DeviceContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(DeclinePaymentReportRequestSchema))
    body: DeclinePaymentReportRequest,
  ): Promise<ShopPaymentReport> {
    return this.reports.decline(device.shopId, id, body, deviceActor(device));
  }

  @Get('refunds')
  async listRefunds(@CurrentDevice() device: DeviceContext): Promise<ShopManualRefundList> {
    return { refunds: await this.refunds.listPending(device.shopId) };
  }

  @Post('refunds/:id/confirm')
  @HttpCode(204)
  @RequireOperator()
  async confirmRefund(
    @CurrentDevice() device: DeviceContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ConfirmManualRefundRequestSchema)) body: ConfirmManualRefundRequest,
  ): Promise<void> {
    await this.refunds.confirm(device.shopId, id, body.utr, deviceActor(device));
  }
}
