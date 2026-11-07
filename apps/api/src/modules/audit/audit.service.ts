import { Injectable } from '@nestjs/common';
import { type Actor } from '../../common/actor.js';
import { type Prisma } from '../../generated/prisma/client.js';

type AuditClient = Pick<Prisma.TransactionClient, 'auditLog'>;

export interface AuditContext {
  shopId?: string | null;
  orderId?: string | null;
  metadata?: Prisma.InputJsonValue;
  ip?: string | null;
}

/**
 * Audit trail (FR-OPS-01, P2.1). Call `record` with the SAME transaction client as the change
 * it describes, so the audit row commits or rolls back together with it.
 * Action names: lower.dotted (`order.accepted`, `pickup.failed`) or the contract's
 * UPPER_SNAKE (`ORDER_RESOLVE_REPRINT`).
 */
@Injectable()
export class AuditService {
  async record(
    tx: AuditClient,
    actor: Actor,
    action: string,
    ctx: AuditContext = {},
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        actorType: actor.type,
        actorId: actor.id,
        shopId: ctx.shopId ?? null,
        orderId: ctx.orderId ?? null,
        action,
        ...(ctx.metadata === undefined ? {} : { metadata: ctx.metadata }),
        ip: ctx.ip ?? null,
      },
    });
  }
}
