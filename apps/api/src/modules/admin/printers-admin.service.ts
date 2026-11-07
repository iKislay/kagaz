import { HttpStatus, Injectable } from '@nestjs/common';
import { type AdminPrinterDetail, type AdminPrinterUpdateRequest } from '@kagaz/shared';
import { AppError } from '../../common/http/api-exception.filter.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { type StaffContext } from '../identity/staff-session.js';
import { auditStaffAction, diffFields } from './admin-audit.js';
import { shopNotFound } from './shop-settings.service.js';

/** Print jobs counted as a printer's queue: waiting or in flight. */
export const QUEUED_JOB_STATUSES = ['READY', 'LEASED', 'SUBMITTED'] as const;

/** Queue depth per printer id. */
export async function printerQueueDepths(
  prisma: PrismaService,
  printerIds: string[],
): Promise<Map<string, number>> {
  if (printerIds.length === 0) return new Map();
  const rows = await prisma.printJob.groupBy({
    by: ['printerId'],
    where: { printerId: { in: printerIds }, status: { in: [...QUEUED_JOB_STATUSES] } },
    _count: { id: true },
  });
  return new Map(rows.map((r) => [r.printerId, r._count.id]));
}

/**
 * Printer setup per shop (P4.3, FR-ADMIN-05): enable/disable, default, display name.
 * Capabilities are confirmed by the operator on the shop PC, not here.
 */
@Injectable()
export class PrintersAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async list(shopId: string): Promise<AdminPrinterDetail[]> {
    const shop = await this.prisma.shop.findUnique({ where: { id: shopId }, select: { id: true } });
    if (!shop) throw shopNotFound();
    const printers = await this.prisma.printer.findMany({
      where: { shopId },
      orderBy: [{ isDefault: 'desc' }, { displayName: 'asc' }],
    });
    const depth = await printerQueueDepths(
      this.prisma,
      printers.map((p) => p.id),
    );
    return printers.map((p) => ({
      id: p.id,
      deviceId: p.deviceId,
      printerName: p.printerName,
      displayName: p.displayName,
      colourCapable: p.colourCapable,
      duplexCapable: p.duplexCapable,
      capabilitiesConfirmed: p.capabilitiesConfirmed,
      enabled: p.enabled,
      isDefault: p.isDefault,
      status: p.status,
      lastStatusAt: p.lastStatusAt?.toISOString() ?? null,
      lastError: p.lastError,
      queueDepth: depth.get(p.id) ?? 0,
    }));
  }

  async update(
    staff: StaffContext,
    shopId: string,
    printerId: string,
    req: AdminPrinterUpdateRequest,
  ): Promise<AdminPrinterDetail> {
    await this.prisma.$transaction(async (tx) => {
      const printer = await tx.printer.findFirst({ where: { id: printerId, shopId } });
      if (!printer) {
        throw new AppError('PRINTER_NOT_FOUND', 'Printer not found', HttpStatus.NOT_FOUND);
      }
      const changes = diffFields(printer as unknown as Record<string, unknown>, req);
      if (Object.keys(changes).length === 0) return;
      if (req.isDefault) {
        await tx.printer.updateMany({
          where: { shopId, id: { not: printerId } },
          data: { isDefault: false },
        });
      }
      await tx.printer.update({ where: { id: printerId }, data: req });
      await auditStaffAction(tx, staff, 'printer.updated', shopId, {
        printerId,
        printerName: printer.printerName,
        changes,
      });
    });
    return (await this.list(shopId)).find((p) => p.id === printerId)!;
  }
}
