import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  type EnrollDeviceRequest,
  type EnrollDeviceResponse,
  type HeartbeatRequest,
  type HeartbeatResponse,
} from '@kagaz/shared';
import { isUpgradeRequired } from '../../common/auth/agent-version.guard.js';
import { type DeviceContext } from '../../common/auth/device-auth.guard.js';
import { APP_CONFIG } from '../../common/config/config.module.js';
import { type AppConfig } from '../../common/config/config.schema.js';
import { generateToken, normalizeCode, sha256Hex } from '../../common/crypto/tokens.js';
import { DomainEvent, DomainEventBus } from '../../common/events/domain-events.js';
import { AppError } from '../../common/http/api-exception.filter.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { PrintLeaseService } from '../printing/print-leases.service.js';
import { DeviceHealthService } from './device-health.service.js';

@Injectable()
export class DevicesService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly leases: PrintLeaseService,
    private readonly health: DeviceHealthService,
    private readonly events: DomainEventBus,
  ) {}

  /** Exchange a one-time enrollment code for a device token (FR-SHOP-01). */
  async enroll(req: EnrollDeviceRequest): Promise<EnrollDeviceResponse> {
    const codeHash = sha256Hex(normalizeCode(req.code));
    const token = generateToken();

    return this.prisma.$transaction(async (tx) => {
      const code = await tx.enrollmentCode.findUnique({
        where: { codeHash },
        include: { shop: { select: { id: true, name: true, isDemo: true } } },
      });
      if (!code || code.usedAt || code.expiresAt < new Date()) {
        throw new AppError(
          'ENROLLMENT_CODE_INVALID',
          'This pairing code is invalid, expired or already used',
          HttpStatus.BAD_REQUEST,
        );
      }
      const device = await tx.shopDevice.create({
        data: {
          shopId: code.shopId,
          name: req.name,
          tokenHash: sha256Hex(token),
          appVersion: req.appVersion ?? null,
          lastHeartbeatAt: new Date(),
        },
      });
      // Single use, even under concurrent enrollment attempts.
      const used = await tx.enrollmentCode.updateMany({
        where: { id: code.id, usedAt: null },
        data: { usedAt: new Date(), usedByDeviceId: device.id },
      });
      if (used.count !== 1) {
        throw new AppError('ENROLLMENT_CODE_INVALID', 'This pairing code was already used', 400);
      }
      await this.audit.record(tx, { type: 'DEVICE', id: device.id }, 'device.enrolled', {
        shopId: code.shopId,
        metadata: { name: req.name, appVersion: req.appVersion ?? null },
      });
      return {
        deviceToken: token,
        device: { id: device.id, name: device.name },
        shop: code.shop,
      };
    });
  }

  /**
   * Heartbeat (contract §1, P4.4, every 15 s): records liveness + health, printer status,
   * renews the leases of `activePrintJobIds`, and tells the agent the lease TTL, the
   * minimum agent version and the shop's mode.
   */
  async heartbeat(device: DeviceContext, req: HeartbeatRequest): Promise<HeartbeatResponse> {
    const now = new Date();
    const at = now.toISOString();
    const result = await this.prisma.$transaction(async (tx) => {
      const before = await tx.shopDevice.findUniqueOrThrow({
        where: { id: device.deviceId, shopId: device.shopId },
        select: { lastHeartbeatAt: true },
      });
      const updated = await tx.shopDevice.update({
        where: { id: device.deviceId, shopId: device.shopId },
        data: {
          lastHeartbeatAt: now,
          ...(req.appVersion ? { appVersion: req.appVersion } : {}),
          ...(req.os === undefined ? {} : { os: req.os }),
          ...(req.uptimeSeconds === undefined ? {} : { uptimeSeconds: req.uptimeSeconds }),
          ...(req.queueDepth === undefined ? {} : { queueDepth: req.queueDepth }),
        },
        select: {
          appVersion: true,
          shop: { select: { status: true, approvalMode: true, autoPaused: true } },
        },
      });
      if (!this.health.isOnline(before.lastHeartbeatAt, now)) {
        this.events.publish(tx, DomainEvent.DEVICE_STATUS_CHANGED, {
          deviceId: device.deviceId,
          shopId: device.shopId,
          online: true,
          at,
        });
      }

      for (const p of req.printers ?? []) {
        // Scoped to this shop: a device can't touch another shop's printers.
        const printer = await tx.printer.findFirst({
          where: { id: p.printerId, shopId: device.shopId },
          select: { id: true, status: true, lastError: true },
        });
        if (!printer) continue;
        const lastError = p.lastError ?? null;
        await tx.printer.update({
          where: { id: printer.id, shopId: device.shopId },
          data: { status: p.status, lastStatusAt: now, lastError },
        });
        if (printer.status !== p.status || printer.lastError !== lastError) {
          this.events.publish(tx, DomainEvent.PRINTER_STATUS_CHANGED, {
            printerId: printer.id,
            shopId: device.shopId,
            status: p.status,
            lastError,
            at,
          });
        }
      }

      await this.leases.renew(tx, device, req.activePrintJobIds ?? [], this.leases.leaseUntil(now));
      return updated;
    });

    const min = this.config.MIN_AGENT_VERSION ?? null;
    return {
      serverTime: at,
      leaseTtlSeconds: this.config.PRINTER_LEASE_TTL_SECONDS,
      minAgentVersion: min,
      upgradeRequired: isUpgradeRequired(result.appVersion, min ?? undefined),
      shop: result.shop,
    };
  }

  /** Swap the token hash in one conditional update; the old token is dead on commit. */
  async rotateToken(device: DeviceContext): Promise<{ deviceToken: string }> {
    const token = generateToken();
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.shopDevice.updateMany({
        where: { id: device.deviceId, shopId: device.shopId, status: 'ACTIVE' },
        data: { tokenHash: sha256Hex(token) },
      });
      if (updated.count !== 1) {
        throw new AppError('DEVICE_REVOKED', 'This device was revoked', HttpStatus.UNAUTHORIZED);
      }
      await tx.auditLog.create({
        data: {
          actorType: 'DEVICE',
          actorId: device.deviceId,
          shopId: device.shopId,
          action: 'device.token_rotated',
          metadata: { deviceId: device.deviceId },
        },
      });
    });
    return { deviceToken: token };
  }
}
