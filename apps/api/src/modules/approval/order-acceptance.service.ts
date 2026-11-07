import { HttpStatus, Injectable } from '@nestjs/common';
import { OrderStatus, type PrintOptions } from '@kagaz/shared';
import { type Actor } from '../../common/actor.js';
import { AppError } from '../../common/http/api-exception.filter.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { type Prisma } from '../../generated/prisma/client.js';
import { OrderStateMachine } from '../orders/order-state-machine.js';
import { parseOptions } from '../orders/order-view.js';
import { PickupCrypto } from '../pickup/pickup-crypto.js';
import { PrintPreparationService } from '../printing/print-preparation.service.js';

export interface AcceptOrderParams {
  orderId: string;
  /** The caller's shop (device identity, or the order's own shop for SYSTEM auto-accept). */
  shopId: string;
  actor: Actor;
  printerId?: string;
  auditAction?: string;
  metadata?: Record<string, Prisma.InputJsonValue>;
}

/**
 * The ONE accept path (FR-SHOP-07, P2.6): used by the operator's Accept and by guarded
 * auto-accept with actor SYSTEM. Builds the packet, then atomically creates the packet file,
 * pickup code and print job (attempt 1) and moves PENDING_REVIEW → QUEUED.
 */
@Injectable()
export class OrderAcceptanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stateMachine: OrderStateMachine,
    private readonly preparation: PrintPreparationService,
    private readonly pickup: PickupCrypto,
  ) {}

  async accept(params: AcceptOrderParams): Promise<void> {
    const order = await this.prisma.order.findFirst({
      where: { id: params.orderId, shopId: params.shopId },
    });
    if (!order) throw new AppError('ORDER_NOT_FOUND', 'Order not found', HttpStatus.NOT_FOUND);
    if (order.status !== OrderStatus.PENDING_REVIEW) {
      throw new AppError(
        'INVALID_TRANSITION',
        `An order that is ${order.status} cannot be accepted`,
        HttpStatus.CONFLICT,
        { status: order.status },
      );
    }
    const options = parseOptions(order.options);
    const printer = await this.choosePrinter(params.shopId, options, params.printerId);

    const packet = await this.preparation.prepare(order.id, options);
    try {
      await this.prisma.$transaction(async (tx) => {
        const packetFile = await tx.fileAsset.create({
          data: {
            orderId: order.id,
            kind: 'PACKET',
            status: 'VALID',
            objectKey: packet.objectKey,
            bytes: packet.bytes,
            pageCount: packet.pageCount,
            sha256: packet.sha256,
          },
        });
        await tx.pickupCode.create({
          data: {
            orderId: order.id,
            codeHmac: this.pickup.hmac(packet.code),
            encryptedDisplayValue: this.pickup.encrypt(packet.code),
          },
        });
        await tx.printJob.create({
          data: {
            orderId: order.id,
            printerId: printer.id,
            packetFileId: packetFile.id,
            attempt: 1,
            status: 'READY',
            checksum: packet.sha256,
            createdById: params.actor.id,
          },
        });
        await this.stateMachine.transition(tx, {
          orderId: order.id,
          to: OrderStatus.QUEUED,
          from: OrderStatus.PENDING_REVIEW,
          actor: params.actor,
          auditAction: params.auditAction ?? 'order.accepted',
          metadata: { printerId: printer.id, ...params.metadata },
          data: { printerId: printer.id, queuedAt: new Date() },
        });
      });
    } catch (err) {
      await this.preparation.discard(packet.objectKey);
      throw err;
    }
  }

  /** PRD §8.5: explicit printer, else an enabled capable printer, default first. */
  private async choosePrinter(shopId: string, options: PrintOptions, printerId?: string) {
    const printers = await this.prisma.printer.findMany({
      where: {
        shopId,
        enabled: true,
        ...(printerId ? { id: printerId } : {}),
        ...(options.colour ? { colourCapable: true } : {}),
        ...(options.duplex ? { duplexCapable: true } : {}),
      },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    const printer = printers[0];
    if (!printer) {
      throw new AppError(
        'NO_SUITABLE_PRINTER',
        'No enabled printer in this shop supports these print options',
        HttpStatus.CONFLICT,
      );
    }
    return printer;
  }
}
