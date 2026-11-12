import { HttpStatus, Injectable } from '@nestjs/common';
import {
  type AdminShopCreateRequest,
  type AdminShopDetail,
  type AdminShopUpdateRequest,
  type AutoLimits,
  OPENING_DAYS,
  OWNER_EDITABLE_SHOP_FIELDS,
  type OpeningHours,
} from '@kagaz/shared';
import { AppError } from '../../common/http/api-exception.filter.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { type Prisma } from '../../generated/prisma/client.js';
import { type StaffContext } from '../identity/staff-session.js';
import { auditStaffAction, diffFields } from './admin-audit.js';

const DEFAULT_AUTO_LIMITS: AutoLimits = {
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
          `Only a Kagaz admin can change: ${forbidden.join(', ')}`,
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
