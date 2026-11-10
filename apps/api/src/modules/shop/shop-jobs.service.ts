import { HttpStatus, Injectable } from '@nestjs/common';
import {
  OrderStatus,
  type RejectJobRequest,
  ResolveAction,
  type ResolveJobRequest,
  type ShopJob,
  type ShopJobDetail,
} from '@kagaz/shared';
import { type Actor } from '../../common/actor.js';
import { type DeviceContext, deviceActor } from '../../common/auth/device-auth.guard.js';
import { AppError } from '../../common/http/api-exception.filter.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { type PrintJobStatus } from '../../generated/prisma/client.js';
import { StorageService } from '../files/storage.service.js';
import { OrderStateMachine, type Tx } from '../orders/order-state-machine.js';
import { RefundsService } from '../payments/refunds.service.js';
import { OrderAcceptanceService } from '../approval/order-acceptance.service.js';
import { PrintLeaseService, releaseLease } from '../printing/print-leases.service.js';
import { SHOP_JOB_INCLUDE, toShopJob } from './shop-job-view.js';
import { findShopOrder } from './shop-scope.js';

/** What the shop sees by default: everything from payment to pickup. */
const ACTIVE_STATUSES: OrderStatus[] = [
  OrderStatus.PENDING_REVIEW,
  OrderStatus.QUEUED,
  OrderStatus.PRINTING,
  OrderStatus.NEEDS_OPERATOR_CHECK,
  OrderStatus.READY_FOR_PICKUP,
];
/** Attempts a reprint replaces (everything except already-closed ones). */
const SUPERSEDABLE: PrintJobStatus[] = [
  'PREPARING',
  'READY',
  'LEASED',
  'SUBMITTED',
  'SPOOLER_COMPLETE',
  'FAILED',
  'UNCERTAIN',
];

/**
 * Operator actions on orders (PRD §11.2). Every query is scoped by the device's shopId
 * (CLAUDE.md invariant 10, see shop-scope.ts); another shop's order is indistinguishable
 * from a missing one.
 */
@Injectable()
export class ShopJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly stateMachine: OrderStateMachine,
    private readonly acceptance: OrderAcceptanceService,
    private readonly refunds: RefundsService,
    private readonly leases: PrintLeaseService,
  ) {}

  async list(device: DeviceContext, statuses?: OrderStatus[]): Promise<ShopJob[]> {
    const orders = await this.prisma.order.findMany({
      where: {
        shopId: device.shopId,
        status: { in: statuses?.length ? statuses : ACTIVE_STATUSES },
      },
      include: SHOP_JOB_INCLUDE,
      orderBy: [{ paidAt: 'asc' }, { createdAt: 'asc' }],
      take: 200,
    });
    return orders.map(toShopJob);
  }

  async detail(device: DeviceContext, orderId: string): Promise<ShopJobDetail> {
    const order = await this.findScoped(device, orderId);
    const original = order.files[0];
    const preview = original ? await this.storage.createDownloadUrl(original.objectKey) : null;
    return { ...toShopJob(order), previewUrl: preview?.url ?? null };
  }

  /**
   * Accept a paid order (FR-SHOP-07): the shared accept path also used by guarded auto-accept
   * (P2.6) — build the packet, then atomically queue it.
   */
  async accept(device: DeviceContext, orderId: string, printerId?: string): Promise<ShopJob> {
    await this.findScoped(device, orderId);
    await this.acceptance.accept({
      orderId,
      shopId: device.shopId,
      actor: deviceActor(device),
      ...(printerId ? { printerId } : {}),
    });
    return toShopJob(await this.findScoped(device, orderId));
  }

  /** Reject with a reason; a paid order gets a refund (simulated in demo) — FR-SHOP-07, T07. */
  async reject(device: DeviceContext, orderId: string, req: RejectJobRequest): Promise<ShopJob> {
    const order = await this.findScoped(device, orderId);
    const refundId = await this.prisma.$transaction(async (tx) => {
      await this.stateMachine.transition(tx, {
        orderId: order.id,
        to: OrderStatus.REJECTED,
        from: [OrderStatus.PENDING_REVIEW, OrderStatus.QUEUED],
        actor: deviceActor(device),
        reason: req.note ?? req.reasonCode,
        auditAction: 'order.rejected',
        metadata: { reasonCode: req.reasonCode },
        data: { rejectionCode: req.reasonCode, rejectionNote: req.note ?? null },
      });
      await tx.printJob.updateMany({
        where: { orderId: order.id, status: { in: ['PREPARING', 'READY'] } },
        data: { status: 'CANCELLED' },
      });
      return this.requestRefund(tx, order.id, deviceActor(device));
    });
    if (refundId) await this.refunds.execute(refundId);
    return toShopJob(await this.findScoped(device, orderId));
  }

  /**
   * Needs-check resolution (contract §2, P2.11, T14). Only from NEEDS_OPERATOR_CHECK.
   * CONFIRM_PRINTED → READY_FOR_PICKUP; REPRINT (needs confirm: true) supersedes the old
   * attempt and queues attempt+1 with the SAME packet and pickup number; MARK_FAILED → REJECTED
   * + refund. Each action writes one `ORDER_RESOLVE_<ACTION>` audit row.
   */
  async resolve(
    device: DeviceContext,
    orderId: string,
    req: ResolveJobRequest,
  ): Promise<ShopJobDetail> {
    if (req.action === ResolveAction.REPRINT && req.confirm !== true) {
      throw new AppError(
        'REPRINT_CONFIRM_REQUIRED',
        'Check the printer output tray first; reprinting needs explicit confirmation',
        HttpStatus.BAD_REQUEST,
      );
    }
    const order = await this.findScoped(device, orderId);
    if (order.status !== OrderStatus.NEEDS_OPERATOR_CHECK) {
      throw invalidState(order.status, 'resolved');
    }
    const actor = deviceActor(device);
    const auditAction = `ORDER_RESOLVE_${req.action}`;
    const note = req.note ?? null;

    const refundId = await this.prisma.$transaction(async (tx) => {
      const latest = await tx.printJob.findFirst({
        where: { orderId: order.id },
        orderBy: { attempt: 'desc' },
        include: { packetFile: true },
      });

      if (req.action === ResolveAction.CONFIRM_PRINTED) {
        await this.stateMachine.transition(tx, {
          orderId: order.id,
          to: OrderStatus.READY_FOR_PICKUP,
          from: OrderStatus.NEEDS_OPERATOR_CHECK,
          actor,
          reason: note ?? 'Operator confirmed the printed output',
          auditAction,
          auditMetadata: { printJobId: latest?.id ?? null, attempt: latest?.attempt ?? null, note },
          data: { readyAt: new Date() },
        });
        if (latest) await this.closeLease(tx, latest);
        return null;
      }

      if (req.action === ResolveAction.REPRINT) {
        if (!latest?.packetFile || !latest.checksum || latest.packetFile.deletedAt) {
          throw new AppError('PACKET_MISSING', 'The print packet is not available', 409);
        }
        const attempt = latest.attempt + 1;
        // Transition first (locks the order): a duplicate reprint fails here with 409.
        await this.stateMachine.transition(tx, {
          orderId: order.id,
          to: OrderStatus.QUEUED,
          from: OrderStatus.NEEDS_OPERATOR_CHECK,
          actor,
          reason: note ?? `Reprint confirmed (attempt ${attempt})`,
          auditAction,
          auditMetadata: { supersededPrintJobId: latest.id, attempt, note },
          metadata: { supersededPrintJobId: latest.id, attempt },
          data: { queuedAt: new Date() },
        });
        const old = await tx.printJob.findMany({
          where: { orderId: order.id, status: { in: SUPERSEDABLE } },
        });
        await tx.printJob.updateMany({
          where: { id: { in: old.map((j) => j.id) } },
          data: { status: 'SUPERSEDED', leaseUntil: null },
        });
        for (const j of old) {
          await releaseLease(tx, j.printerId, j.id);
          this.leases.publishJob(tx, j, device.shopId, 'SUPERSEDED');
        }
        const job = await tx.printJob.create({
          data: {
            orderId: order.id,
            printerId: latest.printerId,
            packetFileId: latest.packetFileId,
            attempt,
            status: 'READY',
            checksum: latest.checksum,
            createdById: actor.id,
          },
        });
        this.leases.publishJob(tx, job, device.shopId, 'READY');
        return null;
      }

      // MARK_FAILED
      await this.stateMachine.transition(tx, {
        orderId: order.id,
        to: OrderStatus.REJECTED,
        from: OrderStatus.NEEDS_OPERATOR_CHECK,
        actor,
        reason: note ?? 'Print failed',
        auditAction,
        auditMetadata: { printJobId: latest?.id ?? null, note },
        data: { rejectionCode: 'PRINT_FAILED', rejectionNote: note },
      });
      if (latest) await this.closeLease(tx, latest);
      return this.requestRefund(tx, order.id, actor);
    });

    if (refundId) await this.refunds.execute(refundId);
    return this.detail(device, orderId);
  }

  // ─── Helpers ───

  private findScoped(device: DeviceContext, orderId: string) {
    return findShopOrder(this.prisma, device.shopId, orderId, SHOP_JOB_INCLUDE);
  }

  /** The operator has decided this attempt's outcome: free the printer, stop the lease clock. */
  private async closeLease(tx: Tx, job: { id: string; printerId: string }): Promise<void> {
    await tx.printJob.updateMany({
      where: { id: job.id, leaseUntil: { not: null } },
      data: { leaseUntil: null },
    });
    await releaseLease(tx, job.printerId, job.id);
  }

  /**
   * The ONE call site into the refund workflow for shop rejections/failures (the refunds
   * service is being reworked: keep this minimal). Returns a refund id to execute after commit.
   */
  private requestRefund(tx: Tx, orderId: string, actor: Actor): Promise<string | null> {
    return this.refunds.openForRejectedOrder(tx, orderId, actor);
  }
}

function invalidState(status: string, action: string): AppError {
  return new AppError(
    'INVALID_TRANSITION',
    `An order that is ${status} cannot be ${action}`,
    HttpStatus.CONFLICT,
    { status },
  );
}
