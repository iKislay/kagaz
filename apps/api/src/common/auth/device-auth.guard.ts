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

/** The authenticated shop device. shopId comes ONLY from here (CLAUDE.md invariant 10). */
export interface DeviceContext {
  deviceId: string;
  shopId: string;
  name: string;
}

type DeviceRequest = Request & { device?: DeviceContext };

/**
 * Authenticates the Windows shop app: `Authorization: Bearer <deviceToken>`.
 * Tokens are stored as SHA-256 hashes; revoked or unknown tokens get 401.
 */
@Injectable()
export class DeviceAuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<DeviceRequest>();
    const header = req.headers.authorization ?? '';
    const match = /^Bearer ([A-Za-z0-9_-]{20,200})$/.exec(header);
    if (!match) throw unauthorized();

    const device = await this.prisma.shopDevice.findUnique({
      where: { tokenHash: sha256Hex(match[1]!) },
      select: { id: true, shopId: true, name: true, status: true },
    });
    if (!device || device.status !== 'ACTIVE') throw unauthorized();

    req.device = { deviceId: device.id, shopId: device.shopId, name: device.name };
    return true;
  }
}

export const CurrentDevice = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const device = ctx.switchToHttp().getRequest<DeviceRequest>().device;
  if (!device) throw unauthorized();
  return device;
});

/** Device actions are attributed to the device until operator login lands (P2.3). */
export function deviceActor(device: DeviceContext): Actor {
  return { type: 'DEVICE', id: device.deviceId };
}

function unauthorized(): AppError {
  return new AppError(
    'DEVICE_UNAUTHORIZED',
    'Device is not paired or was revoked',
    HttpStatus.UNAUTHORIZED,
  );
}
