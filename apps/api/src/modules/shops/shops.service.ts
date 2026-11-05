import { HttpStatus, Injectable } from '@nestjs/common';
import { ShopStatus, type ShopSummary } from '@kagaz/shared';
import { AppError } from '../../common/http/api-exception.filter.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';

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
        acceptingOrders: this.isAcceptingOrders(shop.status) && pricing !== null,
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

  /** Throws SHOP_UNAVAILABLE unless the shop can take a new order now (FR-CUST-02). */
  async requireOrderableShop(shopId: string) {
    const shop = await this.prisma.shop.findUnique({ where: { id: shopId } });
    if (!shop) throw new AppError('SHOP_NOT_FOUND', 'Shop not found', HttpStatus.NOT_FOUND);
    if (!this.isAcceptingOrders(shop.status)) {
      throw new AppError(
        'SHOP_UNAVAILABLE',
        `${shop.name} is not accepting orders right now`,
        HttpStatus.CONFLICT,
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

  // Opening hours are evaluated from P3.6; for now the shop status decides.
  private isAcceptingOrders(status: string): boolean {
    return status === ShopStatus.OPEN;
  }
}
