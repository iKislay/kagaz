import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { type Request } from 'express';
import {
  type AdminOrderActionResult,
  type AdminRejectOrderRequest,
  AdminRejectOrderRequestSchema,
  type DemoPayments,
  type HeldOrders,
  type SetDemoOutcomeRequest,
  SetDemoOutcomeRequestSchema,
  type ShopSettlement,
  type UpdateShopSettlementRequest,
  UpdateShopSettlementRequestSchema,
} from '@kagaz/shared';
import { type Actor } from '../../common/actor.js';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe.js';
import { AdminAuthGuard } from '../admin/auth/admin-auth.guard.js';
import { AdminOrderActionsService } from './admin-order-actions.service.js';
import { DemoControlsService } from './demo-controls.service.js';

type AdminRequest = Request & { admin?: { userId: string } };
const adminActor = (req: AdminRequest): Actor => ({ type: 'ADMIN', id: req.admin?.userId ?? null });

/** Admin business actions: reject after payment → refund, refund retry, held orders. */
@Controller('admin')
@UseGuards(AdminAuthGuard)
export class AdminPaymentsController {
  constructor(private readonly actions: AdminOrderActionsService) {}

  @Post('orders/:id/reject')
  @HttpCode(200)
  reject(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AdminRejectOrderRequestSchema)) body: AdminRejectOrderRequest,
    @Req() req: AdminRequest,
  ): Promise<AdminOrderActionResult> {
    return this.actions.reject(id, body, adminActor(req));
  }

  @Post('orders/:id/refund')
  @HttpCode(200)
  refund(@Param('id') id: string, @Req() req: AdminRequest): Promise<AdminOrderActionResult> {
    return this.actions.retryRefund(id, adminActor(req));
  }

  /** P3.8: merchant-of-record readiness fields — stored, never active until D6 is decided. */
  @Patch('shops/:id/settlement')
  settlement(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateShopSettlementRequestSchema))
    body: UpdateShopSettlementRequest,
    @Req() req: AdminRequest,
  ): Promise<ShopSettlement> {
    return this.actions.updateSettlement(id, body, adminActor(req));
  }

  @Get('held-orders')
  async held(): Promise<HeldOrders> {
    return { items: await this.actions.heldOrders() };
  }
}

/** Demo payment outcome controls (P3.5) — 404 when demo controls are disabled. */
@Controller('admin/demo/payments')
@UseGuards(AdminAuthGuard)
export class DemoPaymentsController {
  constructor(private readonly demo: DemoControlsService) {}

  @Get()
  overview(): Promise<DemoPayments> {
    return this.demo.overview();
  }

  @Put(':orderId/outcome')
  async setOutcome(
    @Param('orderId') orderId: string,
    @Body(new ZodValidationPipe(SetDemoOutcomeRequestSchema)) body: SetDemoOutcomeRequest,
  ): Promise<{ orderId: string; nextOutcome: SetDemoOutcomeRequest['outcome'] }> {
    await this.demo.setOutcome(orderId, body.outcome);
    return { orderId, nextOutcome: body.outcome };
  }
}
