import { type Prisma } from '../../generated/prisma/client.js';
import { type Tx } from '../orders/order-state-machine.js';
import { type StaffContext, staffActor } from '../identity/staff-session.js';

/**
 * Audit row for an admin/owner setting change (FR-OPS-01, P4.3). Written in the same
 * transaction as the change so a setting never changes without its audit trail.
 */
export async function auditStaffAction(
  tx: Tx,
  staff: StaffContext,
  action: string,
  shopId: string | null,
  metadata: Prisma.InputJsonValue,
  ip?: string,
): Promise<void> {
  const actor = staffActor(staff);
  await tx.auditLog.create({
    data: { actorType: actor.type, actorId: actor.id, shopId, action, metadata, ip: ip ?? null },
  });
}

/** `{ field: { from, to } }` for every field whose value actually changes. */
export function diffFields(
  before: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, { from: Prisma.InputJsonValue | null; to: Prisma.InputJsonValue | null }> {
  const changes: Record<
    string,
    { from: Prisma.InputJsonValue | null; to: Prisma.InputJsonValue | null }
  > = {};
  for (const [key, to] of Object.entries(patch)) {
    if (to === undefined) continue;
    const from = before[key];
    if (JSON.stringify(from) !== JSON.stringify(to)) {
      changes[key] = {
        from: (from ?? null) as Prisma.InputJsonValue | null,
        to: (to ?? null) as Prisma.InputJsonValue | null,
      };
    }
  }
  return changes;
}
