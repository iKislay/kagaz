import { HttpStatus, Injectable } from '@nestjs/common';
import {
  type LeaseResponse,
  OrderStatus,
  type PrintStatusReport,
  type ShopJob,
  printDocumentName,
} from '@kagaz/shared';
import { SYSTEM_ACTOR } from '../../common/actor.js';
import { type DeviceContext, deviceActor } from '../../common/auth/device-auth.guard.js';
import { AppError } from '../../common/http/api-exception.filter.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { type PrintJobStatus, type Prisma } from '../../generated/prisma/client.js';
import { StorageService } from '../files/storage.service.js';
import { OrderStateMachine } from '../orders/order-state-machine.js';
import { parseOptions } from '../orders/order-view.js';
import {
  LEASE_EXPIRED_REASON,
  LEASE_HOLDING,
  PrintLeaseService,
  releaseLease,
} from '../printing/print-leases.service.js';
import { SHOP_JOB_INCLUDE, toShopJob } from './shop-job-view.js';
import { findShopOrder, findShopPrintJob, printJobNotFound } from './shop-scope.js';

/** Which job statuses each report may follow. Terminal reports clear the lease. */
const REPORT_FROM: Record<PrintStatusReport['status'], PrintJobStatus[]> = {
  SUBMITTED: ['LEASED'],
  SPOOLER_COMPLETE: ['LEASED', 'SUBMITTED'],
  FAILED: ['LEASED', 'SUBMITTED'],
  UNCERTAIN: ['LEASED', 'SUBMITTED'],
};

/**
 * Printer leases and print progress (Appendix A.2, CLAUDE.md invariant 8):
 * one active Kagaz job per physical printer, FIFO per printer, an attempt is never
 * resubmitted, and anything ambiguous goes to NEEDS_OPERATOR_CHECK — never auto-reprint.
 */
@Injectable()
export class PrintJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly stateMachine: OrderStateMachine,
    private readonly leases: PrintLeaseService,
  ) {}

  async lease(device: DeviceContext, printJobId: string): Promise<LeaseResponse> {
    const now = new Date();
    const leaseUntil = this.leases.leaseUntil(now);

    const job = await this.prisma.$transaction(async (tx) => {
      const job = await findShopPrintJob(tx, device.shopId, printJobId);

      // Idempotent re-lease by the holder (e.g. it lost the response): renew only.
      if (job.status === 'LEASED' && job.leasedByDeviceId === device.deviceId) {
        await this.leases.renew(tx, device, [job.id], leaseUntil);
        return job;
      }
      if (job.status !== 'READY') {
        throw new AppError(
          'JOB_NOT_LEASABLE',
          `Print job is ${job.status} and cannot be leased`,
          HttpStatus.CONFLICT,
          { status: job.status },
        );
      }

      // Explain failures precisely; the conditional update below is what guarantees safety.
      const head = await tx.printJob.findFirst({
        where: { printerId: job.printerId, status: 'READY' },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true },
      });
      if (head?.id !== job.id) {
        throw new AppError(
          'NOT_NEXT_IN_QUEUE',
          'Another job is ahead of this one on this printer',
          HttpStatus.CONFLICT,
        );
      }
      const printer = job.printer;
      if (printer.activeJobId && printer.activeJobId !== job.id) {
        if (printer.leaseUntil && printer.leaseUntil >= now) throw printerBusy();
        // The previous holder's lease ran out: its outcome is unknown → operator check.
        await this.leases.expire(tx, printer.activeJobId, LEASE_EXPIRED_REASON, SYSTEM_ACTOR, now);
      }

      const won = await this.leases.acquire(tx, {
        jobId: job.id,
        printerId: printer.id,
        shopId: device.shopId,
        leaseUntil,
        now,
      });
      if (!won) throw printerBusy();
      const leased = await tx.printJob.updateMany({
        where: { id: job.id, status: 'READY' },
        data: { status: 'LEASED', leaseUntil, leasedByDeviceId: device.deviceId },
      });
      if (leased.count !== 1) throw printerBusy();
      this.leases.publishJob(tx, job, device.shopId, 'LEASED');

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

    if (!job.packetFile || !job.checksum || job.packetFile.deletedAt) {
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

  /**
   * Agent progress reports (P2.10). Every report renews or clears the lease; repeating the
   * current status is a no-op (safe retries). SPOOLER_COMPLETE moves the order PRINTING →
   * READY_FOR_PICKUP as SYSTEM (ADR-002); FAILED/UNCERTAIN send it to the operator
   * (NEEDS_OPERATOR_CHECK), never to READY. A job not leased by this device → 404 (contract §1).
   */
  async report(
    device: DeviceContext,
    printJobId: string,
    report: PrintStatusReport,
  ): Promise<ShopJob> {
    const now = new Date();
    const leaseUntil = this.leases.leaseUntil(now);

    const orderId = await this.prisma.$transaction(async (tx) => {
      const job = await findShopPrintJob(tx, device.shopId, printJobId);
      if (job.leasedByDeviceId !== device.deviceId) throw printJobNotFound();

      if (job.status === report.status) {
        if (LEASE_HOLDING.includes(job.status)) {
          await this.leases.renew(tx, device, [job.id], leaseUntil);
        }
        return job.orderId; // idempotent replay
      }
      const from = REPORT_FROM[report.status];
      if (!from.includes(job.status)) throw invalidJobTransition(job.status, report.status);

      const data: Prisma.PrintJobUpdateManyMutationInput = { status: report.status };
      switch (report.status) {
        case 'SUBMITTED':
          Object.assign(data, {
            spoolerJobId: report.spoolerJobId ?? null,
            submittedAt: now,
            leaseUntil,
          });
          break;
        case 'SPOOLER_COMPLETE':
          Object.assign(data, { completedAt: now, leaseUntil: null });
          break;
        case 'FAILED':
          Object.assign(data, { error: report.error, leaseUntil: null });
          break;
        case 'UNCERTAIN':
          Object.assign(data, { error: report.reason ?? 'Outcome unknown', leaseUntil: null });
          break;
      }
      // Conditional on the current status: concurrent duplicate reports apply once.
      const applied = await tx.printJob.updateMany({
        where: { id: job.id, status: { in: from }, leasedByDeviceId: device.deviceId },
        data,
      });
      if (applied.count !== 1) {
        const current = await tx.printJob.findUniqueOrThrow({ where: { id: job.id } });
        if (current.status === report.status) return job.orderId;
        throw invalidJobTransition(current.status, report.status);
      }
      this.leases.publishJob(tx, job, device.shopId, report.status);

      if (report.status === 'SUBMITTED') {
        await tx.printer.updateMany({
          where: { id: job.printerId, activeJobId: job.id },
          data: { leaseUntil },
        });
        return job.orderId;
      }
      // Terminal for this attempt: free the printer for the next job.
      await releaseLease(tx, job.printerId, job.id);

      if (job.order.status !== OrderStatus.PRINTING) return job.orderId;

      // ADR-002: printing finished = ready. No Mark Ready, no pickup verification.
      if (report.status === 'SPOOLER_COMPLETE') {
        await this.stateMachine.transition(tx, {
          orderId: job.orderId,
          to: OrderStatus.READY_FOR_PICKUP,
          from: OrderStatus.PRINTING,
          actor: SYSTEM_ACTOR,
          reason: 'Printing finished',
          metadata: { printJobId: job.id, attempt: job.attempt, reportedBy: device.deviceId },
          data: { readyAt: now },
        });
      } else {
        const reason =
          report.status === 'FAILED' ? report.error : (report.reason ?? 'Outcome unknown');
        await this.stateMachine.transition(tx, {
          orderId: job.orderId,
          to: OrderStatus.NEEDS_OPERATOR_CHECK,
          from: OrderStatus.PRINTING,
          actor: deviceActor(device),
          reason,
          auditAction: report.status === 'FAILED' ? 'print.failed' : 'print.uncertain',
          metadata: { printJobId: job.id, attempt: job.attempt },
        });
      }
      return job.orderId;
    });

    return toShopJob(await findShopOrder(this.prisma, device.shopId, orderId, SHOP_JOB_INCLUDE));
  }
}

function printerBusy(): AppError {
  return new AppError('PRINTER_BUSY', 'The printer is busy with another job', HttpStatus.CONFLICT);
}

function invalidJobTransition(from: string, to: string): AppError {
  return new AppError(
    'INVALID_JOB_TRANSITION',
    `Print job is ${from}; cannot report ${to}`,
    HttpStatus.CONFLICT,
    { status: from },
  );
}
