import { HttpStatus, Injectable } from '@nestjs/common';
import {
  type EnrollDeviceRequest,
  type EnrollDeviceResponse,
  type HeartbeatRequest,
} from '@kagaz/shared';
import { type DeviceContext } from '../../common/auth/device-auth.guard.js';
import { generateToken, normalizeCode, sha256Hex } from '../../common/crypto/tokens.js';
import { AppError } from '../../common/http/api-exception.filter.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';

@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService) {}

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
      await tx.auditLog.create({
        data: {
          actorType: 'DEVICE',
          actorId: device.id,
          shopId: code.shopId,
          action: 'device.enrolled',
          metadata: { name: req.name, appVersion: req.appVersion ?? null },
        },
      });
      return {
        deviceToken: token,
        device: { id: device.id, name: device.name },
        shop: code.shop,
      };
    });
  }

  /** Records liveness, app version and printer health (full health views in P4.4). */
  async heartbeat(device: DeviceContext, req: HeartbeatRequest): Promise<{ serverTime: string }> {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.shopDevice.update({
        where: { id: device.deviceId },
        data: {
          lastHeartbeatAt: now,
          ...(req.appVersion ? { appVersion: req.appVersion } : {}),
        },
      });
      for (const p of req.printers ?? []) {
        // Scoped to this shop: a device can't touch another shop's printers.
        await tx.printer.updateMany({
          where: { id: p.printerId, shopId: device.shopId },
          data: { status: p.status, lastStatusAt: now, lastError: p.lastError ?? null },
        });
      }
    });
    return { serverTime: now.toISOString() };
  }
}
