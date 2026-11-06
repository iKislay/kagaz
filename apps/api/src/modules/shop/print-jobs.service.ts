import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  type LeaseResponse,
  OrderStatus,
  type PrintStatusReport,
  type ShopJob,
  printDocumentName,
} from '@kagaz/shared';
import { SYSTEM_ACTOR } from '../../common/actor.js';
import { type DeviceContext, deviceActor } from '../../common/auth/device-auth.guard.js';
import { APP_CONFIG } from '../../common/config/config.module.js';
import { type AppConfig } from '../../common/config/config.schema.js';
import { AppError } from '../../common/http/api-exception.filter.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { StorageService } from '../files/storage.service.js';
import { OrderStateMachine, type Tx } from '../orders/order-state-machine.js';
import { parseOptions } from '../orders/order-view.js';
import { SHOP_JOB_INCLUDE, toShopJob } from './shop-job-view.js';
import { releaseLease } from './shop-jobs.service.js';

/**
 * Printer leases and print progress (Appendix A.2, CLAUDE.md invariant 8):
 * one active Kagaz job per physical printer, FIFO per printer, an attempt is never
 * resubmitted, and anything ambiguous goes to NEEDS_OPERATOR_CHECK — never auto-reprint.
 */
@Injectable()
export class PrintJobsService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly stateMachine: OrderStateMachine,
  ) {}

  async lease(device: DeviceContext, printJobId: string): Promise<LeaseResponse> {
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + this.config.PRINTER_LEASE_TTL_SECONDS * 1000);

    const job = await this.prisma.$transaction(async (tx) => {
      const job = await this.findScoped(tx, device, printJobId);

      // Idempotent re-lease by the same device (e.g. it lost the response).
      if (job.status === 'LEASED' && job.leasedByDeviceId === device.deviceId) {
        await tx.printJob.update({ where: { id: job.id }, data: { leaseUntil } });
        await tx.printer.updateMany({
          where: { id: job.printerId, activeJobId: job.id },
          data: { leaseUntil },
        });
        return job;
      }
      if (job.status !== 'READY') {
        throw new AppError('JOB_NOT_READY', `Print job is ${job.status}`, HttpStatus.CONFLICT);
      }

      const head = await tx.printJob.findFirst({
        where: { printerId: job.printerId, status: 'READY' },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (head?.id !== job.id) {
        throw new AppError(
          'NOT_NEXT_IN_QUEUE',
          'Another job is ahead of this one on this printer',
          HttpStatus.CONFLICT,
        );
      }

      // A previous holder whose lease expired is now in an unknown state: hand it to the
      // operator before taking the printer (the full background sweeper lands in P2.7).
      const printer = job.printer;
      if (printer.activeJobId && printer.activeJobId !== job.id) {
        if (printer.leaseUntil && printer.leaseUntil > now) {
          throw new AppError('PRINTER_BUSY', 'The printer is busy with another job', 409);
        }
        await this.markUncertain(tx, printer.activeJobId, 'Lease expired before completion');
      }

      const taken = await tx.printer.updateMany({
        where: {
          id: printer.id,
          shopId: device.shopId,
          OR: [{ activeJobId: null }, { leaseUntil: { lt: now } }, { activeJobId: job.id }],
        },
        data: { activeJobId: job.id, leaseUntil },
      });
      const leased = await tx.printJob.updateMany({
        where: { id: job.id, status: 'READY' },
        data: { status: 'LEASED', leaseUntil, leasedByDeviceId: device.deviceId },
      });
      if (taken.count !== 1 || leased.count !== 1) {
        throw new AppError('PRINTER_BUSY', 'The printer was taken by another job', 409);
      }

      await this.stateMachine.transition(tx, {
        orderId: job.orderId,
        to: OrderStatus.PRINTING,
        from: OrderStatus.QUEUED,
        actor: deviceActor(device),
        auditAction: 'print.started',
        metadata: { printJobId: job.id, attempt: job.attempt, printerId: printer.id },
      });
      return job;
    });

    if (!job.packetFile || !job.checksum) {
      throw new AppError('PACKET_MISSING', 'The print packet is not available', 409);
    }
    const download = await this.storage.createDownloadUrl(job.packetFile.objectKey);
    const options = parseOptions(job.order.options);
    return {
      printJobId: job.id,
      orderId: job.orderId,
      publicRef: job.order.publicRef,
      attempt: job.attempt,
      documentName: printDocumentName(job.order.publicRef, job.attempt),
      printerName: job.printer.printerName,
      settings: { colour: options.colour, duplex: options.duplex, paperSize: 'A4' },
      downloadUrl: download.url,
      downloadExpiresAt: download.expiresAt.toISOString(),
      sha256: job.checksum,
      pageCount: job.packetFile.pageCount ?? 0,
      leaseUntil: leaseUntil.toISOString(),
    };
  }

  /** Agent progress reports. Repeating the current status is a no-op (safe retries). */
  async report(
    device: DeviceContext,
    printJobId: string,
    report: PrintStatusReport,
  ): Promise<ShopJob> {
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + this.config.PRINTER_LEASE_TTL_SECONDS * 1000);

    const orderId = await this.prisma.$transaction(async (tx) => {
      const job = await this.findScoped(tx, device, printJobId);
      if (job.leasedByDeviceId !== device.deviceId) {
        throw new AppError('NOT_LEASE_HOLDER', 'This device does not hold the job lease', 409);
      }
      if (job.status === report.status) return job.orderId; // idempotent replay

      const allowed: Record<PrintStatusReport['status'], string[]> = {
        SUBMITTED: ['LEASED'],
        SPOOLER_COMPLETE: ['LEASED', 'SUBMITTED'],
        FAILED: ['LEASED', 'SUBMITTED'],
      };
      if (!allowed[report.status].includes(job.status)) {
        throw new AppError(
          'INVALID_JOB_TRANSITION',
          `Print job is ${job.status}; cannot report ${report.status}`,
          HttpStatus.CONFLICT,
        );
      }

      if (report.status === 'SUBMITTED') {
        await tx.printJob.update({
          where: { id: job.id },
          data: {
            status: 'SUBMITTED',
            spoolerJobId: report.spoolerJobId ?? null,
            submittedAt: now,
            leaseUntil,
          },
        });
        await tx.printer.updateMany({
          where: { id: job.printerId, activeJobId: job.id },
          data: { leaseUntil },
        });
      } else if (report.status === 'SPOOLER_COMPLETE') {
        // Telemetry only: the order stays PRINTING until the operator marks it ready.
        await tx.printJob.update({
          where: { id: job.id },
          data: { status: 'SPOOLER_COMPLETE', completedAt: now, leaseUntil: null },
        });
        await releaseLease(tx, job.printerId, job.id);
      } else {
        await tx.printJob.update({
          where: { id: job.id },
          data: { status: 'FAILED', error: report.error, leaseUntil: null },
        });
        await releaseLease(tx, job.printerId, job.id);
        await this.stateMachine.transition(tx, {
          orderId: job.orderId,
          to: OrderStatus.NEEDS_OPERATOR_CHECK,
          from: OrderStatus.PRINTING,
          actor: deviceActor(device),
          reason: report.error,
          auditAction: 'print.failed',
          metadata: { printJobId: job.id, attempt: job.attempt },
        });
      }
      return job.orderId;
    });

    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: SHOP_JOB_INCLUDE,
    });
    return toShopJob(order);
  }

  private async findScoped(tx: Tx, device: DeviceContext, printJobId: string) {
    const job = await tx.printJob.findFirst({
      where: { id: printJobId, order: { shopId: device.shopId } },
      include: { order: true, printer: true, packetFile: true },
    });
    if (!job)
      throw new AppError('PRINT_JOB_NOT_FOUND', 'Print job not found', HttpStatus.NOT_FOUND);
    return job;
  }

  private async markUncertain(tx: Tx, printJobId: string, reason: string): Promise<void> {
    const stale = await tx.printJob.findUnique({ where: { id: printJobId } });
    if (!stale || (stale.status !== 'LEASED' && stale.status !== 'SUBMITTED')) return;
    await tx.printJob.update({
      where: { id: stale.id },
      data: { status: 'UNCERTAIN', error: reason, leaseUntil: null },
    });
    const order = await tx.order.findUnique({ where: { id: stale.orderId } });
    if (order?.status === OrderStatus.PRINTING) {
      await this.stateMachine.transition(tx, {
        orderId: stale.orderId,
        to: OrderStatus.NEEDS_OPERATOR_CHECK,
        from: OrderStatus.PRINTING,
        actor: SYSTEM_ACTOR,
        reason,
        metadata: { printJobId: stale.id },
      });
    }
  }
}
