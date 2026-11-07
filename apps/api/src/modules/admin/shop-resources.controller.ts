import { Body, Controller, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import {
  AdminDeviceDetailSchema,
  AdminDeviceListSchema,
  type AdminDeviceUpdateRequest,
  AdminDeviceUpdateRequestSchema,
  AdminEnrollmentCodeCreatedSchema,
  AdminEnrollmentCodeListSchema,
  AdminPrinterDetailSchema,
  AdminPrinterListSchema,
  type AdminPrinterUpdateRequest,
  AdminPrinterUpdateRequestSchema,
} from '@kagaz/shared';
import { ZodValidationPipe } from '../../common/http/zod-validation.pipe.js';
import { CurrentStaff, type StaffContext } from '../identity/staff-session.js';
import { AdminAuthGuard } from './auth/admin-auth.guard.js';
import { DevicesAdminService } from './devices-admin.service.js';
import { PrintersAdminService } from './printers-admin.service.js';
import { UuidParam } from './shops.controller.js';

/** Devices + enrollment codes (P2.4, FR-ADMIN-04) — platform admins only. */
@Controller('admin/shops/:id')
@UseGuards(AdminAuthGuard)
export class ShopDevicesController {
  constructor(private readonly devices: DevicesAdminService) {}

  @Get('devices')
  async list(@Param('id', UuidParam) shopId: string) {
    return AdminDeviceListSchema.parse({ devices: await this.devices.list(shopId) });
  }

  @Patch('devices/:deviceId')
  @HttpCode(200)
  async update(
    @CurrentStaff() staff: StaffContext,
    @Param('id', UuidParam) shopId: string,
    @Param('deviceId', UuidParam) deviceId: string,
    @Body(new ZodValidationPipe(AdminDeviceUpdateRequestSchema)) body: AdminDeviceUpdateRequest,
  ) {
    return AdminDeviceDetailSchema.parse(await this.devices.update(staff, shopId, deviceId, body));
  }

  @Get('enrollment-codes')
  async codes(@Param('id', UuidParam) shopId: string) {
    return AdminEnrollmentCodeListSchema.parse({ codes: await this.devices.listCodes(shopId) });
  }

  @Post('enrollment-codes')
  @HttpCode(201)
  async createCode(@CurrentStaff() staff: StaffContext, @Param('id', UuidParam) shopId: string) {
    return AdminEnrollmentCodeCreatedSchema.parse(await this.devices.createCode(staff, shopId));
  }
}

/** Printer setup (FR-ADMIN-05) — platform admins only. */
@Controller('admin/shops/:id/printers')
@UseGuards(AdminAuthGuard)
export class ShopPrintersController {
  constructor(private readonly printers: PrintersAdminService) {}

  @Get()
  async list(@Param('id', UuidParam) shopId: string) {
    return AdminPrinterListSchema.parse({ printers: await this.printers.list(shopId) });
  }

  @Patch(':printerId')
  @HttpCode(200)
  async update(
    @CurrentStaff() staff: StaffContext,
    @Param('id', UuidParam) shopId: string,
    @Param('printerId', UuidParam) printerId: string,
    @Body(new ZodValidationPipe(AdminPrinterUpdateRequestSchema)) body: AdminPrinterUpdateRequest,
  ) {
    return AdminPrinterDetailSchema.parse(
      await this.printers.update(staff, shopId, printerId, body),
    );
  }
}
