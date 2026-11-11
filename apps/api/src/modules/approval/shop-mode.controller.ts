import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import {
  type ShopMode,
  type UpdateShopModeRequest,
  UpdateShopModeRequestSchema,
} from '@kagaz/shared';
import {
  CurrentDevice,
  DeviceAuthGuard,
  type DeviceContext,
  deviceActor,
} from '../../common/auth/device-auth.guard.js';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe.js';
import { RequireOperator } from '../identity/operator-auth.guard.js';
import { ApprovalService } from './approval.service.js';

/**
 * Approval mode for the device's shop (contract §3). `PATCH` is a human action: the identity
 * workstream adds the operator-token requirement at integration.
 */
@Controller('shop/mode')
@UseGuards(DeviceAuthGuard)
export class ShopModeController {
  constructor(private readonly approval: ApprovalService) {}

  @Get()
  get(@CurrentDevice() device: DeviceContext): Promise<ShopMode> {
    return this.approval.getMode(device.shopId);
  }

  @Patch()
  @RequireOperator()
  set(
    @CurrentDevice() device: DeviceContext,
    @Body(new ZodValidationPipe(UpdateShopModeRequestSchema)) body: UpdateShopModeRequest,
  ): Promise<ShopMode> {
    return this.approval.setMode(device.shopId, body, deviceActor(device));
  }
}
