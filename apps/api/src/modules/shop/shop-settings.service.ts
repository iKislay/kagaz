import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  type ShopPricing,
  type ShopProfile,
  type UpdateShopLocationRequest,
  type UpdateShopPricingRequest,
} from '@kagaz/shared';
import { type DeviceContext, deviceActor } from '../../common/auth/device-auth.guard.js';
import { APP_CONFIG } from '../../common/config/config.module.js';
import { type AppConfig } from '../../common/config/config.schema.js';
import { AppError } from '../../common/http/api-exception.filter.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { type ShopPricing as PricingRow } from '../../generated/prisma/client.js';
import { PricingService } from '../pricing/pricing.service.js';
import { shopOrderUrl } from '../shops/shops.controller.js';
import { ShopsService } from '../shops/shops.service.js';
import { requireShopId } from './shop-scope.js';

/**
 * The shop's own settings on the Windows app: its prices (every print configuration) and its
 * public profile (QR link, poster, map position). The shop is always the device's shop
 * (invariant 10). Reading is open to the device; changing prices or location needs the signed-in
 * SHOP OWNER — operators see them read-only.
 */
@Injectable()
export class ShopSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
    private readonly shops: ShopsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async getPricing(device: DeviceContext): Promise<ShopPricing> {
    const shopId = requireShopId(device.shopId);
    const row = await this.prisma.shopPricing.findFirst({
      where: { shopId, effectiveFrom: { lte: new Date() } },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
    });
    if (!row) {
      throw new AppError('PRICING_NOT_SET', 'This shop has no prices yet', HttpStatus.NOT_FOUND);
    }
    return this.toPricing(row, await this.shops.capabilities(shopId));
  }

  /**
   * A new pricing version, effective now (P2.5 versions + audit via PricingService). The shop
   * app always sends all four per-side rates, so double-sided uses its own rates
   * (DISCOUNTED_SIDE_RATE); equal rates simply mean "same as single-sided". Customers who were
   * quoted the old price get 409 PRICE_CHANGED at checkout and confirm the new total.
   */
  async updatePricing(device: DeviceContext, body: UpdateShopPricingRequest): Promise<ShopPricing> {
    requireOwner(device);
    const shopId = requireShopId(device.shopId);
    await this.pricing.createVersion(
      shopId,
      {
        monoRatePaise: body.monoRatePaise,
        colourRatePaise: body.colourRatePaise,
        monoDuplexRatePaise: body.monoDuplexRatePaise,
        colourDuplexRatePaise: body.colourDuplexRatePaise,
        duplexRule: 'DISCOUNTED_SIDE_RATE',
        minimumChargePaise: body.minimumChargePaise,
      },
      deviceActor(device),
    );
    return this.getPricing(device);
  }

  async getProfile(device: DeviceContext): Promise<ShopProfile> {
    const shop = await this.prisma.shop.findUniqueOrThrow({
      where: { id: requireShopId(device.shopId) },
    });
    const orderUrl = shopOrderUrl(this.config, shop.slug);
    return {
      shopId: shop.id,
      slug: shop.slug,
      name: shop.name,
      address: shop.address,
      location:
        shop.latitude !== null && shop.longitude !== null
          ? { latitude: shop.latitude, longitude: shop.longitude }
          : null,
      orderUrl,
      posterUrl: `${orderUrl}/poster`,
    };
  }

  async updateLocation(
    device: DeviceContext,
    body: UpdateShopLocationRequest,
  ): Promise<ShopProfile> {
    requireOwner(device);
    const shopId = requireShopId(device.shopId);
    const actor = deviceActor(device);
    await this.prisma.$transaction(async (tx) => {
      await tx.shop.update({
        where: { id: shopId },
        data: { latitude: body.latitude, longitude: body.longitude },
      });
      await tx.auditLog.create({
        data: {
          actorType: actor.type,
          actorId: actor.id,
          shopId,
          action: 'shop.location_updated',
          metadata: {
            latitude: body.latitude,
            longitude: body.longitude,
            deviceId: device.deviceId,
          },
        },
      });
    });
    return this.getProfile(device);
  }

  private toPricing(row: PricingRow, caps: { colour: boolean; duplex: boolean }): ShopPricing {
    const discounted = row.duplexRule === 'DISCOUNTED_SIDE_RATE';
    return {
      monoRatePaise: row.monoRatePaise,
      // SAME_AS_SIMPLEX (or a missing duplex rate) charges the single-sided rate.
      monoDuplexRatePaise: (discounted && row.monoDuplexRatePaise) || row.monoRatePaise,
      colourRatePaise: row.colourRatePaise,
      colourDuplexRatePaise: (discounted && row.colourDuplexRatePaise) || row.colourRatePaise,
      minimumChargePaise: row.minimumChargePaise,
      effectiveFrom: row.effectiveFrom.toISOString(),
      colourAvailable: caps.colour,
      duplexAvailable: caps.duplex,
    };
  }
}

function requireOwner(device: DeviceContext): void {
  if (device.operator?.role !== 'SHOP_OWNER') {
    throw new AppError(
      'OWNER_REQUIRED',
      'Only the shop owner can change this',
      HttpStatus.FORBIDDEN,
    );
  }
}
