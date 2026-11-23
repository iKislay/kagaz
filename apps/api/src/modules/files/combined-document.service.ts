import { randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG } from '../../common/config/config.module.js';
import { type AppConfig } from '../../common/config/config.schema.js';
import { AppError } from '../../common/http/api-exception.filter.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { tenantWhere } from '../../common/prisma/tenant-scope.js';
import { PRINTABLE_FILES, printOrder, totalPages } from '../orders/order-view.js';
import { combinePdfs } from './combine.js';
import { StorageService } from './storage.service.js';

export interface CustomerDocument {
  /** Private bucket key of ONE PDF holding all the customer's pages in print order. */
  objectKey: string;
  pageCount: number;
  /** Upper bound for reading it back into memory. */
  maxBytes: number;
}

/**
 * The customer's document of a paid order as a single PDF (ADR-005). One file → that file. Several
 * → their merge, built once and kept as a COMBINED file (files can't change after payment), so
 * the shop app's one preview link and the print packet both see every page, in order, with no
 * change to the shop app.
 */
@Injectable()
export class CombinedDocumentService {
  private readonly logger = new Logger(CombinedDocumentService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async forOrder(orderId: string): Promise<CustomerDocument | null> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId, ...tenantWhere() },
      select: { id: true, files: PRINTABLE_FILES },
    });
    if (!order) throw new AppError('ORDER_NOT_FOUND', 'Order not found', HttpStatus.NOT_FOUND);
    const files = printOrder(order.files);
    if (files.length === 0) return null;
    const pageCount = totalPages(files);
    const maxBytes = this.config.MAX_UPLOAD_BYTES * Math.max(1, files.length);
    if (files.length === 1) return { objectKey: files[0]!.objectKey, pageCount, maxBytes };

    const cached = await this.findCombined(order.id);
    if (cached) return { objectKey: cached, pageCount, maxBytes };

    const sources: Uint8Array[] = [];
    for (const f of files) {
      sources.push(await this.storage.getBuffer(f.objectKey, this.config.MAX_UPLOAD_BYTES));
    }
    const combined = await combinePdfs(sources);
    if (combined.pageCount !== pageCount) {
      throw new AppError('FILE_CORRUPT', 'The customer files could not be combined', 500);
    }
    const objectKey = `orders/${order.id}/combined/${randomUUID()}.pdf`;
    await this.storage.put(objectKey, combined.bytes, 'application/pdf');

    const winner = await this.prisma.$transaction(async (tx) => {
      // Serialise with a concurrent build for the same order (raw SQL: not tenant-inspected,
      // the order was found within this request's tenant above).
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${order.id}::uuid FOR UPDATE`;
      const existing = await this.findCombined(order.id, tx);
      if (existing) return existing;
      await tx.fileAsset.create({
        data: {
          orderId: order.id,
          kind: 'COMBINED',
          status: 'VALID',
          objectKey,
          mime: 'application/pdf',
          bytes: combined.bytes.length,
          pageCount: combined.pageCount,
          sha256: combined.sha256,
        },
      });
      return objectKey;
    });
    if (winner !== objectKey) {
      await this.storage.delete(objectKey).catch((err: unknown) => {
        this.logger.warn({ err, orderId }, 'failed to delete duplicate combined document');
      });
    }
    return { objectKey: winner, pageCount, maxBytes };
  }

  private async findCombined(
    orderId: string,
    db: Pick<PrismaService, 'fileAsset'> = this.prisma,
  ): Promise<string | null> {
    const file = await db.fileAsset.findFirst({
      where: { orderId, kind: 'COMBINED', status: 'VALID' },
      orderBy: { createdAt: 'desc' },
      select: { objectKey: true },
    });
    return file?.objectKey ?? null;
  }
}
