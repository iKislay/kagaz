import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { type ShopMode, QuoteSchema, type UpdateShopModeRequest } from '@kagaz/shared';
import { type Actor, SYSTEM_ACTOR } from '../../common/actor.js';
import { APP_CONFIG } from '../../common/config/config.module.js';
import { type AppConfig } from '../../common/config/config.schema.js';
import { DomainEvent, DomainEventBus } from '../../common/events/domain-events.js';
import { AppError } from '../../common/http/api-exception.filter.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { type Tx } from '../orders/order-state-machine.js';
import { parseOptions } from '../orders/order-view.js';
import { AutoAcceptPolicy, type AutoAcceptResult } from './auto-accept.policy.js';
import { OrderAcceptanceService } from './order-acceptance.service.js';

const ACTIVE_JOB_STATUSES = ['PREPARING', 'READY', 'LEASED', 'SUBMITTED'] as const;

/**
 * Approval modes + guarded auto-accept (P2.6, PRD §8.3/8.4).
 * On payment verified the order always lands in PENDING_REVIEW first (with the evaluation in
 * the event metadata); if eligible, the same accept path as a manual Accept then runs with
 * actor SYSTEM → QUEUED. A crash in between leaves a normal PENDING_REVIEW order, never a
 * paid order stuck in AWAITING_PAYMENT.
 */
@Injectable()
export class ApprovalService {
  private readonly logger = new Logger(ApprovalService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly acceptance: OrderAcceptanceService,
    private readonly events: DomainEventBus,
  ) {}

  /** Evaluate PRD §8.4 for an order (inside a transaction or not). */
  async evaluate(orderId: string, db: Tx | PrismaService = this.prisma): Promise<AutoAcceptResult> {
    const order = await db.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        shop: true,
        files: { where: { kind: 'ORIGINAL', status: 'VALID' }, take: 1 },
      },
    });
    const printers = await db.printer.findMany({
      where: { shopId: order.shopId },
      include: { device: { select: { lastHeartbeatAt: true, status: true } } },
    });
    const depth = await db.printJob.groupBy({
      by: ['printerId'],
      where: { printer: { shopId: order.shopId }, status: { in: [...ACTIVE_JOB_STATUSES] } },
      _count: { _all: true },
    });
    const quoteRaw = order.priceSnapshot ?? order.quote;
    const quote = quoteRaw ? QuoteSchema.safeParse(quoteRaw) : null;
    const file = order.files[0];

    return AutoAcceptPolicy.evaluate(
      {
        options: parseOptions(order.options),
        pageCount: file?.pageCount ?? null,
        printedSides: quote?.success ? quote.data.printedSides : null,
        fileValid: !!file,
      },
      order.shop,
      printers.map((p) => ({
        id: p.id,
        enabled: p.enabled,
        capabilitiesConfirmed: p.capabilitiesConfirmed,
        colourCapable: p.colourCapable,
        duplexCapable: p.duplexCapable,
        paperSizes: p.paperSizes,
        isDefault: p.isDefault,
        status: p.status,
        deviceLastHeartbeatAt:
          p.device && p.device.status === 'ACTIVE' ? p.device.lastHeartbeatAt : null,
      })),
      { depthByPrinter: Object.fromEntries(depth.map((d) => [d.printerId, d._count._all])) },
      { now: new Date(), onlineThresholdSeconds: this.config.DEVICE_ONLINE_THRESHOLD_SECONDS },
    );
  }

  /**
   * After the paid transition committed: re-check (state may have changed) and, if still
   * eligible, accept as SYSTEM. Never throws — the order simply stays in PENDING_REVIEW.
   */
  async autoAcceptIfEligible(orderId: string): Promise<boolean> {
    try {
      const result = await this.evaluate(orderId);
      if (!result.eligible || !result.printerId) return false;
      const order = await this.prisma.order.findUniqueOrThrow({
        where: { id: orderId },
        select: { shopId: true },
      });
      await this.acceptance.accept({
        orderId,
        shopId: order.shopId,
        actor: SYSTEM_ACTOR,
        printerId: result.printerId,
        auditAction: 'order.auto_accepted',
        metadata: { autoAccepted: true },
      });
      return true;
    } catch (err) {
      this.logger.warn({ err, orderId }, 'auto-accept did not complete; order stays in review');
      await this.prisma.auditLog
        .create({
          data: {
            actorType: 'SYSTEM',
            orderId,
            action: 'order.auto_accept_failed',
            metadata: { error: err instanceof Error ? err.message : String(err) },
          },
        })
        .catch(() => undefined);
      return false;
    }
  }

  async getMode(shopId: string): Promise<ShopMode> {
    const shop = await this.prisma.shop.findUniqueOrThrow({
      where: { id: shopId },
      select: { approvalMode: true, autoPaused: true },
    });
    return shop;
  }

  /** PATCH /api/shop/mode (contract §3): audited SHOP_MODE_CHANGED + realtime hint. */
  async setMode(shopId: string, req: UpdateShopModeRequest, actor: Actor): Promise<ShopMode> {
    if (req.approvalMode === undefined && req.autoPaused === undefined) {
      throw new AppError(
        'VALIDATION_FAILED',
        'Send approvalMode and/or autoPaused',
        HttpStatus.BAD_REQUEST,
      );
    }
    const { before, after } = await this.prisma.$transaction(async (tx) => {
      const before = await tx.shop.findUniqueOrThrow({
        where: { id: shopId },
        select: { approvalMode: true, autoPaused: true },
      });
      const after = await tx.shop.update({
        where: { id: shopId },
        data: {
          ...(req.approvalMode === undefined ? {} : { approvalMode: req.approvalMode }),
          ...(req.autoPaused === undefined ? {} : { autoPaused: req.autoPaused }),
        },
        select: { approvalMode: true, autoPaused: true },
      });
      await tx.auditLog.create({
        data: {
          actorType: actor.type,
          actorId: actor.id,
          shopId,
          action: 'SHOP_MODE_CHANGED',
          metadata: { before, after },
        },
      });
      return { before, after };
    });
    if (before.approvalMode !== after.approvalMode || before.autoPaused !== after.autoPaused) {
      this.events.publish(this.prisma, DomainEvent.SHOP_MODE_CHANGED, { shopId, ...after });
    }
    return after;
  }
}
