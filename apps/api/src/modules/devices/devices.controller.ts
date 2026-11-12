import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { type Request } from 'express';
import {
  type EnrollDeviceRequest,
  EnrollDeviceRequestSchema,
  type EnrollDeviceResponse,
  type EnrollWithLoginRequest,
  EnrollWithLoginRequestSchema,
  type ShopSignupRequest,
  ShopSignupRequestSchema,
  type HeartbeatRequest,
  HeartbeatRequestSchema,
  type HeartbeatResponse,
  type RotateDeviceTokenResponse,
} from '@kagaz/shared';
import {
  CurrentDevice,
  DeviceAuthGuard,
  type DeviceContext,
} from '../../common/auth/device-auth.guard.js';
import { AppError } from '../../common/http/api-exception.filter.js';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe.js';
import { LoginRateLimiter } from '../identity/login-rate-limiter.js';
import { DevicesService } from './devices.service.js';
import { signupSlug } from './shop-signup.js';

@Controller('devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Post('enroll')
  @HttpCode(201)
  enroll(
    @Body(new ZodValidationPipe(EnrollDeviceRequestSchema)) body: EnrollDeviceRequest,
  ): Promise<EnrollDeviceResponse> {
    return this.devices.enroll(body);
  }

  /** Legacy path (PRD §11.2); same handler as POST /api/shop/heartbeat. */
  @Post('heartbeat')
  @HttpCode(200)
  @UseGuards(DeviceAuthGuard)
  heartbeat(
    @CurrentDevice() device: DeviceContext,
    @Body(new ZodValidationPipe(HeartbeatRequestSchema)) body: HeartbeatRequest,
  ): Promise<HeartbeatResponse> {
    return this.devices.heartbeat(device, body);
  }

  /** Contract §4: issue a new device token; the old one stops working immediately. */
  @Post('rotate-token')
  @HttpCode(200)
  @UseGuards(DeviceAuthGuard)
  rotateToken(@CurrentDevice() device: DeviceContext): Promise<RotateDeviceTokenResponse> {
    return this.devices.rotateToken(device);
  }
}

/**
 * `POST /api/shop/heartbeat` (contract §1). Deliberately NOT behind AgentVersionGuard: an
 * outdated agent still gets 200 with `upgradeRequired: true`.
 */
@Controller('shop')
@UseGuards(DeviceAuthGuard)
export class ShopHeartbeatController {
  constructor(private readonly devices: DevicesService) {}

  @Post('heartbeat')
  @HttpCode(200)
  heartbeat(
    @CurrentDevice() device: DeviceContext,
    @Body(new ZodValidationPipe(HeartbeatRequestSchema)) body: HeartbeatRequest,
  ): Promise<HeartbeatResponse> {
    return this.devices.heartbeat(device, body);
  }
}

/**
 * Public shop account endpoints used by the Kaggaz Shop app before it has a device token:
 * create a shop (and connect this PC), or connect a PC with the owner's mobile + password.
 */
@Controller('shop')
export class ShopAccountController {
  /** shortcut: in-memory per-IP limit (one API instance on Render), move to Postgres when scaled out. */
  private readonly signupLimiter = new LoginRateLimiter(5, 60 * 60 * 1000);

  constructor(private readonly devices: DevicesService) {}

  @Post('signup')
  @HttpCode(201)
  signup(
    @Body(new ZodValidationPipe(ShopSignupRequestSchema)) body: ShopSignupRequest,
    @Req() req: Request,
  ): Promise<EnrollDeviceResponse> {
    const ip = req.ip ?? req.socket?.remoteAddress ?? '';
    if (this.signupLimiter.isBlocked(ip)) {
      throw new AppError(
        'RATE_LIMITED',
        'Too many sign-ups from this network. Try again in an hour.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    this.signupLimiter.fail(ip); // every attempt counts
    return this.devices.signup(body, signupSlug(body.shopName), ip);
  }

  @Post('enroll-with-login')
  @HttpCode(201)
  enrollWithLogin(
    @Body(new ZodValidationPipe(EnrollWithLoginRequestSchema)) body: EnrollWithLoginRequest,
    @Req() req: Request,
  ): Promise<EnrollDeviceResponse> {
    return this.devices.enrollWithLogin(body, req.ip ?? req.socket?.remoteAddress ?? '');
  }
}
