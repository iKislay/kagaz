import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { type Request } from 'express';
import { APP_CONFIG } from '../config/config.module.js';
import { type AppConfig } from '../config/config.schema.js';
import { AppError } from '../http/api-exception.filter.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { type DeviceContext } from './device-auth.guard.js';

export const AGENT_VERSION_HEADER = 'x-agent-version';

/**
 * Compares dotted numeric versions ("0.10.2" > "0.9"). Pre-release / build suffixes
 * ("1.2.0-beta+5") are ignored; non-numeric parts count as 0. Returns -1, 0 or 1.
 */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) =>
    v
      .trim()
      .replace(/^v/i, '')
      .split(/[-+]/)[0]!
      .split('.')
      .map((p) => (/^\d+$/.test(p) ? Number(p) : 0));
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** True when the agent must upgrade before using shop endpoints. Unknown version → false. */
export function isUpgradeRequired(appVersion: string | null | undefined, min?: string): boolean {
  return Boolean(min && appVersion && compareVersions(appVersion, min) < 0);
}

/**
 * Contract §1 / P4.4: shop endpoints refuse agents older than MIN_AGENT_VERSION with
 * `426 AGENT_UPGRADE_REQUIRED`. The version comes from the `X-Agent-Version` header, else the
 * last version the device reported in a heartbeat. Must run after DeviceAuthGuard.
 * The heartbeat itself is not guarded (it answers `upgradeRequired: true` instead).
 */
@Injectable()
export class AgentVersionGuard implements CanActivate {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const min = this.config.MIN_AGENT_VERSION;
    if (!min) return true;
    const req = context.switchToHttp().getRequest<Request & { device?: DeviceContext }>();
    const header = req.headers[AGENT_VERSION_HEADER];
    let version = typeof header === 'string' && header.length <= 40 ? header : null;
    if (!version && req.device) {
      const device = await this.prisma.shopDevice.findUnique({
        where: { id: req.device.deviceId, shopId: req.device.shopId },
        select: { appVersion: true },
      });
      version = device?.appVersion ?? null;
    }
    if (isUpgradeRequired(version, min)) {
      throw new AppError(
        'AGENT_UPGRADE_REQUIRED',
        `This Kagaz shop app (${version}) is too old; please update to ${min} or later`,
        426 as HttpStatus, // 426 Upgrade Required is missing from Nest's HttpStatus enum
        { minAgentVersion: min, appVersion: version },
      );
    }
    return true;
  }
}
