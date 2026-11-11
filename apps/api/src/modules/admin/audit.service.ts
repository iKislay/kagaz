import { Injectable } from '@nestjs/common';
import { type AdminAuditEntry, type AdminAuditQuery, istDayStart } from '@kagaz/shared';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { type Prisma } from '../../generated/prisma/client.js';
import { displayName } from '../identity/operator-session.service.js';

interface AuditRow {
  id: string;
  actorType: AdminAuditEntry['actorType'];
  actorId: string | null;
  shopId: string | null;
  orderId: string | null;
  action: string;
  metadata: unknown;
  ip: string | null;
  createdAt: Date;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: AdminAuditQuery) {
    const where: Prisma.AuditLogWhereInput = {};
    if (query.shopId) where.shopId = query.shopId;
    if (query.orderId) where.orderId = query.orderId;
    if (query.action) where.action = { contains: query.action, mode: 'insensitive' };
    if (query.actorType) where.actorType = query.actorType;
    if (query.actorId) where.actorId = query.actorId;
    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: istDayStart(query.from) } : {}),
        ...(query.to ? { lt: new Date(istDayStart(query.to).getTime() + 86_400_000) } : {}),
      };
    }

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
      items: await this.withActorNames(items),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  /** Serialises audit rows and resolves actor display names (operators, admins, devices). */
  async withActorNames(rows: AuditRow[]): Promise<AdminAuditEntry[]> {
    const userIds = new Set<string>();
    const deviceIds = new Set<string>();
    const isUuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v);
    for (const r of rows) {
      if (!r.actorId || !isUuid(r.actorId)) continue;
      if (r.actorType === 'DEVICE') deviceIds.add(r.actorId);
      else if (r.actorType === 'STAFF' || r.actorType === 'ADMIN') userIds.add(r.actorId);
    }
    const [users, devices] = await Promise.all([
      userIds.size
        ? this.prisma.user.findMany({
            where: { id: { in: [...userIds] } },
            select: { id: true, name: true, email: true, phone: true },
          })
        : [],
      deviceIds.size
        ? this.prisma.shopDevice.findMany({
            where: { id: { in: [...deviceIds] } },
            select: { id: true, name: true },
          })
        : [],
    ]);
    const names = new Map<string, string>([
      ...users.map((u) => [u.id, displayName(u)] as [string, string]),
      ...devices.map((d) => [d.id, d.name] as [string, string]),
    ]);
    return rows.map((a) => ({
      id: a.id,
      actorType: a.actorType,
      actorId: a.actorId,
      actorName: a.actorId ? (names.get(a.actorId) ?? null) : null,
      shopId: a.shopId,
      orderId: a.orderId,
      action: a.action,
      metadata: a.metadata,
      ip: a.ip,
      createdAt: a.createdAt.toISOString(),
    }));
  }
}
