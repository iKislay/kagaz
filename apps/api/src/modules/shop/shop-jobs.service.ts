import { HttpStatus, Injectable } from '@nestjs/common';
import {
  OrderStatus,
  type RejectJobRequest,
  type ShopJob,
  type ShopJobDetail,
  type VerifyPickupResponse,
} from '@kagaz/shared';
import { type DeviceContext, deviceActor } from '../../common/auth/device-auth.guard.js';
import { AppError } from '../../common/http/api-exception.filter.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { StorageService } from '../files/storage.service.js';
import { OrderStateMachine, type Tx } from '../orders/order-state-machine.js';
import { parseOptions } from '../orders/order-view.js';
import { RefundsService } from '../payments/refunds.service.js';
import { OrderAcceptanceService } from '../approval/order-acceptance.service.js';
import { PickupCrypto } from '../pickup/pickup-crypto.js';
import { SHOP_JOB_INCLUDE, toShopJob } from './shop-job-view.js';

/** What the shop sees by default: everything from payment to pickup. */
const ACTIVE_STATUSES: OrderStatus[] = [
  OrderStatus.PENDING_REVIEW,
  OrderStatus.QUEUED,
  OrderStatus.PRINTING,
  OrderStatus.NEEDS_OPERATOR_CHECK,
  OrderStatus.READY_FOR_PICKUP,
];
const PICKUP_CODE_VALID_DAYS = 7;

/**
 * Operator actions on orders (PRD §11.2). Every query is scoped by the device's shopId
 * (CLAUDE.md invariant 10); another shop's order is indistinguishable from a missing one.
 */
@Injectable()
export class ShopJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly stateMachine: OrderStateMachine,
    private readonly acceptance: OrderAcceptanceService,
    private readonly refunds: RefundsService,
    private readonly pickup: PickupCrypto,
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
      return this.refunds.openForRejectedOrder(tx, order.id, deviceActor(device));
    });
    if (refundId) await this.refunds.execute(refundId);
    return toShopJob(await this.findScoped(device, orderId));
  }

  /**
   * Operator confirms the physical stack + slip (FR-SHOP-12). Spooler status alone is never
   * enough (CLAUDE.md invariant 9): the job must at least have been submitted.
   */
  async markReady(device: DeviceContext, orderId: string): Promise<ShopJob> {
    const order = await this.findScoped(device, orderId);
    const job = order.printJobs[0];
    if (order.status !== OrderStatus.PRINTING) throw invalidState(order.status, 'marked ready');
    if (!job || (job.status !== 'SUBMITTED' && job.status !== 'SPOOLER_COMPLETE')) {
      throw new AppError(
        'PRINT_NOT_SUBMITTED',
        'The print job has not been sent to the printer yet',
        HttpStatus.CONFLICT,
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await this.stateMachine.transition(tx, {
        orderId: order.id,
        to: OrderStatus.READY_FOR_PICKUP,
        from: OrderStatus.PRINTING,
        actor: deviceActor(device),
        auditAction: 'order.ready',
        data: { readyAt: new Date() },
      });
      await tx.pickupCode.update({
        where: { orderId: order.id },
        data: { expiresAt: new Date(Date.now() + PICKUP_CODE_VALID_DAYS * 86_400_000) },
      });
      await releaseLease(tx, job.printerId, job.id);
    });
    return toShopJob(await this.findScoped(device, orderId));
  }

  /** One-time pickup code check → COLLECTED (FR-PICK-03/04, T15). Failures are audited. */
  async verifyPickup(device: DeviceContext, input: string): Promise<VerifyPickupResponse> {
    const code = this.pickup.normalize(input);
    const row = code
      ? await this.prisma.pickupCode.findFirst({
          where: { codeHmac: this.pickup.hmac(code), order: { shopId: device.shopId } },
          include: { order: { include: SHOP_JOB_INCLUDE } },
        })
      : null;

    if (!row) {
      await this.auditPickup(device, null, 'pickup.failed', { reason: 'unknown_code' });
      throw new AppError('PICKUP_CODE_INVALID', 'No order matches this code', HttpStatus.NOT_FOUND);
    }
    if (row.consumedAt) {
      await this.auditPickup(device, row.orderId, 'pickup.reused', {});
      throw new AppError(
        'PICKUP_ALREADY_USED',
        `This code was already used for ${row.order.publicRef}`,
        HttpStatus.CONFLICT,
      );
    }
    if (row.order.status !== OrderStatus.READY_FOR_PICKUP) {
      throw new AppError('ORDER_NOT_READY', `${row.order.publicRef} is not ready yet`, 409);
    }

    const collectedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.pickupCode.updateMany({
        where: { id: row.id, consumedAt: null },
        data: {
          consumedAt: collectedAt,
          consumedByDeviceId: device.deviceId,
          encryptedDisplayValue: null, // no longer needed once collected
        },
      });
      if (consumed.count !== 1) {
        throw new AppError('PICKUP_ALREADY_USED', 'This code was already used', 409);
      }
      await this.stateMachine.transition(tx, {
        orderId: row.orderId,
        to: OrderStatus.COLLECTED,
        from: OrderStatus.READY_FOR_PICKUP,
        actor: deviceActor(device),
        auditAction: 'pickup.verified',
        data: { collectedAt },
      });
    });

    return {
      orderId: row.orderId,
      publicRef: row.order.publicRef,
      status: OrderStatus.COLLECTED,
      options: parseOptions(row.order.options),
      pageCount: row.order.files[0]?.pageCount ?? null,
      collectedAt: collectedAt.toISOString(),
    };
  }

  // ─── Helpers ───

  private async findScoped(device: DeviceContext, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, shopId: device.shopId },
      include: SHOP_JOB_INCLUDE,
    });
    if (!order) throw new AppError('ORDER_NOT_FOUND', 'Order not found', HttpStatus.NOT_FOUND);
    return order;
  }

  private async auditPickup(
    device: DeviceContext,
    orderId: string | null,
    action: string,
    metadata: Record<string, string>,
  ) {
    await this.prisma.auditLog.create({
      data: {
        actorType: 'DEVICE',
        actorId: device.deviceId,
        shopId: device.shopId,
        orderId,
        action,
        metadata,
      },
    });
  }
}

/** Free the printer if this job still holds its lease. */
export async function releaseLease(tx: Tx, printerId: string, jobId: string): Promise<void> {
  await tx.printer.updateMany({
    where: { id: printerId, activeJobId: jobId },
    data: { activeJobId: null, leaseUntil: null },
  });
}

function invalidState(status: string, action: string): AppError {
  return new AppError(
    'INVALID_TRANSITION',
    `An order that is ${status} cannot be ${action}`,
    HttpStatus.CONFLICT,
    { status },
  );
}
