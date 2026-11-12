import { HttpStatus, Injectable } from '@nestjs/common';
import {
  type ShopMemberList,
  type ShopMemberRequest,
  type ShopPricing,
  type UpdateShopPricing,
} from '@kagaz/shared';
import { type DeviceContext, deviceActor } from '../../common/auth/device-auth.guard.js';
import { AppError } from '../../common/http/api-exception.filter.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { hashPassword } from '../identity/passwords.js';
import { PricingService } from '../pricing/pricing.service.js';

/**
 * Shop-side account management from the Kaggaz Shop app: operator logins and prices. Always the
 * device's own shop (invariant 10); changes need the shop OWNER signed in on that PC.
 */
@Injectable()
export class ShopAccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricing: PricingService,
  ) {}

  async members(device: DeviceContext): Promise<ShopMemberList> {
    const rows = await this.prisma.shopUser.findMany({
      where: { shopId: device.shopId },
      orderBy: { createdAt: 'asc' },
      select: { role: true, user: { select: { id: true, name: true, phone: true } } },
    });
    return {
      members: rows.map((r) => ({
        userId: r.user.id,
        name: r.user.name,
        phone: r.user.phone,
        role: r.role,
      })),
    };
  }

  /** Add an operator login, or reset an existing operator's name/password. */
  async addOperator(device: DeviceContext, req: ShopMemberRequest): Promise<ShopMemberList> {
    const owner = requireOwner(device);
    const shopId = device.shopId;
    const passwordHash = await hashPassword(req.password);
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({
        where: { phone: req.phone },
        select: {
          id: true,
          kind: true,
          passwordHash: true,
          shopMemberships: { select: { shopId: true, role: true } },
        },
      });
      if (existing) {
        const here = existing.shopMemberships.find((m) => m.shopId === shopId);
        const elsewhere = existing.shopMemberships.some((m) => m.shopId !== shopId);
        // Owners manage their own operators only: never admins, owners or other shops' logins.
        if (
          existing.kind === 'ADMIN' ||
          here?.role === 'OWNER' ||
          elsewhere ||
          (!here && existing.passwordHash)
        ) {
          throw new AppError(
            'MEMBER_NOT_ALLOWED',
            'This number is already used by another Kaggaz login. Contact Kaggaz support.',
            HttpStatus.FORBIDDEN,
          );
        }
      }
      const user = await tx.user.upsert({
        where: { phone: req.phone },
        update: { name: req.name, kind: 'STAFF', passwordHash },
        create: { phone: req.phone, name: req.name, kind: 'STAFF', passwordHash },
      });
      await tx.shopUser.upsert({
        where: { shopId_userId: { shopId, userId: user.id } },
        update: {},
        create: { shopId, userId: user.id, role: 'OPERATOR' },
      });
      await tx.auditLog.create({
        data: {
          actorType: 'STAFF',
          actorId: owner.userId,
          shopId,
          action: existing ? 'shop.member_updated' : 'shop.member_added',
          metadata: { userId: user.id, role: 'OPERATOR', deviceId: device.deviceId },
        },
      });
    });
    return this.members(device);
  }

  /** Remove an operator from this shop and sign them out of its PCs. */
  async removeOperator(device: DeviceContext, userId: string): Promise<ShopMemberList> {
    const owner = requireOwner(device);
    const shopId = device.shopId;
    await this.prisma.$transaction(async (tx) => {
      const membership = await tx.shopUser.findUnique({
        where: { shopId_userId: { shopId, userId } },
      });
      if (!membership) {
        throw new AppError('MEMBER_NOT_FOUND', 'Member not found', HttpStatus.NOT_FOUND);
      }
      if (membership.role !== 'OPERATOR') {
        throw new AppError(
          'MEMBER_NOT_ALLOWED',
          'The shop owner can only be changed by Kaggaz support',
          HttpStatus.FORBIDDEN,
        );
      }
      await tx.shopUser.delete({ where: { shopId_userId: { shopId, userId } } });
      await tx.operatorSession.updateMany({
        where: { shopId, userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          actorType: 'STAFF',
          actorId: owner.userId,
          shopId,
          action: 'shop.member_removed',
          metadata: { userId, role: 'OPERATOR', deviceId: device.deviceId },
        },
      });
    });
    return this.members(device);
  }

  /** The pricing in effect now, or null before the first version. */
  async currentPricing(device: DeviceContext): Promise<ShopPricing | null> {
    const row = await this.prisma.shopPricing.findFirst({
      where: { shopId: device.shopId, effectiveFrom: { lte: new Date() } },
      orderBy: { effectiveFrom: 'desc' },
    });
    return row
      ? {
          monoRatePaise: row.monoRatePaise,
          colourRatePaise: row.colourRatePaise,
          monoDuplexRatePaise: row.monoDuplexRatePaise,
          colourDuplexRatePaise: row.colourDuplexRatePaise,
          duplexRule: row.duplexRule,
          minimumChargePaise: row.minimumChargePaise,
          effectiveFrom: row.effectiveFrom.toISOString(),
        }
      : null;
  }

  /** New prices, effective now (paid orders keep their snapshot). Audited by PricingService. */
  async setPricing(device: DeviceContext, body: UpdateShopPricing): Promise<ShopPricing | null> {
    requireOwner(device);
    await this.pricing.createVersion(
      device.shopId,
      { ...body, effectiveFrom: undefined },
      deviceActor(device),
    );
    return this.currentPricing(device);
  }
}

export function requireOwner(device: DeviceContext) {
  if (device.operator?.role !== 'SHOP_OWNER') {
    throw new AppError(
      'OWNER_ONLY',
      'Only the shop owner can do this. Ask your shop owner to sign in.',
      HttpStatus.FORBIDDEN,
    );
  }
  return device.operator;
}
