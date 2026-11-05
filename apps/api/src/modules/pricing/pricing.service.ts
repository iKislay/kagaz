import { HttpStatus, Injectable } from '@nestjs/common';
import { AppError } from '../../common/http/api-exception.filter.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { type PricingRates } from './quote.js';

@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  /** The pricing row in effect for a shop at a moment (latest effective_from ≤ at). */
  async getEffectivePricing(shopId: string, at: Date = new Date()): Promise<PricingRates> {
    const row = await this.prisma.shopPricing.findFirst({
      where: { shopId, effectiveFrom: { lte: at } },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (!row) {
      throw new AppError(
        'PRICING_NOT_CONFIGURED',
        'This shop has no pricing configured',
        HttpStatus.CONFLICT,
      );
    }
    return row;
  }
}
