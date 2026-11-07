import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { type AdminHealth, istDateKey } from '@kagaz/shared';
import { APP_CONFIG } from '../../common/config/config.module.js';
import { type AppConfig } from '../../common/config/config.schema.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { STALE_THRESHOLD_SECONDS, deviceHealth } from './devices-admin.service.js';
import { printerQueueDepths } from './printers-admin.service.js';

/** Compare dotted numeric versions ("0.10.0" > "0.9.3"); non-numeric parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/).map((x) => Number.parseInt(x, 10) || 0);
  const pb = b.split(/[.+-]/).map((x) => Number.parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** Drift = no reported version, or one below MIN_AGENT_VERSION. */
export function hasVersionDrift(appVersion: string | null, min: string | undefined): boolean {
  if (!min) return false;
  return !appVersion || compareVersions(appVersion, min) < 0;
}

/**
 * Heartbeat extras (`os`, `uptimeSeconds`, `queueDepth`) are stored by the API-core heartbeat
 * (contract §1). Read them defensively from the full row so this view works before and after
 * those columns exist.
 */
function extra<T extends 'string' | 'number'>(
  row: object,
  key: string,
  type: T,
): (T extends 'string' ? string : number) | null {
  const value = (row as Record<string, unknown>)[key];
  return typeof value === type ? (value as T extends 'string' ? string : number) : null;
}

/** Device + printer health for admins (P4.4, FR-ADMIN-02). */
@Injectable()
export class HealthService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  async health(): Promise<AdminHealth> {
    const now = new Date();
    const online = this.config.DEVICE_ONLINE_THRESHOLD_SECONDS;
    const min = this.config.MIN_AGENT_VERSION;
    const shops = await this.prisma.shop.findMany({
      orderBy: { name: 'asc' },
      include: {
        devices: { where: { status: 'ACTIVE' }, orderBy: { createdAt: 'asc' } },
        printers: { orderBy: [{ isDefault: 'desc' }, { displayName: 'asc' }] },
      },
    });
    const depth = await printerQueueDepths(
      this.prisma,
      shops.flatMap((s) => s.printers.map((p) => p.id)),
    );

    return {
      generatedAt: now.toISOString(),
      onlineThresholdSeconds: online,
      staleThresholdSeconds: Math.max(STALE_THRESHOLD_SECONDS, online),
      minAgentVersion: min ?? null,
      shops: shops.map((shop) => {
        const devices = shop.devices.map((d) => {
          const uptime = extra(d, 'uptimeSeconds', 'number');
          const queue = extra(d, 'queueDepth', 'number');
          return {
            id: d.id,
            name: d.name,
            health: deviceHealth(d, online, now),
            appVersion: d.appVersion,
            versionDrift: hasVersionDrift(d.appVersion, min),
            os: extra(d, 'os', 'string'),
            uptimeSeconds: uptime === null ? null : Math.round(uptime),
            queueDepth: queue === null ? null : Math.round(queue),
            lastHeartbeatAt: d.lastHeartbeatAt?.toISOString() ?? null,
            secondsSinceHeartbeat: d.lastHeartbeatAt
              ? Math.max(0, Math.round((now.getTime() - d.lastHeartbeatAt.getTime()) / 1000))
              : null,
          };
        });
        return {
          shopId: shop.id,
          shopName: shop.name,
          status: shop.status,
          approvalMode: shop.approvalMode,
          autoPaused: shop.autoPaused,
          online: devices.some((d) => d.health === 'ONLINE'),
          devices,
          printers: shop.printers.map((p) => ({
            id: p.id,
            displayName: p.displayName,
            printerName: p.printerName,
            status: p.status,
            enabled: p.enabled,
            isDefault: p.isDefault,
            lastStatusAt: p.lastStatusAt?.toISOString() ?? null,
            lastError: p.lastError,
            queueDepth: depth.get(p.id) ?? 0,
          })),
        };
      }),
    };
  }
}

/**
 * Approximate printer uptime for the overview (P4.8). Once a minute every enabled printer is
 * observed; it counts as "up" when its status is READY and its device (or, for a printer not
 * mapped to a device, any active device of the shop) is ONLINE. Only counters are stored.
 */
@Injectable()
export class PrinterUptimeSampler implements OnApplicationBootstrap, OnModuleDestroy {
  static readonly INTERVAL_MS = 60_000;
  private readonly logger = new Logger(PrinterUptimeSampler.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      this.sampleOnce().catch((err: unknown) =>
        this.logger.warn({ err }, 'Printer uptime sample failed'),
      );
    }, PrinterUptimeSampler.INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** One observation of every enabled printer; returns how many printers were sampled. */
  async sampleOnce(now = new Date()): Promise<number> {
    const online = this.config.DEVICE_ONLINE_THRESHOLD_SECONDS;
    const printers = await this.prisma.printer.findMany({
      where: { enabled: true },
      select: {
        id: true,
        shopId: true,
        deviceId: true,
        status: true,
        shop: {
          select: { devices: { select: { id: true, status: true, lastHeartbeatAt: true } } },
        },
      },
    });
    const day = new Date(`${istDateKey(now)}T00:00:00.000Z`);
    for (const p of printers) {
      const devices = p.shop.devices.filter((d) => !p.deviceId || d.id === p.deviceId);
      const up =
        p.status === 'READY' && devices.some((d) => deviceHealth(d, online, now) === 'ONLINE');
      await this.prisma.printerUptimeDaily.upsert({
        where: { printerId_day: { printerId: p.id, day } },
        create: {
          printerId: p.id,
          shopId: p.shopId,
          day,
          observedSamples: 1,
          upSamples: up ? 1 : 0,
        },
        update: { observedSamples: { increment: 1 }, upSamples: { increment: up ? 1 : 0 } },
      });
    }
    return printers.length;
  }
}
