/** Who performed an action — recorded on order events and audit logs. */
export type ActorType = 'CUSTOMER' | 'STAFF' | 'DEVICE' | 'ADMIN' | 'SYSTEM';

export interface Actor {
  type: ActorType;
  /** User id, device id, or null for anonymous customers / the system. */
  id: string | null;
  /** Device the action came through (operator actions on the Windows app); goes to audit metadata. */
  deviceId?: string;
}

export const SYSTEM_ACTOR: Actor = { type: 'SYSTEM', id: null };

/** Human-initiated actions also go to the audit log (CLAUDE.md invariant 5). */
export function isHumanActor(actor: Actor): boolean {
  return actor.type === 'STAFF' || actor.type === 'ADMIN' || actor.type === 'DEVICE';
}

/** Extra audit metadata identifying the actor's device, when known. */
export function actorMetadata(actor: Actor): { deviceId?: string } {
  return actor.deviceId ? { deviceId: actor.deviceId } : {};
}
