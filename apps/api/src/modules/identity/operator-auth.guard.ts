import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UseGuards,
  applyDecorators,
} from '@nestjs/common';
import { OPERATOR_TOKEN_HEADER } from '@kagaz/shared';
import { DeviceAuthGuard, type DeviceRequest } from '../../common/auth/device-auth.guard.js';
import { OperatorSessionService, operatorLoginRequired } from './operator-session.service.js';

/**
 * Human actions on the Windows app (contract §4): needs the device token AND a valid
 * `X-Operator-Token` for an operator of the device's shop, else 401 OPERATOR_LOGIN_REQUIRED.
 * Sets `req.device.operator`, which makes `deviceActor()` attribute the action to the operator.
 */
@Injectable()
export class OperatorAuthGuard implements CanActivate {
  constructor(private readonly sessions: OperatorSessionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<DeviceRequest>();
    const device = req.device;
    if (!device) throw operatorLoginRequired();
    const header = req.headers[OPERATOR_TOKEN_HEADER];
    const token = typeof header === 'string' ? header.trim() : '';
    if (!token) throw operatorLoginRequired();
    device.operator = await this.sessions.verify(device, token);
    return true;
  }
}

/** Route decorator for operator actions: device auth, then operator session. */
export const RequireOperator = () => applyDecorators(UseGuards(DeviceAuthGuard, OperatorAuthGuard));
