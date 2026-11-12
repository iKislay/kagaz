import { Injectable, Inject } from '@nestjs/common';
import { APP_CONFIG } from '../../common/config/config.module.js';
import { type AppConfig } from '../../common/config/config.schema.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { istDayBounds, OrderStatus } from '@kagaz/shared';

const TERMINAL = [OrderStatus.COLLECTED, OrderStatus.CANCELLED, OrderStatus.REFUNDED];

@Injectable()
export class ShopsService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  /** All shops, or only `onlyShopIds` (shop owners see just their own shops). */
  async listAdminShops(onlyShopIds?: string[]) {
    const now = new Date();
    const thresholdMs = (this.config.DEVICE_ONLINE_THRESHOLD_SECONDS ?? 45) * 1000;

    const shops = await this.prisma.shop.findMany({
      where: onlyShopIds ? { id: { in: onlyShopIds } } : {},
      orderBy: { name: 'asc' },
      include: {
        pricing: {
          where: { effectiveFrom: { lte: now } },
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
        },
        devices: { where: { status: 'ACTIVE' }, orderBy: { createdAt: 'asc' } },
        printers: {
          include: {
            printJobs: {
              where: { status: { notIn: ['SUPERSEDED', 'CANCELLED'] as const } },
              orderBy: { createdAt: 'desc' },
              take: 1,
              include: { order: { select: { publicRef: true } } },
            },
          },
        },
      },
    });

    const orderCounts = await this.orderCountsByShop();
    const todayStats = await this.todayStats();

    return shops.map((shop) => {
      const pricing = shop.pricing[0] ?? null;
      const devices = shop.devices.map((d) => ({
        id: d.id,
        name: d.name,
        appVersion: d.appVersion ?? null,
        online: !!d.lastHeartbeatAt && Date.now() - d.lastHeartbeatAt.getTime() <= thresholdMs,
        lastHeartbeatAt: d.lastHeartbeatAt?.toISOString() ?? null,
      }));
      const printers = shop.printers.map((p) => {
        const active = p.printJobs[0];
        return {
          id: p.id,
          printerName: p.printerName,
          displayName: p.displayName,
          status: p.status,
          colourCapable: p.colourCapable,
          duplexCapable: p.duplexCapable,
          enabled: p.enabled,
          activeJob: active
            ? {
                orderId: active.orderId,
                publicRef: active.order!.publicRef,
                attempt: active.attempt,
                status: active.status,
              }
            : null,
        };
      });
      const counts = orderCounts.get(shop.id) ?? {};
      const today = todayStats.get(shop.id) ?? { orders: 0, revenue: 0, simulated: 0 };

      return {
        id: shop.id,
        slug: shop.slug,
        name: shop.name,
        address: shop.address,
        createdAt: shop.createdAt.toISOString(),
        status: shop.status,
        approvalMode: shop.approvalMode,
        autoPaused: shop.autoPaused,
        isDemo: shop.isDemo,
        pricing: pricing
          ? {
              monoRatePaise: pricing.monoRatePaise,
              colourRatePaise: pricing.colourRatePaise,
              monoDuplexRatePaise: pricing.monoDuplexRatePaise,
              colourDuplexRatePaise: pricing.colourDuplexRatePaise,
              duplexRule: pricing.duplexRule,
              minimumChargePaise: pricing.minimumChargePaise,
            }
          : null,
        devices,
        printers,
        orderCounts: counts,
        todayOrders: today.orders,
        todayRevenuePaise: today.revenue,
        todaySimulatedRevenuePaise: today.simulated,
      };
    });
  }

  private async orderCountsByShop() {
    const rows = await this.prisma.order.groupBy({
      by: ['shopId', 'status'],
      where: { status: { notIn: TERMINAL } },
      _count: { id: true },
    });
    const map = new Map<string, Record<string, number>>();
    for (const row of rows) {
      const byStatus = map.get(row.shopId) ?? {};
      byStatus[row.status] = row._count.id;
      map.set(row.shopId, byStatus);
    }
    return map;
  }

  private async todayStats() {
    const { start, end } = istDayBounds();
    const orders = await this.prisma.order.findMany({
      where: { createdAt: { gte: start, lte: end } },
      include: {
        payments: { where: { status: 'PAID' }, select: { id: true, isSimulated: true } },
      },
    });
    const map = new Map<string, { orders: number; revenue: number; simulated: number }>();
    for (const order of orders) {
      const cur = map.get(order.shopId) ?? { orders: 0, revenue: 0, simulated: 0 };
      cur.orders += 1;
      const paid = order.payments.length > 0;
      if (paid && typeof order.amountPaise === 'number') {
        cur.revenue += order.amountPaise;
        if (order.payments.some((p) => p.isSimulated)) cur.simulated += order.amountPaise;
      }
      map.set(order.shopId, cur);
    }
    return map;
  }
}
