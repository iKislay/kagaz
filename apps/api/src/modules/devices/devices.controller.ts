import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import {
  type EnrollDeviceRequest,
  EnrollDeviceRequestSchema,
  type EnrollDeviceResponse,
  type HeartbeatRequest,
  HeartbeatRequestSchema,
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

  @Post('heartbeat')
  @HttpCode(200)
  @UseGuards(DeviceAuthGuard)
  heartbeat(
    @CurrentDevice() device: DeviceContext,
    @Body(new ZodValidationPipe(HeartbeatRequestSchema)) body: HeartbeatRequest,
  ): Promise<{ serverTime: string }> {
    return this.devices.heartbeat(device, body);
  }
}
