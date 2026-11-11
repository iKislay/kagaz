import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Injectable,
  createParamDecorator,
} from '@nestjs/common';
import { type Request } from 'express';
import { type Actor } from '../actor.js';
import { sha256Hex } from '../crypto/tokens.js';
import { AppError } from '../http/api-exception.filter.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { bindTenantShop } from '../prisma/tenant-scope.js';

/** Operator signed in on the device (contract §4); set by OperatorAuthGuard. */
export interface OperatorContext {
  userId: string;
  name: string;
  role: 'SHOP_OWNER' | 'SHOP_OPERATOR';
  sessionId: string;
}

/** The authenticated shop device. shopId comes ONLY from here (CLAUDE.md invariant 10). */
export interface DeviceContext {
  deviceId: string;
  shopId: string;
  name: string;
  /** Present on human-action routes guarded by OperatorAuthGuard. */
  operator?: OperatorContext;
}

export type DeviceRequest = Request & { device?: DeviceContext };

/**
 * Authenticates the Windows shop app: `Authorization: Bearer <deviceToken>`.
 * Tokens are stored as SHA-256 hashes. Unknown token → 401 UNAUTHORIZED; a revoked device →
 * 401 DEVICE_REVOKED so the app can return to the pairing screen (contract §4).
 */
@Injectable()
export class DeviceAuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<DeviceRequest>();
    if (req.device) return true;
    const header = req.headers.authorization ?? '';
    const match = /^Bearer ([A-Za-z0-9_-]{20,200})$/.exec(header);
    if (!match) throw unauthorized();

    const device = await this.prisma.shopDevice.findUnique({
      where: { tokenHash: sha256Hex(match[1]!) },
      select: { id: true, shopId: true, name: true, status: true },
    });
    if (!device) throw unauthorized();
    if (device.status !== 'ACTIVE') {
      throw new AppError(
        'DEVICE_REVOKED',
        'This device was revoked. Pair it again with a new code.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    req.device = { deviceId: device.id, shopId: device.shopId, name: device.name };
    // From here on every shop-owned query in this request must be scoped to this shop (P4.1).
    bindTenantShop(device.shopId);
    return true;
  }
}

export const CurrentDevice = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const device = ctx.switchToHttp().getRequest<DeviceRequest>().device;
  if (!device) throw unauthorized();
  return device;
});

/**
 * Who acted through a device: the signed-in operator (STAFF, with the device id in audit
 * metadata) on human-action routes, otherwise the device itself (agent-only calls).
 */
export function deviceActor(device: DeviceContext): Actor {
  return device.operator
    ? { type: 'STAFF', id: device.operator.userId, deviceId: device.deviceId }
    : { type: 'DEVICE', id: device.deviceId };
}

function unauthorized(): AppError {
  return new AppError('UNAUTHORIZED', 'Device is not paired', HttpStatus.UNAUTHORIZED);
}
