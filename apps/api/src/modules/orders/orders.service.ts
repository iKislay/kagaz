import { randomUUID } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  type CreateOrderRequest,
  OrderStatus,
  PageRangeError,
  type PrintOptions,
  type PublicOrder,
  type Quote,
  type UploadUrlResponse,
} from '@kagaz/shared';
import { type Actor } from '../../common/actor.js';
import { APP_CONFIG } from '../../common/config/config.module.js';
import { type AppConfig } from '../../common/config/config.schema.js';
import { generateToken, randomCode, sha256Hex } from '../../common/crypto/tokens.js';
import { AppError } from '../../common/http/api-exception.filter.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { PdfValidationError, validatePdf } from '../files/pdf-validator.js';
import { StorageService } from '../files/storage.service.js';
import { PickupCrypto } from '../pickup/pickup-crypto.js';
import { PricingService } from '../pricing/pricing.service.js';
import { calculateQuote } from '../pricing/quote.js';
import { ShopsService } from '../shops/shops.service.js';
import { OrderStateMachine } from './order-state-machine.js';
import {
  ORDER_VIEW_INCLUDE,
  PAYMENT_IN_FLIGHT,
  canCustomerCancel,
  parseOptions,
  toPublicOrder,
} from './order-view.js';

const PDF = 'application/pdf';
/** Options can change until a payment exists for the order. */
const EDITABLE: readonly OrderStatus[] = [OrderStatus.DRAFT, OrderStatus.AWAITING_PAYMENT];

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
    private readonly pickup: PickupCrypto,
  ) {}

  // ─── Queries ───

  async getPublic(orderId: string): Promise<PublicOrder> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: ORDER_VIEW_INCLUDE,
    });
    if (!order) throw notFound();
    return toPublicOrder(order, this.pickup);
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

  async requestUploadUrl(orderId: string, bytes: number): Promise<UploadUrlResponse> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw notFound();
    if (order.status !== OrderStatus.DRAFT) {
      throw new AppError(
        'ORDER_NOT_EDITABLE',
        'A file can only be uploaded while the order is a draft',
        HttpStatus.CONFLICT,
      );
    }
    if (bytes > this.config.MAX_UPLOAD_BYTES) {
      throw new AppError(
        'FILE_TOO_LARGE',
        `Files can be at most ${Math.floor(this.config.MAX_UPLOAD_BYTES / 1024 / 1024)} MB`,
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }

    // Key never contains the customer's filename (PRD FR-FILE-01).
    const objectKey = `orders/${order.id}/original/${randomUUID()}.pdf`;
    const file = await this.prisma.fileAsset.create({
      data: { orderId: order.id, kind: 'ORIGINAL', objectKey, mime: PDF, bytes },
    });
    const upload = await this.storage.createUploadUrl(objectKey, PDF, bytes);
    return {
      fileId: file.id,
      uploadUrl: upload.url,
      method: 'PUT',
      headers: upload.headers,
      expiresAt: upload.expiresAt.toISOString(),
    };
  }

  /**
   * Validate the uploaded bytes (content, not filename), store page count + checksum, quote,
   * and move DRAFT → AWAITING_PAYMENT when the options are valid for this document.
   */
  async completeUpload(orderId: string, fileId: string, actor: Actor): Promise<PublicOrder> {
    const file = await this.prisma.fileAsset.findFirst({
      where: { id: fileId, orderId, kind: 'ORIGINAL' },
      include: { order: true },
    });
    if (!file) throw new AppError('FILE_NOT_FOUND', 'Upload not found', HttpStatus.NOT_FOUND);
    if (file.status === 'VALID') return this.getPublic(orderId); // idempotent replay
    if (file.status !== 'PENDING_UPLOAD' || file.order.status !== OrderStatus.DRAFT) {
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
      validated = await validatePdf(buffer, {
        maxBytes: this.config.MAX_UPLOAD_BYTES,
        maxPages: this.config.MAX_PAGES,
      });
    } catch (err) {
      if (!(err instanceof PdfValidationError)) throw err;
      await this.prisma.fileAsset.update({
        where: { id: file.id },
        data: { status: 'INVALID', error: err.code, bytes: head.bytes },
      });
      await this.storage.delete(file.objectKey).catch((e: unknown) => {
        this.logger.warn({ err: e, fileId: file.id }, 'failed to delete invalid upload');
      });
      throw new AppError(err.code, err.message, HttpStatus.UNPROCESSABLE_ENTITY);
    }

    const options = parseOptions(file.order.options);
    const quote = await this.tryQuote(file.order.shopId, options, validated.pageCount);

    await this.prisma.$transaction(async (tx) => {
      const marked = await tx.fileAsset.updateMany({
        where: { id: file.id, status: 'PENDING_UPLOAD' },
        data: {
          status: 'VALID',
          bytes: validated.bytes,
          pageCount: validated.pageCount,
          sha256: validated.sha256,
        },
      });
      if (marked.count !== 1) return; // a concurrent completion won
      // Any older uploads for this order are superseded.
      await tx.fileAsset.updateMany({
        where: { orderId, kind: 'ORIGINAL', id: { not: file.id }, status: 'VALID' },
        data: { status: 'DELETED', deletedAt: new Date() },
      });
      if (quote.ok) {
        await this.stateMachine.transition(tx, {
          orderId,
          to: OrderStatus.AWAITING_PAYMENT,
          from: OrderStatus.DRAFT,
          actor,
          data: { quote: quote.quote, amountPaise: quote.quote.totalPaise },
        });
      } else {
        await tx.order.update({ where: { id: orderId }, data: { quote: Prisma.DbNull } });
      }
    });

    if (!quote.ok) throw quote.error; // file is valid; customer must fix the options
    return this.getPublic(orderId);
  }

  /** Change print options before payment; re-quotes and advances DRAFT when possible. */
  async updateOptions(orderId: string, options: PrintOptions, actor: Actor): Promise<PublicOrder> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { files: { where: { kind: 'ORIGINAL', status: 'VALID' }, take: 1 } },
    });
    if (!order) throw notFound();
    if (!EDITABLE.includes(order.status)) {
      throw new AppError('ORDER_NOT_EDITABLE', 'Options can no longer be changed', 409);
    }
    const hasPayment = await this.prisma.payment.count({ where: { orderId } });
    if (hasPayment) {
      throw new AppError('ORDER_LOCKED_FOR_PAYMENT', 'Payment already started for this order', 409);
    }
    await this.assertOptionsAllowed(order.shopId, options);

    const pageCount = order.files[0]?.pageCount;
    const quote = pageCount ? await this.tryQuote(order.shopId, options, pageCount) : null;
    if (quote && !quote.ok) throw quote.error;

    await this.prisma.$transaction(async (tx) => {
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

  private async tryQuote(
    shopId: string,
    options: PrintOptions,
    pageCount: number,
  ): Promise<{ ok: true; quote: Quote } | { ok: false; error: AppError }> {
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
