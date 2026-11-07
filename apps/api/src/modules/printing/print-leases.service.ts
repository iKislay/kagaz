import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { OrderStatus } from '@kagaz/shared';
import { type Actor, SYSTEM_ACTOR } from '../../common/actor.js';
import { APP_CONFIG } from '../../common/config/config.module.js';
import { type AppConfig } from '../../common/config/config.schema.js';
import { DomainEvent, DomainEventBus } from '../../common/events/domain-events.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { type PrintJobStatus } from '../../generated/prisma/client.js';
import { OrderStateMachine, type Tx } from '../orders/order-state-machine.js';

/** Job statuses that hold (or held) a printer lease. */
export const LEASE_HOLDING: PrintJobStatus[] = ['LEASED', 'SUBMITTED'];
export const SWEEP_INTERVAL_MS = 15_000;
export const LEASE_EXPIRED_REASON = 'Lease expired before completion';

/** Free the printer if this job still holds its lease. */
export async function releaseLease(tx: Tx, printerId: string, jobId: string): Promise<void> {
  await tx.printer.updateMany({
    where: { id: printerId, activeJobId: jobId },
    data: { activeJobId: null, leaseUntil: null },
  });
}

interface JobRef {
  id: string;
  orderId: string;
  printerId: string;
  attempt: number;
}

/**
 * Printer leases (plan Appendix A.2, CLAUDE.md invariant 8, FR-PRINT-02/04):
 * - acquire: ONE conditional UPDATE on the printer row — no active unexpired lease AND this
 *   job is the oldest READY job for the printer — so exactly one caller wins a race;
 * - renew: heartbeat `activePrintJobIds` and status reports extend lease_until;
 * - expire: a lease that ran out while LEASED/SUBMITTED → job UNCERTAIN, order
 *   NEEDS_OPERATOR_CHECK, lease cleared. Never auto-requeued.
 */
@Injectable()
export class PrintLeaseService {
  private readonly logger = new Logger(PrintLeaseService.name);
  private sweeping = false;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly stateMachine: OrderStateMachine,
    private readonly events: DomainEventBus,
  ) {}

  leaseUntil(now = new Date()): Date {
    return new Date(now.getTime() + this.config.PRINTER_LEASE_TTL_SECONDS * 1000);
  }

  /** Appendix A.2 acquire. Returns false if the printer is busy or the job isn't next. */
  async acquire(
    tx: Tx,
    p: { jobId: string; printerId: string; shopId: string; leaseUntil: Date; now: Date },
  ): Promise<boolean> {
    const rows = await tx.$executeRaw`
      UPDATE printers
         SET active_job_id = ${p.jobId}::uuid, lease_until = ${p.leaseUntil}, updated_at = ${p.now}
       WHERE id = ${p.printerId}::uuid
         AND shop_id = ${p.shopId}::uuid
         AND (active_job_id IS NULL OR lease_until < ${p.now})
         AND ${p.jobId}::uuid = (
               SELECT id FROM print_jobs
                WHERE printer_id = ${p.printerId}::uuid AND status = 'READY'
                ORDER BY created_at ASC, id ASC
                LIMIT 1)`;
    return rows === 1;
  }

  /**
   * Extend the leases of jobs this device holds (heartbeat / status report). Only jobs still
   * LEASED/SUBMITTED by this device in this shop are touched; returns the renewed job ids.
   */
  async renew(
    tx: Tx,
    holder: { deviceId: string; shopId: string },
    jobIds: readonly string[],
    leaseUntil: Date,
  ): Promise<string[]> {
    if (jobIds.length === 0) return [];
    const jobs = await tx.printJob.findMany({
      where: {
        id: { in: [...jobIds] },
        leasedByDeviceId: holder.deviceId,
        status: { in: LEASE_HOLDING },
        order: { shopId: holder.shopId },
      },
      select: { id: true },
    });
    const ids = jobs.map((j) => j.id);
    if (ids.length === 0) return [];
    await tx.printJob.updateMany({
      where: { id: { in: ids }, status: { in: LEASE_HOLDING } },
      data: { leaseUntil },
    });
    await tx.printer.updateMany({ where: { activeJobId: { in: ids } }, data: { leaseUntil } });
    return ids;
  }

  /**
   * Job LEASED/SUBMITTED → UNCERTAIN, lease cleared, order PRINTING → NEEDS_OPERATOR_CHECK.
   * With `expiredBefore`, only acts if the job's lease really ran out (sweeper race-safety).
   * Returns false if the job was no longer holding a lease (nothing changed).
   */
  async expire(
    tx: Tx,
    printJobId: string,
    reason: string,
    actor: Actor = SYSTEM_ACTOR,
    expiredBefore?: Date,
  ): Promise<boolean> {
    const updated = await tx.printJob.updateMany({
      where: {
        id: printJobId,
        status: { in: LEASE_HOLDING },
        ...(expiredBefore ? { leaseUntil: { lt: expiredBefore } } : {}),
      },
      data: { status: 'UNCERTAIN', error: reason, leaseUntil: null },
    });
    if (updated.count !== 1) return false;

    const job = await tx.printJob.findUniqueOrThrow({
      where: { id: printJobId },
      include: { order: { select: { status: true, shopId: true } } },
    });
    await releaseLease(tx, job.printerId, job.id);
    this.publishJob(tx, job, job.order.shopId, 'UNCERTAIN');
    if (job.order.status === OrderStatus.PRINTING) {
      await this.stateMachine.transition(tx, {
        orderId: job.orderId,
        to: OrderStatus.NEEDS_OPERATOR_CHECK,
        from: OrderStatus.PRINTING,
        actor,
        reason,
        auditAction: 'print.uncertain',
        metadata: { printJobId: job.id, attempt: job.attempt, printerId: job.printerId },
      });
    }
    return true;
  }

  /** Sweeper (FR-PRINT-04): expired leases on LEASED/SUBMITTED jobs → operator check. */
  async sweep(now = new Date()): Promise<number> {
    const expired = await this.prisma.printJob.findMany({
      where: { status: { in: LEASE_HOLDING }, leaseUntil: { lt: now } },
      select: { id: true },
      orderBy: { leaseUntil: 'asc' },
      take: 200,
    });
    let swept = 0;
    for (const { id } of expired) {
      try {
        const done = await this.prisma.$transaction((tx) =>
          this.expire(tx, id, LEASE_EXPIRED_REASON, SYSTEM_ACTOR, now),
        );
        if (done) swept++;
      } catch (err) {
        // e.g. CONCURRENT_MODIFICATION with an operator action — retried on the next tick.
        this.logger.warn({ err, printJobId: id }, 'lease sweep failed for job');
      }
    }
    if (swept > 0) this.logger.log({ swept }, 'expired print leases moved to operator check');
    return swept;
  }

  @Interval('print-lease-sweeper', SWEEP_INTERVAL_MS)
  async onSweepTick(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      await this.sweep();
    } catch (err) {
      this.logger.error({ err }, 'lease sweeper failed');
    } finally {
      this.sweeping = false;
    }
  }

  /** Queue a `print_job.status_changed` event (emitted after commit). */
  publishJob(tx: Tx, job: JobRef, shopId: string, status: PrintJobStatus): void {
    this.events.publish(tx, DomainEvent.PRINT_JOB_STATUS_CHANGED, {
      printJobId: job.id,
      orderId: job.orderId,
      shopId,
      printerId: job.printerId,
      attempt: job.attempt,
      status,
      at: new Date().toISOString(),
    });
  }
}
