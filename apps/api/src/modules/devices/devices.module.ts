import { Module } from '@nestjs/common';
import { DeviceAuthGuard } from '../../common/auth/device-auth.guard.js';
import { DevicesController } from './devices.controller.js';
import { DevicesService } from './devices.service.js';

@Module({
  controllers: [DevicesController],
  providers: [DevicesService, DeviceAuthGuard],
  exports: [DeviceAuthGuard],
})
export class DevicesModule {}
