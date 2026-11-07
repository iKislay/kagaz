import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { type AdminOrdersQuery, maskPhone } from '@kagaz/shared';
import { AuditService } from './audit.service.js';

interface PaymentRow {
  id: string;
  status: string;
  isSimulated: boolean;
  createdAt: Date;
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list(query: AdminOrdersQuery) {
    const where: Record<string, unknown> = {};
    if (query.q) {
      where.publicRef = { contains: query.q, mode: 'insensitive' };
    }
    if (query.shopId) where.shopId = query.shopId;
    if (query.status) where.status = query.status;

    const skip = (query.page - 1) * query.pageSize;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: query.pageSize,
        select: {
          id: true,
          publicRef: true,
          shopId: true,
          status: true,
          amountPaise: true,
          createdAt: true,
          shop: { select: { name: true } },
          payments: { select: { id: true, status: true, isSimulated: true, createdAt: true } },
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    return {
      items: items.map((o) => {
        const payments = o.payments as PaymentRow[];
        const latest = payments
          .slice()
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
        return {
          id: o.id,
          publicRef: o.publicRef,
          shopId: o.shopId,
          shopName: o.shop.name,
          status: o.status,
          amountPaise: o.amountPaise,
          paymentStatus: latest?.status ?? null,
          simulatedPayment: payments.some((p) => p.isSimulated),
          createdAt: o.createdAt.toISOString(),
        };
      }),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async detail(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        shop: { select: { id: true, name: true, slug: true, isDemo: true } },
        files: {
          select: {
            id: true,
            kind: true,
            status: true,
            bytes: true,
            pageCount: true,
            sha256: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'asc' },
        },
        payments: {
          include: {
            refunds: {
              select: {
                id: true,
                amountPaise: true,
                status: true,
                isSimulated: true,
                createdAt: true,
                completedAt: true,
              },
              orderBy: { createdAt: 'asc' },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
        printJobs: {
          include: {
            printer: { select: { printerName: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
        events: {
          select: {
            id: true,
            fromStatus: true,
            toStatus: true,
            actorType: true,
            actorId: true,
            reason: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!order) return null;

    const auditRows = await this.prisma.auditLog.findMany({
      where: { orderId },
      orderBy: { createdAt: 'desc' },
    });
    const audit = await this.auditService.withActorNames(auditRows);
    // Event actor names: reuse the resolver on synthetic rows.
    const eventNames = await this.auditService.withActorNames(
      order.events.map((e) => ({
        id: e.id,
        actorType: e.actorType,
        actorId: e.actorId,
        shopId: null,
        orderId,
        action: '',
        metadata: null,
        ip: null,
        createdAt: e.createdAt,
      })),
    );

    return {
      id: order.id,
      publicRef: order.publicRef,
      shop: {
        id: order.shop.id,
        name: order.shop.name,
        slug: order.shop.slug,
        isDemo: order.shop.isDemo,
      },
      customerPhoneMasked: maskPhone(order.customerPhone),
      options: order.options as unknown as Record<string, unknown>,
      quote: order.quote ?? null,
      priceSnapshot: order.priceSnapshot ?? null,
      amountPaise: order.amountPaise,
      files: order.files.map((f) => ({
        id: f.id,
        kind: f.kind,
        status: f.status,
        bytes: f.bytes,
        pageCount: f.pageCount,
        sha256: f.sha256,
        createdAt: f.createdAt.toISOString(),
      })),
      payments: order.payments.map((p) => ({
        id: p.id,
        provider: p.provider,
        providerOrderId: p.providerOrderId,
        amountPaise: p.amountPaise,
        status: p.status,
        isSimulated: p.isSimulated,
        verifiedAt: p.verifiedAt?.toISOString() ?? null,
        createdAt: p.createdAt.toISOString(),
      })),
      refunds: order.payments.flatMap((p) =>
        p.refunds.map((r) => ({
          id: r.id,
          paymentId: p.id,
          amountPaise: r.amountPaise,
          status: r.status,
          isSimulated: r.isSimulated,
          createdAt: r.createdAt.toISOString(),
          completedAt: r.completedAt?.toISOString() ?? null,
        })),
      ),
      printJobs: order.printJobs.map((j) => ({
        id: j.id,
        attempt: j.attempt,
        status: j.status,
        printerId: j.printerId,
        printerName: j.printer.printerName,
        spoolerJobId: j.spoolerJobId,
        error: j.error,
        createdAt: j.createdAt.toISOString(),
      })),
      events: order.events.map((e, i) => ({
        id: e.id,
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        actorType: e.actorType,
        actorId: e.actorId,
        actorName: eventNames[i]?.actorName ?? null,
        reason: e.reason,
        createdAt: e.createdAt.toISOString(),
      })),
      audit,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
    };
  }
}
