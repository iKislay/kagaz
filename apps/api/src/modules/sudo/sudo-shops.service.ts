import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  OPEN_SUBSCRIPTION_STATUSES,
  OrderStatus,
  type SudoShopCreateRequest,
  type SudoShopCreated,
  type SudoShopDetail,
  type SudoShopRow,
} from '@kagaz/shared';
import { APP_CONFIG } from '../../common/config/config.module.js';
import { type AppConfig } from '../../common/config/config.schema.js';
import { AppError } from '../../common/http/api-exception.filter.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { type Prisma } from '../../generated/prisma/client.js';
import { auditStaffAction } from '../admin/admin-audit.js';
import { normalizeHours } from '../admin/shop-settings.service.js';
import { type StaffContext } from '../identity/staff-session.js';
import { findOrCreateStaffUser, loginOf } from './accounts.js';
import { SudoBillingService } from './sudo-billing.service.js';
import { SUBSCRIPTION_INCLUDE, lifecycleOf, paymentView, subscriptionView } from './views.js';

const OPEN = [...OPEN_SUBSCRIPTION_STATUSES];
const DAY_MS = 86_400_000;

/** Paid orders still being worked on: a shop with any of these can't be archived. */
const IN_FLIGHT: OrderStatus[] = [
  OrderStatus.PENDING_REVIEW,
  OrderStatus.QUEUED,
  OrderStatus.PRINTING,
  OrderStatus.NEEDS_OPERATOR_CHECK,
  OrderStatus.READY_FOR_PICKUP,
  OrderStatus.REFUND_PENDING,
];

const DEFAULT_AUTO_LIMITS = { maxPages: 50, maxCopies: 5, maxSides: 250, maxQueueDepth: 10 };

const ROW_INCLUDE = {
  members: {
    include: { user: { select: { name: true, email: true, phone: true } } },
    orderBy: { createdAt: 'asc' },
  },
  devices: { where: { status: 'ACTIVE' }, select: { lastHeartbeatAt: true } },
  _count: { select: { printers: true } },
  subscriptions: {
    where: { status: { in: OPEN } },
    include: SUBSCRIPTION_INCLUDE,
    take: 1,
  },
} satisfies Prisma.ShopInclude;

type ShopRow = Prisma.ShopGetPayload<{ include: typeof ROW_INCLUDE }>;

/**
 * Tenants as the platform owner sees them (/sudoadmin): one-step onboarding, suspension
 * (no new orders, hidden from customers; paid orders still print), archiving (offboarding:
 * devices revoked, staff access ends) and deletion (only for shops that never had an order).
 * Every change is audited in the same transaction.
 *
 * Error codes: SHOP_NOT_FOUND, SHOP_SLUG_TAKEN, SHOP_ARCHIVED, SHOP_NOT_ARCHIVED,
 * SHOP_HAS_ACTIVE_ORDERS, SHOP_HAS_ORDERS, CONFIRMATION_MISMATCH.
 */
@Injectable()
export class SudoShopsService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly billing: SudoBillingService,
  ) {}

  async list(): Promise<SudoShopRow[]> {
    await this.billing.settleEnded();
    const shops = await this.prisma.shop.findMany({
      include: ROW_INCLUDE,
      orderBy: [{ archivedAt: { sort: 'asc', nulls: 'first' } }, { name: 'asc' }],
    });
    const stats = await this.orderStats(shops.map((s) => s.id));
    const now = new Date();
    return shops.map((s) => this.row(s, stats.get(s.id), now));
  }

  async detail(shopId: string): Promise<SudoShopDetail> {
    await this.billing.settleEnded();
    const shop = await this.prisma.shop.findUnique({ where: { id: shopId }, include: ROW_INCLUDE });
    if (!shop) throw shopNotFound();
    const now = new Date();
    const [stats, ordersTotal, history, payments] = await Promise.all([
      this.orderStats([shopId]),
      this.prisma.order.count({ where: { shopId } }),
      this.prisma.shopSubscription.findMany({
        where: { shopId },
        include: SUBSCRIPTION_INCLUDE,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.subscriptionPayment.findMany({
        where: { shopId },
        orderBy: { paidAt: 'desc' },
        take: 100,
      }),
    ]);
    const recorders = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(payments.map((p) => p.recordedById))] } },
      select: { id: true, name: true },
    });
    const byId = new Map(recorders.map((u) => [u.id, u]));
    const memberUsers = await this.prisma.user.findMany({
      where: { id: { in: shop.members.map((m) => m.userId) } },
      select: { id: true, passwordHash: true },
    });
    const hasPassword = new Set(memberUsers.filter((u) => u.passwordHash).map((u) => u.id));

    return {
      ...this.row(shop, stats.get(shopId), now),
      suspendedAt: shop.suspendedAt?.toISOString() ?? null,
      archivedAt: shop.archivedAt?.toISOString() ?? null,
      updatedAt: shop.updatedAt.toISOString(),
      ordersTotal,
      canDelete: ordersTotal === 0,
      members: shop.members.map((m) => ({
        userId: m.userId,
        name: m.user.name,
        email: m.user.email,
        phone: m.user.phone,
        role: m.role,
        hasPassword: hasPassword.has(m.userId),
        joinedAt: m.createdAt.toISOString(),
      })),
      subscriptionHistory: history.map((h) => subscriptionView(h, now)),
      payments: payments.map((p) => paymentView(p, byId)),
    };
  }

  /** Shop (CLOSED until it has a device, printer and pricing) + owner + first subscription. */
  async onboard(staff: StaffContext, req: SudoShopCreateRequest): Promise<SudoShopCreated> {
    if (await this.prisma.shop.findUnique({ where: { slug: req.slug } })) {
      throw new AppError('SHOP_SLUG_TAKEN', 'A shop with this slug exists', HttpStatus.CONFLICT);
    }
    const result = await this.prisma.$transaction(
      async (tx) => {
        const shop = await tx.shop.create({
          data: {
            slug: req.slug,
            name: req.name,
            address: req.address,
            contactPhone: req.contactPhone ?? null,
            status: 'CLOSED',
            approvalMode: 'MANUAL',
            autoLimits: DEFAULT_AUTO_LIMITS,
            openingHours: normalizeHours({}),
            isDemo: req.isDemo ?? false,
          },
        });
        await auditStaffAction(tx, staff, 'shop.created', shop.id, {
          slug: shop.slug,
          name: shop.name,
          via: 'sudo',
        });

        let ownerTemporaryPassword: string | null = null;
        let ownerExistingUser = false;
        if (req.owner) {
          const account = await findOrCreateStaffUser(tx, req.owner);
          await tx.shopUser.create({
            data: { shopId: shop.id, userId: account.user.id, role: 'OWNER' },
          });
          await auditStaffAction(tx, staff, 'sudo.member.added', shop.id, {
            userId: account.user.id,
            role: 'OWNER',
            existingUser: account.existingUser,
          });
          ownerTemporaryPassword = account.temporaryPassword;
          ownerExistingUser = account.existingUser;
        }
        if (req.subscription) {
          await this.billing.createSubscriptionTx(tx, staff, shop.id, req.subscription);
        }
        return { shopId: shop.id, ownerTemporaryPassword, ownerExistingUser };
      },
      { timeout: 15_000 }, // Argon2 hashing runs inside the transaction.
    );
    return {
      shop: await this.detail(result.shopId),
      ownerTemporaryPassword: result.ownerTemporaryPassword,
      ownerExistingUser: result.ownerExistingUser,
    };
  }

  /** Stops new orders and hides the shop from customers. Paid orders still print. Idempotent. */
  async suspend(staff: StaffContext, shopId: string, reason: string): Promise<SudoShopDetail> {
    await this.prisma.$transaction(async (tx) => {
      const shop = await this.findShop(tx, shopId);
      if (shop.archivedAt) throw shopArchived();
      await tx.shop.update({
        where: { id: shopId },
        data: { suspendedAt: shop.suspendedAt ?? new Date(), suspendedReason: reason },
      });
      await auditStaffAction(tx, staff, 'sudo.shop.suspended', shopId, { reason });
    });
    return this.detail(shopId);
  }

  async reactivate(staff: StaffContext, shopId: string): Promise<SudoShopDetail> {
    await this.prisma.$transaction(async (tx) => {
      const shop = await this.findShop(tx, shopId);
      if (shop.archivedAt) throw shopArchived();
      if (!shop.suspendedAt) return;
      await tx.shop.update({
        where: { id: shopId },
        data: { suspendedAt: null, suspendedReason: null },
      });
      await auditStaffAction(tx, staff, 'sudo.shop.reactivated', shopId, {
        suspendedSince: shop.suspendedAt.toISOString(),
      });
    });
    return this.detail(shopId);
  }

  /**
   * Offboards a shop: suspended, devices revoked (operator sessions end), open subscription
   * cancelled, staff lose web access. Refused while paid orders are still in progress —
   * suspend first and let them finish (or refund them).
   */
  async archive(staff: StaffContext, shopId: string, reason: string): Promise<SudoShopDetail> {
    await this.prisma.$transaction(async (tx) => {
      const shop = await this.findShop(tx, shopId);
      if (shop.archivedAt) return;
      const inFlight = await tx.order.count({ where: { shopId, status: { in: IN_FLIGHT } } });
      if (inFlight > 0) {
        throw new AppError(
          'SHOP_HAS_ACTIVE_ORDERS',
          `${inFlight} paid order(s) are still in progress. Suspend the shop, let them finish or refund them, then archive.`,
          HttpStatus.CONFLICT,
          { inFlight },
        );
      }
      const now = new Date();
      await tx.shop.update({
        where: { id: shopId },
        data: {
          archivedAt: now,
          suspendedAt: shop.suspendedAt ?? now,
          suspendedReason: reason,
          status: 'CLOSED',
        },
      });
      const devices = await tx.shopDevice.updateMany({
        where: { shopId, status: 'ACTIVE' },
        data: { status: 'REVOKED', revokedAt: now },
      });
      const sessions = await tx.operatorSession.updateMany({
        where: { shopId, revokedAt: null },
        data: { revokedAt: now },
      });
      const subs = await tx.shopSubscription.updateMany({
        where: { shopId, status: { in: OPEN } },
        data: { status: 'CANCELLED', cancelledAt: now, cancelAtPeriodEnd: false },
      });
      await auditStaffAction(tx, staff, 'sudo.shop.archived', shopId, {
        reason,
        devicesRevoked: devices.count,
        operatorSessionsEnded: sessions.count,
        subscriptionsCancelled: subs.count,
      });
    });
    return this.detail(shopId);
  }

  /** Back to SUSPENDED (reactivate explicitly). Revoked devices must be paired again. */
  async restore(staff: StaffContext, shopId: string): Promise<SudoShopDetail> {
    await this.prisma.$transaction(async (tx) => {
      const shop = await this.findShop(tx, shopId);
      if (!shop.archivedAt) {
        throw new AppError('SHOP_NOT_ARCHIVED', 'This shop is not archived', HttpStatus.CONFLICT);
      }
      await tx.shop.update({ where: { id: shopId }, data: { archivedAt: null } });
      await auditStaffAction(tx, staff, 'sudo.shop.restored', shopId, {
        archivedSince: shop.archivedAt.toISOString(),
      });
    });
    return this.detail(shopId);
  }

  /**
   * Permanently removes a shop created by mistake. Only allowed when it never had an order
   * (orders, payments and print history are never deleted). Audit rows are kept.
   */
  async remove(staff: StaffContext, shopId: string, confirmSlug: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const shop = await this.findShop(tx, shopId);
      if (confirmSlug !== shop.slug) {
        throw new AppError(
          'CONFIRMATION_MISMATCH',
          'Type the shop’s slug exactly to delete it',
          HttpStatus.BAD_REQUEST,
        );
      }
      const orders = await tx.order.count({ where: { shopId } });
      if (orders > 0) {
        throw new AppError(
          'SHOP_HAS_ORDERS',
          'This shop has order history and can’t be deleted. Archive it instead.',
          HttpStatus.CONFLICT,
          { orders },
        );
      }
      await tx.subscriptionPayment.deleteMany({ where: { shopId } });
      await tx.shopSubscription.deleteMany({ where: { shopId } });
      await tx.operatorSession.deleteMany({ where: { shopId } });
      await tx.printerUptimeDaily.deleteMany({ where: { shopId } });
      await tx.printer.deleteMany({ where: { shopId } });
      await tx.enrollmentCode.deleteMany({ where: { shopId } });
      await tx.shopDevice.deleteMany({ where: { shopId } });
      await tx.shopPricing.deleteMany({ where: { shopId } });
      await tx.pickupCounter.deleteMany({ where: { shopId } });
      const members = await tx.shopUser.deleteMany({ where: { shopId } });
      await tx.shop.delete({ where: { id: shopId } });
      await auditStaffAction(tx, staff, 'sudo.shop.deleted', shopId, {
        slug: shop.slug,
        name: shop.name,
        membersRemoved: members.count,
      });
    });
  }

  private async findShop(tx: Prisma.TransactionClient, shopId: string) {
    const shop = await tx.shop.findUnique({ where: { id: shopId } });
    if (!shop) throw shopNotFound();
    return shop;
  }

  private row(
    s: ShopRow,
    stats: { orders: number; gmv: number } | undefined,
    now: Date,
  ): SudoShopRow {
    const thresholdMs = (this.config.DEVICE_ONLINE_THRESHOLD_SECONDS ?? 45) * 1000;
    const sub = s.subscriptions[0];
    return {
      id: s.id,
      slug: s.slug,
      name: s.name,
      address: s.address,
      contactPhone: s.contactPhone,
      status: s.status,
      lifecycle: lifecycleOf(s),
      isDemo: s.isDemo,
      suspendedReason: s.suspendedReason,
      createdAt: s.createdAt.toISOString(),
      owners: s.members
        .filter((m) => m.role === 'OWNER')
        .map((m) => ({ name: m.user.name, login: loginOf(m.user) })),
      memberCount: s.members.length,
      devicesOnline: s.devices.filter(
        (d) => d.lastHeartbeatAt && now.getTime() - d.lastHeartbeatAt.getTime() <= thresholdMs,
      ).length,
      devicesTotal: s.devices.length,
      printers: s._count.printers,
      orders30d: stats?.orders ?? 0,
      gmv30dPaise: stats?.gmv ?? 0,
      subscription: sub ? subscriptionView(sub, now) : null,
    };
  }

  /** Paid orders in the last 30 days per shop. */
  private async orderStats(shopIds: string[]) {
    const rows = await this.prisma.order.groupBy({
      by: ['shopId'],
      where: { shopId: { in: shopIds }, paidAt: { gte: new Date(Date.now() - 30 * DAY_MS) } },
      _count: { id: true },
      _sum: { amountPaise: true },
    });
    return new Map(
      rows.map((r) => [r.shopId, { orders: r._count.id, gmv: r._sum.amountPaise ?? 0 }]),
    );
  }
}

export function shopNotFound(): AppError {
  return new AppError('SHOP_NOT_FOUND', 'Shop not found', HttpStatus.NOT_FOUND);
}
function shopArchived(): AppError {
  return new AppError(
    'SHOP_ARCHIVED',
    'This shop is archived. Restore it first.',
    HttpStatus.CONFLICT,
  );
}
