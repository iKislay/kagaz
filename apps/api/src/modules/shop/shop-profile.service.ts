import { HttpStatus, Injectable } from '@nestjs/common';
import { type ShopLocationRequest, type ShopProfile, type UpdateShopProfile } from '@kagaz/shared';
import { type DeviceContext } from '../../common/auth/device-auth.guard.js';
import { AppError } from '../../common/http/api-exception.filter.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { type Prisma } from '../../generated/prisma/client.js';
import { type Tx } from '../orders/order-state-machine.js';
import { requireOwner } from './shop-account.service.js';

/**
 * The shop's own details, set up by the owner in the Kaggaz Shop app on first run: name and
 * contact number, the location (the PC's position or a searched place; the owner may edit the
 * address customers read) and prices. Each step is saved as it is confirmed; `completeSetup` closes first-run setup.
 * Always the device's own shop (invariant 10); changes need the owner signed in, and are audited.
 */
@Injectable()
export class ShopProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async get(device: DeviceContext): Promise<ShopProfile> {
    const shop = await this.prisma.shop.findUniqueOrThrow({
      where: { id: device.shopId },
      select: {
        name: true,
        contactPhone: true,
        address: true,
        latitude: true,
        longitude: true,
        onboardedAt: true,
      },
    });
    return {
      name: shop.name,
      contactPhone: shop.contactPhone,
      address: shop.address,
      location:
        shop.latitude !== null && shop.longitude !== null
          ? { lat: shop.latitude, lng: shop.longitude }
          : null,
      setupComplete: shop.onboardedAt !== null,
    };
  }

  async update(device: DeviceContext, req: UpdateShopProfile): Promise<ShopProfile> {
    await this.write(device, 'shop.profile_updated', req, { fields: Object.keys(req) });
    return this.get(device);
  }

  async setLocation(device: DeviceContext, req: ShopLocationRequest): Promise<ShopProfile> {
    await this.write(
      device,
      'shop.location_set',
      { latitude: req.lat, longitude: req.lng, address: req.address },
      { lat: req.lat, lng: req.lng },
    );
    return this.get(device);
  }

  /** Finish first-run setup: needs the location (customers find shops by it). Idempotent. */
  async completeSetup(device: DeviceContext): Promise<ShopProfile> {
    const owner = requireOwner(device);
    await this.prisma.$transaction(async (tx) => {
      const shop = await tx.shop.findUniqueOrThrow({
        where: { id: device.shopId },
        select: { latitude: true, onboardedAt: true },
      });
      if (shop.onboardedAt) return;
      if (shop.latitude === null) {
        throw new AppError(
          'SETUP_INCOMPLETE',
          "Set your shop's location first",
          HttpStatus.CONFLICT,
        );
      }
      await tx.shop.update({ where: { id: device.shopId }, data: { onboardedAt: new Date() } });
      await audit(tx, device, owner.userId, 'shop.setup_completed', {});
    });
    return this.get(device);
  }

  private async write(
    device: DeviceContext,
    action: string,
    data: Prisma.ShopUpdateInput,
    metadata: Prisma.InputJsonObject,
  ): Promise<void> {
    const owner = requireOwner(device);
    await this.prisma.$transaction(async (tx) => {
      await tx.shop.update({ where: { id: device.shopId }, data });
      await audit(tx, device, owner.userId, action, metadata);
    });
  }
}

function audit(
  tx: Tx,
  device: DeviceContext,
  userId: string,
  action: string,
  metadata: Prisma.InputJsonObject,
) {
  return tx.auditLog.create({
    data: {
      actorType: 'STAFF',
      actorId: userId,
      shopId: device.shopId,
      action,
      metadata: { ...metadata, deviceId: device.deviceId },
    },
  });
}
