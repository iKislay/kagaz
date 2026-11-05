import { Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { type PayResponse } from '@kagaz/shared';
import { TrackingGuard } from '../orders/tracking.guard.js';
import { PaymentsService } from './payments.service.js';

@Controller('orders')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** Takes no body: the amount is always the server's price snapshot. */
  @Post(':id/pay')
  @HttpCode(200)
  @UseGuards(TrackingGuard)
  pay(@Param('id') id: string): Promise<PayResponse> {
    return this.payments.pay(id);
  }
}
