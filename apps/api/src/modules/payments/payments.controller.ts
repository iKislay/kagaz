import { Controller, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { type PayAtCounterResponse, type PayResponse } from '@kagaz/shared';
import { TrackingGuard } from '../orders/tracking.guard.js';
import { DemoControlsService } from './demo-controls.service.js';
import { PaymentsService } from './payments.service.js';

@Controller('orders')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly demo: DemoControlsService,
  ) {}

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

  /**
   * ADR-003: pay at the shop counter. Takes no body; the amount is the server's price snapshot.
   * Returns the order with its daily `pickupNumber` — what the customer shows at the counter.
   */
  @Post(':id/pay-at-counter')
  @HttpCode(200)
  @UseGuards(TrackingGuard)
  payAtCounter(@Param('id') id: string): Promise<PayAtCounterResponse> {
    return this.payments.payAtCounter(id);
  }
}
