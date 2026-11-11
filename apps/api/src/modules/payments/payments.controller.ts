import { Body, Controller, HttpCode, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { type Request } from 'express';
import {
  type PayResponse,
  type PublicOrder,
  type ReportPaymentRequest,
  ReportPaymentRequestSchema,
} from '@kagaz/shared';
import { CustomerSessionService } from '../../common/auth/customer-session.js';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe.js';
import { TrackingGuard } from '../orders/tracking.guard.js';
import { DemoControlsService } from './demo-controls.service.js';
import { PaymentReportsService } from './payment-reports.service.js';
import { PaymentsService } from './payments.service.js';

@Controller('orders')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly demo: DemoControlsService,
    private readonly reports: PaymentReportsService,
    private readonly sessions: CustomerSessionService,
  ) {}

  /**
   * ADR-003 fallback: "I paid but it isn't confirmed" with the 12-digit UPI reference. Never
   * marks anything paid — it asks the shop to check its UPI account.
   */
  @Post(':id/payment-report')
  @HttpCode(200)
  @UseGuards(TrackingGuard)
  async report(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ReportPaymentRequestSchema)) body: ReportPaymentRequest,
    @Req() req: Request,
  ): Promise<PublicOrder> {
    const session = await this.sessions.fromRequest(req);
    return this.reports.report(id, body.utr, {
      type: 'CUSTOMER',
      id: session?.customerId ?? null,
    });
  }

  /**
   * Takes no body: the amount is always the server's price snapshot. Calling it again while a
   * payment is pending re-checks the provider; after a failed payment it starts a new attempt.
   * `?demoOutcome=FAIL|PENDING|…` is a demo-only simulation flag (P3.5).
   */
  @Post(':id/pay')
  @HttpCode(200)
  @UseGuards(TrackingGuard)
  async pay(
    @Param('id') id: string,
    @Query('demoOutcome') demoOutcome?: string,
  ): Promise<PayResponse> {
    await this.demo.applyPayFlag(id, demoOutcome);
    return this.payments.pay(id);
  }
}
