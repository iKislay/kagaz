import { HttpStatus, Injectable } from '@nestjs/common';
import { ShopStatus, type ShopSummary } from '@kagaz/shared';
import { AppError } from '../../common/http/api-exception.filter.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { isWithinOpeningHours } from './opening-hours.js';

export interface ShopCapabilities {
  colour: boolean;
  duplex: boolean;
}

@Injectable()
export class ShopsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Public shop list (FR-CUST-01): status, current rates and capabilities. */
  async listPublic(): Promise<ShopSummary[]> {
    const shops = await this.prisma.shop.findMany({
      orderBy: { name: 'asc' },
      include: {
        printers: { where: { enabled: true } },
        pricing: {
          where: { effectiveFrom: { lte: new Date() } },
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
        },
      },
    });
    return shops.map((shop) => {
      const pricing = shop.pricing[0] ?? null;
      return {
        id: shop.id,
        slug: shop.slug,
        name: shop.name,
        address: shop.address,
        status: shop.status,
        acceptingOrders: this.unavailableReason(shop) === null && pricing !== null,
        isDemo: shop.isDemo,
        capabilities: {
          colour: shop.printers.some((p) => p.colourCapable),
          duplex: shop.printers.some((p) => p.duplexCapable),
        },
        pricing: pricing && {
          monoRatePaise: pricing.monoRatePaise,
          colourRatePaise: pricing.colourRatePaise,
          monoDuplexRatePaise: pricing.monoDuplexRatePaise,
          colourDuplexRatePaise: pricing.colourDuplexRatePaise,
          duplexRule: pricing.duplexRule,
          minimumChargePaise: pricing.minimumChargePaise,
        },
      };
    });
  }

  /**
   * Throws SHOP_UNAVAILABLE unless the shop can take a new order now (FR-CUST-02, P3.6):
   * status OPEN and within opening hours (Asia/Kolkata). Used for new drafts and checkout.
   */
  async requireOrderableShop(shopId: string) {
    const shop = await this.prisma.shop.findUnique({ where: { id: shopId } });
    if (!shop) throw new AppError('SHOP_NOT_FOUND', 'Shop not found', HttpStatus.NOT_FOUND);
    const reason = this.unavailableReason(shop);
    if (reason) {
      throw new AppError(
        'SHOP_UNAVAILABLE',
        reason === 'OUTSIDE_OPENING_HOURS'
          ? `${shop.name} is closed right now (outside opening hours)`
          : `${shop.name} is not accepting orders right now`,
        HttpStatus.CONFLICT,
        { reason },
      );
    }
    return shop;
  }

  /** What the shop's enabled printers can do. Mono/simplex A4 is always allowed. */
  async capabilities(shopId: string): Promise<ShopCapabilities> {
    const printers = await this.prisma.printer.findMany({ where: { shopId, enabled: true } });
    return {
      colour: printers.some((p) => p.colourCapable),
      duplex: printers.some((p) => p.duplexCapable),
    };
  }

  /** Why a shop can't take new orders right now, or null when it can. */
  unavailableReason(
    shop: { status: string; openingHours: unknown },
    now: Date = new Date(),
  ): 'SHOP_NOT_OPEN' | 'SHOP_MAINTENANCE' | 'OUTSIDE_OPENING_HOURS' | null {
    if (shop.status === ShopStatus.MAINTENANCE) return 'SHOP_MAINTENANCE';
    if (shop.status !== ShopStatus.OPEN) return 'SHOP_NOT_OPEN';
    if (!isWithinOpeningHours(shop.openingHours, now)) return 'OUTSIDE_OPENING_HOURS';
    return null;
  }
}
