import { HttpStatus, Injectable } from '@nestjs/common';
import { type AdminPricingVersion, type CreatePricingVersion } from '@kagaz/shared';
import { type Actor } from '../../common/actor.js';
import { AppError } from '../../common/http/api-exception.filter.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { type ShopPricing } from '../../generated/prisma/client.js';
import { type PricingRates } from './quote.js';

/**
 * Per-shop pricing versions (P2.5, FR-PRICE-01..04). Rows are append-only: a price change is a
 * new row with its own `effective_from`; quotes use the latest row effective now, and paid
 * orders keep their immutable `price_snapshot`.
 */
@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  /** The pricing row in effect for a shop at a moment (latest effective_from ≤ at). */
  async getEffectivePricing(shopId: string, at: Date = new Date()): Promise<PricingRates> {
    const row = await this.prisma.shopPricing.findFirst({
      where: { shopId, effectiveFrom: { lte: at } },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
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

  async listVersions(shopId: string): Promise<AdminPricingVersion[]> {
    await this.requireShop(shopId);
    const rows = await this.prisma.shopPricing.findMany({
      where: { shopId },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
    });
    const now = new Date();
    const current = rows.find((r) => r.effectiveFrom <= now)?.id;
    return rows.map((r) => toVersion(r, r.id === current));
  }

  async createVersion(
    shopId: string,
    input: CreatePricingVersion,
    actor: Actor,
  ): Promise<AdminPricingVersion> {
    await this.requireShop(shopId);
    const effectiveFrom = input.effectiveFrom ? new Date(input.effectiveFrom) : new Date();
    if (effectiveFrom.getTime() < Date.now() - 60_000) {
      throw new AppError(
        'PRICING_IN_PAST',
        'A new price can start now or later, not in the past',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.shopPricing.create({
        data: {
          shopId,
          monoRatePaise: input.monoRatePaise,
          colourRatePaise: input.colourRatePaise,
          monoDuplexRatePaise: input.monoDuplexRatePaise ?? null,
          colourDuplexRatePaise: input.colourDuplexRatePaise ?? null,
          duplexRule: input.duplexRule,
          minimumChargePaise: input.minimumChargePaise,
          effectiveFrom,
        },
      });
      await tx.auditLog.create({
        data: {
          actorType: actor.type,
          actorId: actor.id,
          shopId,
          action: 'pricing.version_created',
          metadata: { pricingId: created.id, ...input, effectiveFrom: effectiveFrom.toISOString() },
        },
      });
      return created;
    });
    return toVersion(row, row.effectiveFrom <= new Date());
  }

  private async requireShop(shopId: string): Promise<void> {
    const uuid = /^[0-9a-f-]{36}$/i;
    const shop = uuid.test(shopId)
      ? await this.prisma.shop.findUnique({ where: { id: shopId }, select: { id: true } })
      : null;
    if (!shop) throw new AppError('SHOP_NOT_FOUND', 'Shop not found', HttpStatus.NOT_FOUND);
  }
}

function toVersion(r: ShopPricing, current: boolean): AdminPricingVersion {
  return {
    id: r.id,
    monoRatePaise: r.monoRatePaise,
    colourRatePaise: r.colourRatePaise,
    monoDuplexRatePaise: r.monoDuplexRatePaise,
    colourDuplexRatePaise: r.colourDuplexRatePaise,
    duplexRule: r.duplexRule,
    minimumChargePaise: r.minimumChargePaise,
    effectiveFrom: r.effectiveFrom.toISOString(),
    createdAt: r.createdAt.toISOString(),
    current,
  };
}
