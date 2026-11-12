import { HttpStatus, Injectable } from '@nestjs/common';
import {
  type AdminShopCreateRequest,
  type AdminShopDetail,
  type AdminShopMemberRequest,
  type AdminShopUpdateRequest,
  type AutoLimits,
  OPENING_DAYS,
  OWNER_EDITABLE_SHOP_FIELDS,
  type OpeningHours,
} from '@kagaz/shared';
import { AppError } from '../../common/http/api-exception.filter.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { type Prisma } from '../../generated/prisma/client.js';
import { hashPassword } from '../identity/passwords.js';
import { type StaffContext } from '../identity/staff-session.js';
import { auditStaffAction, diffFields } from './admin-audit.js';

export const DEFAULT_AUTO_LIMITS: AutoLimits = {
  maxPages: 50,
  maxCopies: 5,
  maxSides: 250,
  maxQueueDepth: 10,
};

/**
 * Shop settings (P4.3, FR-ADMIN-03): details, opening hours, status, approval mode, auto
 * limits, pause. Admins edit everything; owners only OWNER_EDITABLE_SHOP_FIELDS of their own
 * shop (scope enforced by ShopScopeGuard). Every change is audited in the same transaction.
 */
@Injectable()
export class ShopSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Add a shop login (phone + password), or reset the password/role/name of an existing member
   * with that phone. Admins manage anyone; a shop owner only operators of their own shop.
   */
  async addMember(
    staff: StaffContext,
    shopId: string,
    req: AdminShopMemberRequest,
  ): Promise<AdminShopDetail> {
    if (staff.role !== 'ADMIN' && req.role !== 'SHOP_OPERATOR') {
      throw new AppError(
        'FORBIDDEN_FIELD',
        'Only a Kaggaz admin can add shop owners',
        HttpStatus.FORBIDDEN,
      );
    }
    const passwordHash = await hashPassword(req.password);
    await this.prisma.$transaction(async (tx) => {
      const shop = await tx.shop.findUnique({ where: { id: shopId }, select: { id: true } });
      if (!shop) throw shopNotFound();
      const existing = await tx.user.findUnique({ where: { phone: req.phone } });
      if (existing?.kind === 'ADMIN') {
        throw new AppError(
          'MEMBER_IS_ADMIN',
          'This number belongs to a Kaggaz admin',
          HttpStatus.CONFLICT,
        );
      }
      const role = req.role === 'SHOP_OWNER' ? 'OWNER' : 'OPERATOR';
      if (existing && staff.role !== 'ADMIN') {
        // Owners must not take over (or reset) logins they don't manage.
        const membership = await tx.shopUser.findUnique({
          where: { shopId_userId: { shopId, userId: existing.id } },
        });
        const otherShops = await tx.shopUser.count({
          where: { userId: existing.id, shopId: { not: shopId } },
        });
        if (
          membership?.role === 'OWNER' ||
          otherShops > 0 ||
          (existing.passwordHash && !membership)
        ) {
          throw new AppError(
            'FORBIDDEN_FIELD',
            'Ask a Kaggaz admin to change this login',
            HttpStatus.FORBIDDEN,
          );
        }
      }
      // A customer account with this number becomes a staff login too (its orders stay linked).
      const user = await tx.user.upsert({
        where: { phone: req.phone },
        update: { name: req.name, kind: 'STAFF', passwordHash },
        create: { phone: req.phone, name: req.name, kind: 'STAFF', passwordHash },
      });
      await tx.shopUser.upsert({
        where: { shopId_userId: { shopId, userId: user.id } },
        update: { role },
        create: { shopId, userId: user.id, role },
      });
      await auditStaffAction(
        tx,
        staff,
        existing ? 'shop.member_updated' : 'shop.member_added',
        shopId,
        {
          userId: user.id,
          role,
        },
      );
    });
    return this.detail(shopId);
  }

  /** Remove a shop login from this shop and sign it out of the shop's PCs. */
  async removeMember(
    staff: StaffContext,
    shopId: string,
    userId: string,
  ): Promise<AdminShopDetail> {
    await this.prisma.$transaction(async (tx) => {
      const membership = await tx.shopUser.findUnique({
        where: { shopId_userId: { shopId, userId } },
      });
      if (!membership)
        throw new AppError('MEMBER_NOT_FOUND', 'Member not found', HttpStatus.NOT_FOUND);
      if (staff.role !== 'ADMIN' && membership.role !== 'OPERATOR') {
        throw new AppError(
          'FORBIDDEN_FIELD',
          'Only a Kaggaz admin can remove shop owners',
          HttpStatus.FORBIDDEN,
        );
      }
      await tx.shopUser.delete({ where: { id: membership.id } });
      await tx.operatorSession.updateMany({
        where: { shopId, userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await auditStaffAction(tx, staff, 'shop.member_removed', shopId, {
        userId,
        role: membership.role,
      });
    });
    return this.detail(shopId);
  }

  async detail(shopId: string): Promise<AdminShopDetail> {
    const shop = await this.prisma.shop.findUnique({
      where: { id: shopId },
      include: {
        members: {
          include: { user: { select: { name: true, email: true, phone: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!shop) throw shopNotFound();
    return {
      id: shop.id,
      slug: shop.slug,
      name: shop.name,
      address: shop.address,
      contactPhone: shop.contactPhone,
      status: shop.status,
      approvalMode: shop.approvalMode,
      autoPaused: shop.autoPaused,
      autoLimits: (shop.autoLimits ?? {}) as Partial<AutoLimits>,
      openingHours: normalizeHours(shop.openingHours),
      isDemo: shop.isDemo,
      latitude: shop.latitude,
      longitude: shop.longitude,
      members: shop.members.map((m) => ({
        userId: m.userId,
        name: m.user.name,
        email: m.user.email,
        phone: m.user.phone,
        role: m.role === 'OWNER' ? 'SHOP_OWNER' : 'SHOP_OPERATOR',
      })),
      createdAt: shop.createdAt.toISOString(),
      updatedAt: shop.updatedAt.toISOString(),
    };
  }

  async create(staff: StaffContext, req: AdminShopCreateRequest): Promise<AdminShopDetail> {
    const exists = await this.prisma.shop.findUnique({ where: { slug: req.slug } });
    if (exists) {
      throw new AppError('SHOP_SLUG_TAKEN', 'A shop with this slug exists', HttpStatus.CONFLICT);
    }
    const shop = await this.prisma.$transaction(async (tx) => {
      const created = await tx.shop.create({
        data: {
          slug: req.slug,
          name: req.name,
          address: req.address,
          contactPhone: req.contactPhone ?? null,
          status: 'CLOSED', // opens once it has a device, printer and pricing
          approvalMode: 'MANUAL',
          autoLimits: DEFAULT_AUTO_LIMITS,
          openingHours: normalizeHours({}),
          isDemo: req.isDemo ?? false,
        },
      });
      await auditStaffAction(tx, staff, 'shop.created', created.id, {
        slug: created.slug,
        name: created.name,
      });
      return created;
    });
    return this.detail(shop.id);
  }

  async update(
    staff: StaffContext,
    shopId: string,
    req: AdminShopUpdateRequest,
  ): Promise<AdminShopDetail> {
    if (staff.role !== 'ADMIN') {
      const editable: readonly string[] = OWNER_EDITABLE_SHOP_FIELDS;
      const forbidden = Object.keys(req).filter((k) => !editable.includes(k));
      if (forbidden.length > 0) {
        throw new AppError(
          'FORBIDDEN_FIELD',
          `Only a Kaggaz admin can change: ${forbidden.join(', ')}`,
          HttpStatus.FORBIDDEN,
          { fields: forbidden },
        );
      }
    }

    await this.prisma.$transaction(async (tx) => {
      const shop = await tx.shop.findUnique({ where: { id: shopId } });
      if (!shop) throw shopNotFound();

      const patch: Record<string, unknown> = { ...req };
      if (req.openingHours) patch.openingHours = normalizeHours(req.openingHours);
      // Auto-accept preconditions (PRD §8.4) are evaluated per order, not at mode switch.
      const changes = diffFields(shop as unknown as Record<string, unknown>, patch);
      if (Object.keys(changes).length === 0) return;
      await tx.shop.update({ where: { id: shopId }, data: patch as Prisma.ShopUpdateInput });
      await auditStaffAction(tx, staff, 'shop.updated', shopId, { changes });
      if (changes.approvalMode || changes.autoPaused) {
        await auditStaffAction(tx, staff, 'SHOP_MODE_CHANGED', shopId, {
          approvalMode: (req.approvalMode ?? shop.approvalMode) as string,
          autoPaused: req.autoPaused ?? shop.autoPaused,
          via: 'admin',
        });
      }
    });
    // Realtime `shop.mode_changed` belongs to the realtime workstream (contract §5).
    return this.detail(shopId);
  }
}

/** Every weekday present; missing days are closed ([]). */
export function normalizeHours(value: unknown): OpeningHours {
  const src = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const out: OpeningHours = {};
  for (const day of OPENING_DAYS) {
    const intervals = Array.isArray(src[day]) ? (src[day] as [string, string][]) : [];
    out[day] = [...intervals].sort((a, b) => a[0].localeCompare(b[0]));
  }
  return out;
}

export function shopNotFound(): AppError {
  return new AppError('SHOP_NOT_FOUND', 'Shop not found', HttpStatus.NOT_FOUND);
}
