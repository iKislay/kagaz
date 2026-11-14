import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG } from '../../common/config/config.module.js';
import { type AppConfig } from '../../common/config/config.schema.js';
import { AppEnv, ShopStatus, type ShopSummary } from '@kagaz/shared';
import { AppError } from '../../common/http/api-exception.filter.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { currentSubscriptionWhere } from '../billing/entitlement.js';

export interface ShopCapabilities {
  colour: boolean;
  duplex: boolean;
}

@Injectable()
export class ShopsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * Public shop list (FR-CUST-01): status, current rates and capabilities. A shop whose Windows
   * app isn't connected (no recent heartbeat) is listed but not accepting orders.
   */
  async listPublic(): Promise<ShopSummary[]> {
    const now = new Date();
    const onlineSince = new Date(
      now.getTime() - this.config.DEVICE_ONLINE_THRESHOLD_SECONDS * 1000,
    );
    const shops = await this.prisma.shop.findMany({
      // Seeded demo/test shops never appear to the public in production.
      where: this.config.APP_ENV === AppEnv.PRODUCTION ? { isDemo: false } : {},
      orderBy: { name: 'asc' },
      include: {
        printers: { where: { enabled: true } },
        devices: {
          where: { status: 'ACTIVE', lastHeartbeatAt: { gte: onlineSince } },
          select: { id: true },
          take: 1,
        },
        pricing: {
          where: { effectiveFrom: { lte: now } },
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
        },
        subscriptions: { where: currentSubscriptionWhere(now), select: { id: true }, take: 1 },
      },
    });
    return shops.map((shop) => {
      const pricing = shop.pricing[0] ?? null;
      const online = shop.devices.length > 0;
      const subscribed = !this.config.BILLING_ENFORCED || shop.subscriptions.length > 0;
      return {
        id: shop.id,
        slug: shop.slug,
        name: shop.name,
        address: shop.address,
        status: shop.status,
        online,
        acceptingOrders:
          online && subscribed && this.unavailableReason(shop) === null && pricing !== null,
        isDemo: shop.isDemo,
        capabilities: {
          colour: shop.printers.some((p) => p.colourCapable),
          duplex: shop.printers.some((p) => p.duplexCapable),
        },
        location:
          shop.latitude !== null && shop.longitude !== null
            ? { lat: shop.latitude, lng: shop.longitude }
            : null,
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
   * status OPEN. Used for new drafts and checkout.
   */
  async requireOrderableShop(shopId: string) {
    const shop = await this.prisma.shop.findUnique({ where: { id: shopId } });
    if (!shop) throw new AppError('SHOP_NOT_FOUND', 'Shop not found', HttpStatus.NOT_FOUND);
    const reason = this.unavailableReason(shop);
    if (reason) {
      throw new AppError(
        'SHOP_UNAVAILABLE',
        `${shop.name} is not accepting orders right now`,
        HttpStatus.CONFLICT,
        { reason },
      );
    }
    // ADR-004: new orders need a current subscription (orders already paid are never blocked).
    if (
      this.config.BILLING_ENFORCED &&
      !(await this.prisma.subscription.findFirst({
        where: { shopId, ...currentSubscriptionWhere(new Date()) },
        select: { id: true },
      }))
    ) {
      throw new AppError(
        'SUBSCRIPTION_INACTIVE',
        `${shop.name} is not taking Kaggaz orders right now`,
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

  /** Why a shop can't take new orders right now, or null when it can. */
  unavailableReason(shop: { status: string }): 'SHOP_NOT_OPEN' | 'SHOP_MAINTENANCE' | null {
    if (shop.status === ShopStatus.MAINTENANCE) return 'SHOP_MAINTENANCE';
    if (shop.status !== ShopStatus.OPEN) return 'SHOP_NOT_OPEN';
    return null;
  }
}
