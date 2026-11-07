import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  type AdminDeviceDetail,
  type AdminDeviceUpdateRequest,
  type AdminEnrollmentCode,
  type AdminEnrollmentCodeCreated,
  type AdminDeviceHealth,
} from '@kagaz/shared';
import { APP_CONFIG } from '../../common/config/config.module.js';
import { type AppConfig } from '../../common/config/config.schema.js';
import { formatCode, randomCode, sha256Hex } from '../../common/crypto/tokens.js';
import { AppError } from '../../common/http/api-exception.filter.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { displayName } from '../identity/operator-session.service.js';
import { type StaffContext } from '../identity/staff-session.js';
import { auditStaffAction } from './admin-audit.js';
import { shopNotFound } from './shop-settings.service.js';

export const ENROLLMENT_CODE_TTL_MINUTES = 30;
/** A device is STALE (not OFFLINE) for this long after it stops being ONLINE. */
export const STALE_THRESHOLD_SECONDS = 300;

export function deviceHealth(
  device: { status: string; lastHeartbeatAt: Date | null },
  onlineThresholdSeconds: number,
  now = new Date(),
): AdminDeviceHealth {
  if (device.status !== 'ACTIVE') return 'REVOKED';
  if (!device.lastHeartbeatAt) return 'OFFLINE';
  const age = (now.getTime() - device.lastHeartbeatAt.getTime()) / 1000;
  if (age <= onlineThresholdSeconds) return 'ONLINE';
  return age <= Math.max(STALE_THRESHOLD_SECONDS, onlineThresholdSeconds) ? 'STALE' : 'OFFLINE';
}

/**
 * Device enrollment + revocation (P2.4, FR-ADMIN-04). Codes are single-use, expire after
 * 30 minutes and are stored only as a hash; the plaintext is returned once to the admin.
 */
@Injectable()
export class DevicesAdminService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  async list(shopId: string): Promise<AdminDeviceDetail[]> {
    await this.assertShop(shopId);
    const now = new Date();
    const devices = await this.prisma.shopDevice.findMany({
      where: { shopId },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });
    const sessions = await this.prisma.operatorSession.findMany({
      where: {
        deviceId: { in: devices.map((d) => d.id) },
        revokedAt: null,
        expiresAt: { gt: now },
      },
      orderBy: { createdAt: 'desc' },
    });
    const users = await this.prisma.user.findMany({
      where: { id: { in: sessions.map((s) => s.userId) } },
      select: { id: true, name: true, email: true, phone: true },
    });
    const userById = new Map(users.map((u) => [u.id, u]));

    return devices.map((d) => {
      const session = d.status === 'ACTIVE' ? sessions.find((s) => s.deviceId === d.id) : null;
      const user = session ? userById.get(session.userId) : undefined;
      return {
        id: d.id,
        name: d.name,
        status: d.status,
        health: deviceHealth(d, this.config.DEVICE_ONLINE_THRESHOLD_SECONDS, now),
        appVersion: d.appVersion,
        lastHeartbeatAt: d.lastHeartbeatAt?.toISOString() ?? null,
        createdAt: d.createdAt.toISOString(),
        revokedAt: d.revokedAt?.toISOString() ?? null,
        activeOperator: user ? { id: user.id, name: displayName(user) } : null,
      };
    });
  }

  /** Revoke (token dead at once, operator sessions ended) and/or rename. Idempotent. */
  async update(
    staff: StaffContext,
    shopId: string,
    deviceId: string,
    req: AdminDeviceUpdateRequest,
  ): Promise<AdminDeviceDetail> {
    await this.prisma.$transaction(async (tx) => {
      const device = await tx.shopDevice.findFirst({ where: { id: deviceId, shopId } });
      if (!device) {
        throw new AppError('DEVICE_NOT_FOUND', 'Device not found', HttpStatus.NOT_FOUND);
      }
      if (req.name && req.name !== device.name) {
        await tx.shopDevice.update({ where: { id: device.id }, data: { name: req.name } });
        await auditStaffAction(tx, staff, 'device.renamed', shopId, {
          deviceId,
          from: device.name,
          to: req.name,
        });
      }
      if (req.status === 'REVOKED' && device.status === 'ACTIVE') {
        const revokedAt = new Date();
        await tx.shopDevice.updateMany({
          where: { id: device.id, status: 'ACTIVE' },
          data: { status: 'REVOKED', revokedAt },
        });
        const sessions = await tx.operatorSession.updateMany({
          where: { deviceId: device.id, revokedAt: null },
          data: { revokedAt },
        });
        await auditStaffAction(tx, staff, 'device.revoked', shopId, {
          deviceId,
          name: device.name,
          operatorSessionsEnded: sessions.count,
        });
      }
    });
    // Realtime `device.revoked` hint is the realtime workstream's (contract §5); the agent
    // also learns it from the next 401 DEVICE_REVOKED.
    const devices = await this.list(shopId);
    return devices.find((d) => d.id === deviceId)!;
  }

  async listCodes(shopId: string): Promise<AdminEnrollmentCode[]> {
    await this.assertShop(shopId);
    const now = new Date();
    const codes = await this.prisma.enrollmentCode.findMany({
      where: { shopId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return codes.map((c) => ({
      id: c.id,
      state: c.usedAt ? 'USED' : c.expiresAt <= now ? 'EXPIRED' : 'ACTIVE',
      createdAt: c.createdAt.toISOString(),
      expiresAt: c.expiresAt.toISOString(),
      usedAt: c.usedAt?.toISOString() ?? null,
      usedByDeviceId: c.usedByDeviceId,
    }));
  }

  async createCode(staff: StaffContext, shopId: string): Promise<AdminEnrollmentCodeCreated> {
    await this.assertShop(shopId);
    const code = randomCode(8);
    const expiresAt = new Date(Date.now() + ENROLLMENT_CODE_TTL_MINUTES * 60_000);
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.enrollmentCode.create({
        data: { shopId, codeHash: sha256Hex(code), expiresAt, createdById: staff.userId },
      });
      // Never the code itself: only its id and expiry.
      await auditStaffAction(tx, staff, 'enrollment_code.created', shopId, {
        codeId: created.id,
        expiresAt: expiresAt.toISOString(),
      });
      return created;
    });
    return { id: row.id, code: formatCode(code), expiresAt: expiresAt.toISOString() };
  }

  private async assertShop(shopId: string) {
    const shop = await this.prisma.shop.findUnique({ where: { id: shopId }, select: { id: true } });
    if (!shop) throw shopNotFound();
  }
}
