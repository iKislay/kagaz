import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { type AdminAuditQuery } from '@kagaz/shared';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: AdminAuditQuery) {
    const where: Record<string, unknown> = {};
    if (query.shopId) where.shopId = query.shopId;
    if (query.orderId) where.orderId = query.orderId;
    if (query.action) where.action = { contains: query.action, mode: 'insensitive' };

    const skip = (query.page - 1) * query.pageSize;
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: query.pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      items: items.map((a) => ({
        id: a.id,
        actorType: a.actorType,
        actorId: a.actorId,
        shopId: a.shopId,
        orderId: a.orderId,
        action: a.action,
        metadata: a.metadata,
        ip: a.ip,
        createdAt: a.createdAt.toISOString(),
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }
}
