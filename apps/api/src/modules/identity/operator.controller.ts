import { Body, Controller, Headers, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { type Request } from 'express';
import {
  OPERATOR_TOKEN_HEADER,
  type OperatorLoginRequest,
  OperatorLoginRequestSchema,
  type OperatorLoginResponse,
} from '@kagaz/shared';
import {
  CurrentDevice,
  DeviceAuthGuard,
  type DeviceContext,
} from '../../common/auth/device-auth.guard.js';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe.js';
import { OperatorSessionService } from './operator-session.service.js';

/** Operator sign-in on a paired device (contract §4). Device token required. */
@Controller('shop/operator')
@UseGuards(DeviceAuthGuard)
export class OperatorController {
  constructor(private readonly sessions: OperatorSessionService) {}

  @Post('login')
  @HttpCode(200)
  login(
    @CurrentDevice() device: DeviceContext,
    @Body(new ZodValidationPipe(OperatorLoginRequestSchema)) body: OperatorLoginRequest,
    @Req() req: Request,
  ): Promise<OperatorLoginResponse> {
    return this.sessions.login(device, body, req.ip ?? req.socket?.remoteAddress ?? '');
  }

  @Post('logout')
  @HttpCode(200)
  async logout(
    @CurrentDevice() device: DeviceContext,
    @Headers(OPERATOR_TOKEN_HEADER) token: string | undefined,
  ): Promise<{ ok: true }> {
    await this.sessions.logout(device, token?.trim());
    return { ok: true };
  }
}
