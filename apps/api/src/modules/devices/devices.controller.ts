import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import {
  type EnrollDeviceRequest,
  EnrollDeviceRequestSchema,
  type EnrollDeviceResponse,
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
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe.js';
import { DevicesService } from './devices.service.js';

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
