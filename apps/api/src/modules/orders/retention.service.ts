import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OrderStatus } from '@kagaz/shared';
import { SYSTEM_ACTOR } from '../../common/actor.js';
import { APP_CONFIG } from '../../common/config/config.module.js';
import { type AppConfig } from '../../common/config/config.schema.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { StorageService } from '../files/storage.service.js';
import { OrderStateMachine } from './order-state-machine.js';

const HOUR_MS = 3_600_000;
const BATCH = 500;
/** Idempotency records only need to outlive client retries. */
const IDEMPOTENCY_RETENTION_MS = 24 * HOUR_MS;

export interface RetentionResult {
  expiredOrders: number;
  deletedFiles: number;
  failedDeletes: number;
  purgedIdempotencyRecords: number;
}

/**
 * Data retention (PRD §14.3, P2.12, T17), hourly:
 * 1. abandoned DRAFT / AWAITING_PAYMENT orders past `expiresAt` (UNPAID_ORDER_EXPIRY_HOURS
 *    after creation) → CANCELLED (actor SYSTEM);
 * 2. original + packet PDFs deleted from storage and marked `deletedAt` / DELETED:
 *    READY_FOR_PICKUP (from readyAt, ADR-002), COLLECTED or CANCELLED for
 *    RETENTION_AFTER_COLLECTED_HOURS (24 h),
 *    REJECTED / REFUNDED for RETENTION_AFTER_REJECTED_HOURS (7-day dispute window);
 * 3. idempotency records older than 24 h purged.
 * Order, payment, refund and audit metadata are kept. Once the object is gone, previously
 * issued signed URLs stop working (storage answers 404).
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);
  private running = false;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly stateMachine: OrderStateMachine,
  ) {}

  @Cron(CronExpression.EVERY_HOUR, { name: 'retention' })
  async onTick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.run();
      this.logger.log(result, 'retention run complete');
    } catch (err) {
      this.logger.error({ err }, 'retention run failed');
    } finally {
      this.running = false;
    }
  }

  async run(now = new Date()): Promise<RetentionResult> {
    const expiredOrders = await this.expireUnpaidOrders(now);
    const { deleted, failed } = await this.deleteExpiredFiles(now);
    const purged = await this.prisma.idempotencyRecord.deleteMany({
      where: { createdAt: { lt: new Date(now.getTime() - IDEMPOTENCY_RETENTION_MS) } },
    });
    return {
      expiredOrders,
      deletedFiles: deleted,
      failedDeletes: failed,
      purgedIdempotencyRecords: purged.count,
    };
  }

  async expireUnpaidOrders(now = new Date()): Promise<number> {
    const createdBefore = new Date(now.getTime() - this.config.UNPAID_ORDER_EXPIRY_HOURS * HOUR_MS);
    const unpaid = [OrderStatus.DRAFT, OrderStatus.AWAITING_PAYMENT];
    const orders = await this.prisma.order.findMany({
      where: {
        status: { in: unpaid },
        OR: [{ expiresAt: { lt: now } }, { expiresAt: null, createdAt: { lt: createdBefore } }],
        // Never cancel something the gateway already confirmed (payments decide that path).
        payments: { none: { status: 'PAID' } },
        // ADR-003: the shop is still checking a customer's payment report.
        paymentReports: { none: { status: 'OPEN' } },
      },
      select: { id: true },
      take: BATCH,
    });
    let expired = 0;
    for (const { id } of orders) {
      try {
        await this.prisma.$transaction((tx) =>
          this.stateMachine.transition(tx, {
            orderId: id,
            to: OrderStatus.CANCELLED,
            from: unpaid,
            actor: SYSTEM_ACTOR,
            reason: 'Unpaid order expired',
          }),
        );
        expired++;
      } catch (err) {
        // Raced with payment/cancel: the next run re-evaluates.
        this.logger.warn({ err, orderId: id }, 'could not expire unpaid order');
      }
    }
    return expired;
  }

  async deleteExpiredFiles(now = new Date()): Promise<{ deleted: number; failed: number }> {
    const ago = (hours: number) => new Date(now.getTime() - hours * HOUR_MS);
    const closed = ago(this.config.RETENTION_AFTER_COLLECTED_HOURS);
    const disputed = ago(this.config.RETENTION_AFTER_REJECTED_HOURS);
    const files = await this.prisma.fileAsset.findMany({
      where: {
        deletedAt: null,
        order: {
          OR: [
            // ADR-002: READY_FOR_PICKUP is the normal end state; count from readyAt.
            { status: OrderStatus.READY_FOR_PICKUP, readyAt: { lt: closed } },
            { status: OrderStatus.COLLECTED, collectedAt: { lt: closed } },
            { status: OrderStatus.CANCELLED, updatedAt: { lt: closed } },
            {
              status: { in: [OrderStatus.REJECTED, OrderStatus.REFUNDED] },
              updatedAt: { lt: disputed },
            },
          ],
        },
      },
      select: { id: true, orderId: true, objectKey: true },
      take: BATCH,
    });

    let deleted = 0;
    let failed = 0;
    for (const file of files) {
      try {
        await this.storage.delete(file.objectKey);
        await this.prisma.fileAsset.update({
          where: { id: file.id },
          data: { deletedAt: now, status: 'DELETED' },
        });
        deleted++;
      } catch (err) {
        failed++;
        this.logger.error({ err, orderId: file.orderId, fileId: file.id }, 'file deletion failed');
      }
    }
    return { deleted, failed };
  }
}
