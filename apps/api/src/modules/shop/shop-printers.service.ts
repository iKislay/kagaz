import { Injectable } from '@nestjs/common';
import { type RegisterPrintersRequest, type ShopPrinter } from '@kagaz/shared';
import { type DeviceContext, deviceActor } from '../../common/auth/device-auth.guard.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';

@Injectable()
export class ShopPrintersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(device: DeviceContext): Promise<ShopPrinter[]> {
    const printers = await this.prisma.printer.findMany({
      where: { shopId: device.shopId },
      orderBy: [{ isDefault: 'desc' }, { displayName: 'asc' }],
    });
    return printers.map((p) => ({
      id: p.id,
      printerName: p.printerName,
      displayName: p.displayName,
      colourCapable: p.colourCapable,
      duplexCapable: p.duplexCapable,
      capabilitiesConfirmed: p.capabilitiesConfirmed,
      enabled: p.enabled,
      isDefault: p.isDefault,
      status: p.status,
    }));
  }

  /**
   * Register/update the Windows printers on this device with operator-confirmed capabilities.
   * The request is the complete "Use for Kaggaz" set for this device: listed printers are
   * enabled, and printers this device registered earlier but no longer lists are disabled
   * (so an unplugged printer stops receiving orders). Other devices' printers are untouched.
   */
  async register(device: DeviceContext, req: RegisterPrintersRequest): Promise<ShopPrinter[]> {
    await this.prisma.$transaction(async (tx) => {
      const defaultName = req.printers.find((p) => p.isDefault)?.printerName;
      if (defaultName) {
        await tx.printer.updateMany({
          where: { shopId: device.shopId, printerName: { not: defaultName } },
          data: { isDefault: false },
        });
      }
      for (const p of req.printers) {
        const fields = {
          deviceId: device.deviceId,
          displayName: p.displayName ?? p.printerName,
          colourCapable: p.colourCapable,
          duplexCapable: p.duplexCapable,
          capabilitiesConfirmed: p.capabilitiesConfirmed,
          enabled: true,
          ...(p.isDefault === undefined ? {} : { isDefault: p.isDefault }),
        };
        await tx.printer.upsert({
          where: { shopId_printerName: { shopId: device.shopId, printerName: p.printerName } },
          update: fields,
          create: { shopId: device.shopId, printerName: p.printerName, ...fields },
        });
      }
      const names = req.printers.map((p) => p.printerName);
      await tx.printer.updateMany({
        where: { shopId: device.shopId, deviceId: device.deviceId, printerName: { notIn: names } },
        data: { enabled: false, isDefault: false },
      });
      await this.audit.record(tx, deviceActor(device), 'printers.registered', {
        shopId: device.shopId,
        metadata: { printers: names },
      });
    });
    return this.list(device);
  }
}
