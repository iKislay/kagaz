/** Who performed an action — recorded on order events and audit logs. */
export type ActorType = 'CUSTOMER' | 'STAFF' | 'DEVICE' | 'ADMIN' | 'SYSTEM';

export interface Actor {
  type: ActorType;
  /** User id, device id, or null for anonymous customers / the system. */
  id: string | null;
}

export const SYSTEM_ACTOR: Actor = { type: 'SYSTEM', id: null };

/** Human-initiated actions also go to the audit log (CLAUDE.md invariant 5). */
export function isHumanActor(actor: Actor): boolean {
  return actor.type === 'STAFF' || actor.type === 'ADMIN' || actor.type === 'DEVICE';
}
