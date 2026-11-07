import { Module } from '@nestjs/common';
import { DeviceAuthGuard } from '../../common/auth/device-auth.guard.js';
import { PrintingModule } from '../printing/printing.module.js';
import { DeviceHealthService } from './device-health.service.js';
import { DevicesController, ShopHeartbeatController } from './devices.controller.js';
import { DevicesService } from './devices.service.js';

@Module({
  imports: [PrintingModule],
  controllers: [DevicesController, ShopHeartbeatController],
  providers: [DevicesService, DeviceAuthGuard, DeviceHealthService],
  exports: [DeviceAuthGuard, DeviceHealthService],
})
export class DevicesModule {}
