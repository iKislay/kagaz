import { randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { type PrintOptions, parsePageRange } from '@kagaz/shared';
import { APP_CONFIG } from '../../common/config/config.module.js';
import { type AppConfig } from '../../common/config/config.schema.js';
import { AppError } from '../../common/http/api-exception.filter.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { StorageService } from '../files/storage.service.js';
import { PickupCrypto } from '../pickup/pickup-crypto.js';
import { buildPrintPacket } from './packet-builder.js';

export interface PreparedPacket {
  objectKey: string;
  sha256: string;
  pageCount: number;
  bytes: number;
  /** Plaintext pickup code — only held in memory to print the slip and hash/encrypt it. */
  code: string;
}

/**
 * Builds and stores the combined print packet for an accepted order (PRD §8.6):
 * generates the pickup code, renders customer pages × copies + spacers + slip into one PDF,
 * and uploads it privately. Database rows are written by the caller in its transaction.
 */
@Injectable()
export class PrintPreparationService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly pickup: PickupCrypto,
  ) {}

  async prepare(orderId: string, options: PrintOptions): Promise<PreparedPacket> {
    const order = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        shop: { select: { name: true, isDemo: true } },
        files: { where: { kind: 'ORIGINAL', status: 'VALID' }, take: 1 },
      },
    });
    const original = order.files[0];
    if (!original?.pageCount) {
      throw new AppError(
        'FILE_MISSING',
        'The customer file is no longer available',
        HttpStatus.CONFLICT,
      );
    }

    const source = await this.storage.getBuffer(original.objectKey, this.config.MAX_UPLOAD_BYTES);
    const code = this.pickup.generate();
    const packet = await buildPrintPacket(
      source,
      { pageRange: options.pageRange, copies: options.copies, duplex: options.duplex },
      {
        code,
        publicRef: order.publicRef,
        shopName: order.shop.name,
        pages: parsePageRange(options.pageRange, original.pageCount).length,
        copies: options.copies,
        colour: options.colour,
        duplex: options.duplex,
        printedAt: new Date(),
        isDemo: order.shop.isDemo,
      },
    );

    const objectKey = `orders/${order.id}/packet/${randomUUID()}.pdf`;
    await this.storage.put(objectKey, packet.bytes, 'application/pdf');
    return {
      objectKey,
      sha256: packet.sha256,
      pageCount: packet.pageCount,
      bytes: packet.bytes.length,
      code,
    };
  }

  /** Best-effort cleanup when the surrounding transaction did not commit. */
  async discard(objectKey: string): Promise<void> {
    await this.storage.delete(objectKey).catch(() => undefined);
  }
}
