import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { type Request, type Response } from 'express';
import {
  type DemoOtpInbox,
  type MeResponse,
  type MyOrdersResponse,
  type OtpRequest,
  type OtpRequestResponse,
  OtpRequestSchema,
  type OtpVerify,
  OtpVerifySchema,
} from '@kagaz/shared';
import { CustomerSessionService } from '../../common/auth/customer-session.js';
import { APP_CONFIG } from '../../common/config/config.module.js';
import { type AppConfig, demoControlsEnabled } from '../../common/config/config.schema.js';
import { AppError } from '../../common/http/api-exception.filter.js';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe.js';
import { AdminAuthGuard } from '../admin/auth/admin-auth.guard.js';
import { CustomerAuthService } from './customer-auth.service.js';
import { DemoOtpProvider, maskPhoneLast4 } from './demo-otp.provider.js';
import { OTP_PROVIDER, type OtpProvider } from './otp-provider.js';

const clientIp = (req: Request): string | null => req.ip ?? req.socket?.remoteAddress ?? null;

/** Customer sign-in by phone + OTP (P2.2, contract §6). */
@Controller()
export class CustomerAuthController {
  constructor(
    private readonly auth: CustomerAuthService,
    private readonly sessions: CustomerSessionService,
  ) {}

  @Post('auth/otp/request')
  @HttpCode(200)
  request(
    @Body(new ZodValidationPipe(OtpRequestSchema)) body: OtpRequest,
    @Req() req: Request,
  ): Promise<OtpRequestResponse> {
    return this.auth.request(body.phone, clientIp(req));
  }

  @Post('auth/otp/verify')
  @HttpCode(200)
  async verify(
    @Body(new ZodValidationPipe(OtpVerifySchema)) body: OtpVerify,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<MeResponse> {
    const customer = await this.auth.verify(body.phone, body.code, clientIp(req));
    await this.sessions.issue(res, { customerId: customer.id, phone: customer.phone });
    return { customer };
  }

  @Post('auth/logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response): MeResponse {
    this.sessions.clear(res);
    return { customer: null };
  }

  /** Never 401: the web app asks this on every page to decide "Sign in" vs "My orders". */
  @Get('me')
  async me(@Req() req: Request): Promise<MeResponse> {
    const session = await this.sessions.fromRequest(req);
    return { customer: session ? await this.auth.me(session.customerId) : null };
  }

  @Get('me/orders')
  async myOrders(@Req() req: Request): Promise<MyOrdersResponse> {
    const session = await this.sessions.fromRequest(req);
    if (!session) {
      throw new AppError('SIGN_IN_REQUIRED', 'Sign in to see your orders', HttpStatus.UNAUTHORIZED);
    }
    return { orders: await this.auth.myOrders(session.customerId) };
  }
}

/** GET /api/admin/demo/otp-inbox — demo OTP channel (admin, non-production only). */
@Controller('admin/demo')
@UseGuards(AdminAuthGuard)
export class DemoOtpInboxController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(OTP_PROVIDER) private readonly otp: OtpProvider,
  ) {}

  @Get('otp-inbox')
  inbox(): DemoOtpInbox {
    if (!demoControlsEnabled(this.config) || !(this.otp instanceof DemoOtpProvider)) {
      throw new AppError('NOT_FOUND', 'Demo controls are disabled', HttpStatus.NOT_FOUND);
    }
    return {
      items: this.otp.messages().map((m) => ({
        phone: maskPhoneLast4(m.phone),
        code: m.code,
        sentAt: m.sentAt.toISOString(),
        expiresAt: m.expiresAt.toISOString(),
      })),
    };
  }
}
