import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { type DeviceHealth } from '@kagaz/shared';
import { isUpgradeRequired } from '../../common/auth/agent-version.guard.js';
import { APP_CONFIG } from '../../common/config/config.module.js';
import { type AppConfig } from '../../common/config/config.schema.js';
import { DomainEvent, DomainEventBus } from '../../common/events/domain-events.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';

/** A device is STALE (not yet OFFLINE) for up to this many online-thresholds. */
const STALE_FACTOR = 4;
const OFFLINE_CHECK_MS = 15_000;

export type Connectivity = DeviceHealth['connectivity'];

/**
 * Read model for device + printer health (P4.4). `online` = last heartbeat within
 * DEVICE_ONLINE_THRESHOLD_SECONDS (45 s); STALE up to 4× that; OFFLINE beyond / never.
 * Used by the admin dashboard and auto-accept (isShopOnline). Also emits
 * `device.status_changed {online:false}` when a device stops heart-beating.
 */
@Injectable()
export class DeviceHealthService {
  private readonly logger = new Logger(DeviceHealthService.name);
  private lastOfflineCheck = new Date();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly events: DomainEventBus,
  ) {}

  connectivity(lastHeartbeatAt: Date | null, now = new Date()): Connectivity {
    if (!lastHeartbeatAt) return 'OFFLINE';
    const age = now.getTime() - lastHeartbeatAt.getTime();
    const threshold = this.config.DEVICE_ONLINE_THRESHOLD_SECONDS * 1000;
    if (age <= threshold) return 'ONLINE';
    return age <= threshold * STALE_FACTOR ? 'STALE' : 'OFFLINE';
  }

  isOnline(lastHeartbeatAt: Date | null, now = new Date()): boolean {
    return this.connectivity(lastHeartbeatAt, now) === 'ONLINE';
  }

  /** True if any active device of the shop is online (auto-accept precondition). */
  async isShopOnline(shopId: string, now = new Date()): Promise<boolean> {
    const since = new Date(now.getTime() - this.config.DEVICE_ONLINE_THRESHOLD_SECONDS * 1000);
    const count = await this.prisma.shopDevice.count({
      where: { shopId, status: 'ACTIVE', lastHeartbeatAt: { gte: since } },
    });
    return count > 0;
  }

  /** Health of every device (optionally of one shop), newest heartbeat first. */
  async list(shopId?: string, now = new Date()): Promise<DeviceHealth[]> {
    const devices = await this.prisma.shopDevice.findMany({
      where: shopId ? { shopId } : {},
      include: { printers: { orderBy: { displayName: 'asc' } } },
      orderBy: [{ lastHeartbeatAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'asc' }],
    });
    const printerIds = devices.flatMap((d) => d.printers.map((p) => p.id));
    const depths = printerIds.length
      ? await this.prisma.printJob.groupBy({
          by: ['printerId'],
          where: {
            printerId: { in: printerIds },
            status: { in: ['READY', 'LEASED', 'SUBMITTED'] },
          },
          _count: { _all: true },
        })
      : [];
    const depthOf = new Map(depths.map((d) => [d.printerId, d._count._all]));
    const min = this.config.MIN_AGENT_VERSION;

    return devices.map((d) => {
      const connectivity = this.connectivity(d.lastHeartbeatAt, now);
      return {
        deviceId: d.id,
        shopId: d.shopId,
        name: d.name,
        status: d.status,
        connectivity,
        online: connectivity === 'ONLINE' && d.status === 'ACTIVE',
        lastHeartbeatAt: d.lastHeartbeatAt?.toISOString() ?? null,
        appVersion: d.appVersion,
        upgradeRequired: isUpgradeRequired(d.appVersion, min),
        os: d.os,
        uptimeSeconds: d.uptimeSeconds,
        queueDepth: d.queueDepth,
        printers: d.printers.map((p) => ({
          printerId: p.id,
          displayName: p.displayName,
          status: p.status,
          lastError: p.lastError,
          lastStatusAt: p.lastStatusAt?.toISOString() ?? null,
          queueDepth: depthOf.get(p.id) ?? 0,
        })),
      };
    });
  }

  /** Emits `device.status_changed {online:false}` for devices whose heartbeat just lapsed. */
  async detectOffline(now = new Date()): Promise<number> {
    const threshold = this.config.DEVICE_ONLINE_THRESHOLD_SECONDS * 1000;
    const from = new Date(this.lastOfflineCheck.getTime() - threshold);
    const to = new Date(now.getTime() - threshold);
    this.lastOfflineCheck = now;
    if (to <= from) return 0;
    const lapsed = await this.prisma.shopDevice.findMany({
      where: { status: 'ACTIVE', lastHeartbeatAt: { gt: from, lte: to } },
      select: { id: true, shopId: true },
    });
    for (const d of lapsed) {
      this.events.publish(this.prisma, DomainEvent.DEVICE_STATUS_CHANGED, {
        deviceId: d.id,
        shopId: d.shopId,
        online: false,
        at: now.toISOString(),
      });
    }
    return lapsed.length;
  }

  @Interval('device-offline-detector', OFFLINE_CHECK_MS)
  async onOfflineTick(): Promise<void> {
    try {
      await this.detectOffline();
    } catch (err) {
      this.logger.error({ err }, 'device offline detection failed');
    }
  }
}
