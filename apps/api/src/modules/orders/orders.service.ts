import { randomUUID } from 'node:crypto';
import { type Readable } from 'node:stream';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  type CreateOrderRequest,
  OrderStatus,
  PageRangeError,
  type PrintOptions,
  type PublicOrder,
  type Quote,
  type UploadUrlResponse,
  reorderPositions,
  sortByPosition,
} from '@kagaz/shared';
import { type Actor } from '../../common/actor.js';
import { APP_CONFIG } from '../../common/config/config.module.js';
import { type AppConfig } from '../../common/config/config.schema.js';
import { generateToken, randomCode, sha256Hex } from '../../common/crypto/tokens.js';
import { AppError } from '../../common/http/api-exception.filter.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PdfValidationError } from '../files/pdf-validator.js';
import { StorageService } from '../files/storage.service.js';
import { validateUpload } from '../files/upload-validator.js';
import { PricingService } from '../pricing/pricing.service.js';
import { calculateQuote } from '../pricing/quote.js';
import { ShopsService } from '../shops/shops.service.js';
import { OrderStateMachine } from './order-state-machine.js';
import {
  ORDER_VIEW_INCLUDE,
  PAYMENT_IN_FLIGHT,
  PRINTABLE_FILES,
  canCustomerCancel,
  parseOptions,
  toPublicOrder,
  totalPages,
} from './order-view.js';

const PDF = 'application/pdf';
/** Uploads are opaque bytes until upload-complete sniffs them (PDF, JPEG, PNG, WebP). */
const UPLOAD_MIME = 'application/octet-stream';
/** Pending uploads older than this (URL long expired) no longer count toward the file limit. */
const STALE_PENDING_MS = 3600_000;
/** Options and files can change until a payment exists for the order. */
const EDITABLE: readonly OrderStatus[] = [OrderStatus.DRAFT, OrderStatus.AWAITING_PAYMENT];

type Tx = Prisma.TransactionClient;
type Requote = { ok: true } | { ok: false; error: AppError };

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly pricing: PricingService,
    private readonly shops: ShopsService,
    private readonly stateMachine: OrderStateMachine,
  ) {}

  // ─── Queries ───

  async getPublic(orderId: string): Promise<PublicOrder> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: ORDER_VIEW_INCLUDE,
    });
    if (!order) throw notFound();
    return toPublicOrder(order);
  }

  /** Session check used by the customer guard: is this the signed-in customer's order? */
  async findByCustomer(orderId: string, customerId: string): Promise<{ id: string } | null> {
    return this.prisma.order.findFirst({
      where: { id: orderId, customerId },
      select: { id: true },
    });
  }

  /** Tracking-token check used by the customer guard. Unknown id or bad token → null. */
  async findByTrackingToken(orderId: string, token: string): Promise<{ id: string } | null> {
    return this.prisma.order.findFirst({
      where: { id: orderId, trackingTokenHash: sha256Hex(token) },
      select: { id: true },
    });
  }

  /**
   * The stored, printable PDF of one of the order's files, for the customer's print preview
   * (images are already their A4 page). Streamed through the API behind the tracking-token guard,
   * so the private bucket needs no CORS for reads.
   */
  async fileContent(orderId: string, fileId: string): Promise<{ body: Readable; bytes: number }> {
    const file = await this.prisma.fileAsset.findFirst({
      where: { id: fileId, orderId, kind: 'ORIGINAL', status: 'VALID' },
      select: { objectKey: true },
    });
    const object = file ? await this.storage.getStream(file.objectKey) : null;
    if (!object) throw new AppError('FILE_NOT_FOUND', 'File not found', HttpStatus.NOT_FOUND);
    return object;
  }

  // ─── Commands ───

  /** `customer`: the signed-in customer (P2.2) — the order is linked to their account. */
  async createDraft(
    req: CreateOrderRequest,
    actor: Actor,
    customer?: { customerId: string; phone: string } | null,
  ): Promise<{ order: PublicOrder; trackingToken: string }> {
    await this.shops.requireOrderableShop(req.shopId);
    await this.assertOptionsAllowed(req.shopId, req.options);

    const trackingToken = generateToken();
    const expiresAt = new Date(Date.now() + this.config.UNPAID_ORDER_EXPIRY_HOURS * 3600_000);

    for (let attempt = 0; ; attempt++) {
      try {
        const created = await this.prisma.$transaction(async (tx) => {
          const order = await tx.order.create({
            data: {
              publicRef: `KGZ-${randomCode(6)}`,
              shopId: req.shopId,
              customerId: customer?.customerId ?? null,
              customerPhone: customer?.phone ?? req.customerPhone ?? null,
              options: req.options,
              trackingTokenHash: sha256Hex(trackingToken),
              expiresAt,
            },
          });
          await this.stateMachine.recordCreated(tx, order, actor);
          return order;
        });
        return { order: await this.getPublic(created.id), trackingToken };
      } catch (err) {
        // Retry on the (unlikely) public_ref collision; 32^6 ≈ 1e9 refs.
        if (isUniqueViolation(err, 'public_ref') && attempt < 3) continue;
        throw err;
      }
    }
  }

  /**
   * Sign a direct browser → storage PUT for one more file (ADR-005: an order holds several PDFs
   * and images). Allowed until a payment exists. What the file is gets decided from its content
   * at upload-complete, so the URL is signed for opaque bytes.
   */
  async requestUploadUrl(orderId: string, bytes: number): Promise<UploadUrlResponse> {
    if (bytes > this.config.MAX_UPLOAD_BYTES) {
      throw new AppError(
        'FILE_TOO_LARGE',
        `Files can be at most ${Math.floor(this.config.MAX_UPLOAD_BYTES / 1024 / 1024)} MB`,
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }

    const file = await this.prisma.$transaction(async (tx) => {
      const order = await this.lockEditable(tx, orderId, 'Files can no longer be added');
      const recent = new Date(Date.now() - STALE_PENDING_MS);
      const files = await tx.fileAsset.findMany({
        where: {
          orderId: order.id,
          kind: 'ORIGINAL',
          OR: [{ status: 'VALID' }, { status: 'PENDING_UPLOAD', createdAt: { gt: recent } }],
        },
        select: { position: true },
      });
      if (files.length >= this.config.MAX_FILES_PER_ORDER) {
        throw new AppError(
          'TOO_MANY_FILES',
          `An order can have at most ${this.config.MAX_FILES_PER_ORDER} files`,
          HttpStatus.CONFLICT,
        );
      }
      const position = Math.max(-1, ...files.map((f) => f.position ?? -1)) + 1;
      // Key never contains the customer's filename (PRD FR-FILE-01).
      return tx.fileAsset.create({
        data: {
          orderId: order.id,
          kind: 'ORIGINAL',
          objectKey: `orders/${order.id}/upload/${randomUUID()}`,
          mime: UPLOAD_MIME,
          bytes,
          position,
        },
      });
    });

    const upload = await this.storage.createUploadUrl(file.objectKey, UPLOAD_MIME, bytes);
    return {
      fileId: file.id,
      uploadUrl: upload.url,
      method: 'PUT',
      headers: upload.headers,
      expiresAt: upload.expiresAt.toISOString(),
    };
  }

  /**
   * Validate the uploaded bytes by content, never filename/MIME (invariant 11): a PDF is checked
   * as is; a JPEG/PNG/WebP is decoded and becomes a one-page A4 PDF (ADR-005). Then re-quote over
   * all files and move DRAFT → AWAITING_PAYMENT when the options fit the combined document.
   */
  async completeUpload(orderId: string, fileId: string, actor: Actor): Promise<PublicOrder> {
    const file = await this.prisma.fileAsset.findFirst({
      where: { id: fileId, orderId, kind: 'ORIGINAL' },
      include: { order: true },
    });
    if (!file) throw new AppError('FILE_NOT_FOUND', 'Upload not found', HttpStatus.NOT_FOUND);
    if (file.status === 'VALID') return this.getPublic(orderId); // idempotent replay
    if (file.status !== 'PENDING_UPLOAD' || !EDITABLE.includes(file.order.status)) {
      throw new AppError('ORDER_NOT_EDITABLE', 'This upload can no longer be completed', 409);
    }

    const head = await this.storage.head(file.objectKey);
    if (!head) {
      throw new AppError('FILE_MISSING', 'The file was not uploaded yet', HttpStatus.CONFLICT);
    }

    let validated;
    try {
      if (head.bytes > this.config.MAX_UPLOAD_BYTES) throw new PdfValidationError('FILE_TOO_LARGE');
      const buffer = await this.storage.getBuffer(file.objectKey, this.config.MAX_UPLOAD_BYTES);
      validated = await validateUpload(buffer, {
        maxBytes: this.config.MAX_UPLOAD_BYTES,
        maxPages: this.config.MAX_PAGES,
        maxImagePixels: this.config.MAX_IMAGE_PIXELS,
      });
    } catch (err) {
      if (!(err instanceof PdfValidationError)) throw err;
      await this.prisma.fileAsset.updateMany({
        where: { id: file.id, status: 'PENDING_UPLOAD' },
        data: { status: 'INVALID', error: err.code, bytes: head.bytes },
      });
      await this.storage.delete(file.objectKey).catch((e: unknown) => {
        this.logger.warn({ err: e, orderId, fileId: file.id }, 'failed to delete invalid upload');
      });
      throw new AppError(err.code, err.message, HttpStatus.UNPROCESSABLE_ENTITY);
    }

    // The stored, printable file is always a PDF (an image's is the converted page).
    const objectKey = `orders/${orderId}/original/${randomUUID()}.pdf`;
    await this.storage.put(objectKey, validated.pdf, PDF);

    // Assigned inside the transaction callback (TS can't see that, hence the cast).
    let requote = { ok: true } as Requote;
    let recorded = false;
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.lockEditable(tx, orderId, 'This upload can no longer be completed');
        const marked = await tx.fileAsset.updateMany({
          where: { id: file.id, status: 'PENDING_UPLOAD' },
          data: {
            status: 'VALID',
            objectKey,
            mime: PDF,
            bytes: validated.bytes,
            pageCount: validated.pageCount,
            sha256: validated.sha256,
            sourceType: validated.sourceType,
          },
        });
        if (marked.count !== 1) return; // removed meanwhile, or a concurrent completion won
        recorded = true;
        requote = await this.requote(tx, orderId, actor);
      });
    } finally {
      // Keep exactly one copy: the stored PDF if it was recorded, else neither.
      await this.storage
        .delete(recorded ? file.objectKey : objectKey)
        .catch((e: unknown) => this.logger.warn({ err: e, orderId, fileId }, 'upload cleanup'));
    }

    if (!requote.ok) throw requote.error; // file is valid; customer must fix the options
    return this.getPublic(orderId);
  }

  /**
   * DELETE /api/orders/:id/files/:fileId — remove a file, or cancel one still uploading, before
   * payment. Idempotent. Re-quotes over the remaining files: with none left (or a page range
   * that no longer fits) the order has no price and can't be paid until that is fixed.
   */
  async removeFile(orderId: string, fileId: string, actor: Actor): Promise<PublicOrder> {
    const removed = await this.prisma.$transaction(async (tx) => {
      const file = await tx.fileAsset.findFirst({
        where: { id: fileId, orderId, kind: 'ORIGINAL' },
      });
      if (!file) throw new AppError('FILE_NOT_FOUND', 'File not found', HttpStatus.NOT_FOUND);
      if (file.status === 'DELETED') return null;
      await this.lockEditable(tx, orderId, 'Files can no longer be removed');
      // deletedAt stays null: a cancelled upload may still land after this, so retention
      // deletes the object (again) once the order closes.
      const marked = await tx.fileAsset.updateMany({
        where: { id: file.id, status: { not: 'DELETED' } },
        data: { status: 'DELETED' },
      });
      if (marked.count === 1 && file.status === 'VALID') await this.requote(tx, orderId, actor);
      return file;
    });
    if (removed) {
      await this.storage.delete(removed.objectKey).catch((e: unknown) => {
        this.logger.warn({ err: e, orderId, fileId }, 'failed to delete removed file');
      });
    }
    return this.getPublic(orderId);
  }

  /** PUT /api/orders/:id/files/order — set the print order before payment (ADR-005). */
  async reorderFiles(orderId: string, fileIds: readonly string[]): Promise<PublicOrder> {
    await this.prisma.$transaction(async (tx) => {
      await this.lockEditable(tx, orderId, 'Files can no longer be reordered');
      const files = await tx.fileAsset.findMany({
        where: { orderId, kind: 'ORIGINAL', status: { in: ['PENDING_UPLOAD', 'VALID'] } },
        select: { id: true, position: true, createdAt: true },
      });
      const positions = reorderPositions(
        sortByPosition(files).map((f) => f.id),
        fileIds,
      );
      for (const f of files) {
        const position = positions.get(f.id)!;
        if (f.position !== position) {
          await tx.fileAsset.update({ where: { id: f.id }, data: { position } });
        }
      }
      // Same total pages → same price. A page range now picks other pages; the preview shows it.
    });
    return this.getPublic(orderId);
  }

  /** Change print options before payment; re-quotes and advances DRAFT when possible. */
  async updateOptions(orderId: string, options: PrintOptions, actor: Actor): Promise<PublicOrder> {
    const before = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!before) throw notFound();
    await this.assertOptionsAllowed(before.shopId, options);

    // Under the order lock: files may be completing at the same time (ADR-005), and the quote
    // must count exactly the files that are there.
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
      const order = await tx.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { files: PRINTABLE_FILES, _count: { select: { payments: true } } },
      });
      if (!EDITABLE.includes(order.status)) {
        throw new AppError('ORDER_NOT_EDITABLE', 'Options can no longer be changed', 409);
      }
      if (order._count.payments) {
        throw new AppError(
          'ORDER_LOCKED_FOR_PAYMENT',
          'Payment already started for this order',
          409,
        );
      }
      const pageCount = totalPages(order.files);
      const quote = pageCount ? await this.tryQuote(order.shopId, options, pageCount) : null;
      if (quote && !quote.ok) throw quote.error;

      const updated = await this.stateMachine.updateFields(tx, order, EDITABLE, {
        options,
        quote: quote?.ok ? quote.quote : Prisma.DbNull,
        amountPaise: quote?.ok ? quote.quote.totalPaise : null,
      });
      if (updated.status === OrderStatus.DRAFT && quote?.ok) {
        await this.stateMachine.transition(tx, {
          orderId,
          to: OrderStatus.AWAITING_PAYMENT,
          from: OrderStatus.DRAFT,
          actor,
        });
      }
    });
    return this.getPublic(orderId);
  }

  /**
   * POST /api/orders/:id/cancel (FR-CUST-12, P3.6): only before payment. Refused while a
   * payment is in flight or done — after payment only the shop/admin can reject (→ refund).
   */
  async cancel(orderId: string, actor: Actor): Promise<PublicOrder> {
    await this.prisma.$transaction(async (tx) => {
      // Same lock as pay(): a cancel and a pay for one order never interleave.
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { payments: { select: { status: true } } },
      });
      if (!order) throw notFound();
      if (order.status === OrderStatus.CANCELLED) return; // idempotent
      if (order.payments.some((p) => (PAYMENT_IN_FLIGHT as readonly string[]).includes(p.status))) {
        throw new AppError(
          'PAYMENT_IN_PROGRESS',
          'This order has a payment in progress or completed; it can no longer be cancelled here',
          HttpStatus.CONFLICT,
        );
      }
      if (!canCustomerCancel(order)) {
        throw new AppError(
          'ORDER_NOT_CANCELLABLE',
          'Only orders that have not been paid can be cancelled',
          HttpStatus.CONFLICT,
          { status: order.status },
        );
      }
      await this.stateMachine.transition(tx, {
        orderId,
        to: OrderStatus.CANCELLED,
        from: [OrderStatus.DRAFT, OrderStatus.AWAITING_PAYMENT],
        actor,
        reason: 'Cancelled by customer',
      });
    });
    return this.getPublic(orderId);
  }

  // ─── Helpers ───

  /**
   * Lock the order row (same lock as pay() and cancel()) and require that its files can still
   * change: DRAFT/AWAITING_PAYMENT with no payment attempt.
   */
  private async lockEditable(tx: Tx, orderId: string, message: string) {
    await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId}::uuid FOR UPDATE`;
    const order = await tx.order.findUnique({
      where: { id: orderId },
      include: { _count: { select: { payments: true } } },
    });
    if (!order) throw notFound();
    if (!EDITABLE.includes(order.status) || order._count.payments > 0) {
      throw new AppError('ORDER_NOT_EDITABLE', message, HttpStatus.CONFLICT, {
        status: order.status,
      });
    }
    return order;
  }

  /**
   * Re-quote over the total pages of all valid files (invariant 1: server-side, integer paise)
   * inside the caller's transaction, order row locked. DRAFT → AWAITING_PAYMENT once there is a
   * quote; no files, or options that don't fit, → no price (pay() refuses an order without one).
   */
  private async requote(tx: Tx, orderId: string, actor: Actor): Promise<Requote> {
    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { files: PRINTABLE_FILES },
    });
    const pages = totalPages(order.files);
    const quote = pages
      ? await this.tryQuote(order.shopId, parseOptions(order.options), pages)
      : null;

    if (quote?.ok && order.status === OrderStatus.DRAFT) {
      await this.stateMachine.transition(tx, {
        orderId,
        to: OrderStatus.AWAITING_PAYMENT,
        from: OrderStatus.DRAFT,
        actor,
        data: { quote: quote.quote, amountPaise: quote.quote.totalPaise },
      });
    } else {
      await this.stateMachine.updateFields(tx, order, EDITABLE, {
        quote: quote?.ok ? quote.quote : Prisma.DbNull,
        amountPaise: quote?.ok ? quote.quote.totalPaise : null,
      });
    }
    return quote && !quote.ok ? quote : { ok: true };
  }

  private async assertOptionsAllowed(shopId: string, options: PrintOptions): Promise<void> {
    if (options.copies > this.config.MAX_COPIES) {
      throw new AppError(
        'COPIES_LIMIT',
        `At most ${this.config.MAX_COPIES} copies per order`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (options.colour || options.duplex) {
      const caps = await this.shops.capabilities(shopId);
      if ((options.colour && !caps.colour) || (options.duplex && !caps.duplex)) {
        throw new AppError(
          'OPTION_UNSUPPORTED',
          `This shop can't print ${options.colour && !caps.colour ? 'in colour' : 'double-sided'}`,
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
    }
  }

  /** Quote over `pageCount` = total pages of all the order's files (ADR-005). */
  private async tryQuote(
    shopId: string,
    options: PrintOptions,
    pageCount: number,
  ): Promise<{ ok: true; quote: Quote } | { ok: false; error: AppError }> {
    if (pageCount > this.config.MAX_PAGES) {
      return {
        ok: false,
        error: new AppError(
          'ORDER_TOO_MANY_PAGES',
          `All files together can have at most ${this.config.MAX_PAGES} pages`,
          HttpStatus.UNPROCESSABLE_ENTITY,
        ),
      };
    }
    const rates = await this.pricing.getEffectivePricing(shopId);
    let quote: Quote;
    try {
      quote = calculateQuote(rates, options, pageCount);
    } catch (err) {
      if (err instanceof PageRangeError) {
        return { ok: false, error: new AppError('PAGE_RANGE_INVALID', err.message, 400) };
      }
      throw err;
    }
    if (quote.printedSides > this.config.MAX_SIDES) {
      return {
        ok: false,
        error: new AppError(
          'SIDES_LIMIT',
          `Orders can have at most ${this.config.MAX_SIDES} printed sides`,
          HttpStatus.UNPROCESSABLE_ENTITY,
        ),
      };
    }
    return { ok: true, quote };
  }
}

function notFound(): AppError {
  return new AppError('ORDER_NOT_FOUND', 'Order not found', HttpStatus.NOT_FOUND);
}

function isUniqueViolation(err: unknown, field: string): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    err.code === 'P2002' &&
    JSON.stringify(err.meta ?? {}).includes(field)
  );
}
