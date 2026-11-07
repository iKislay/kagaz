import { EventEmitter } from 'node:events';

/**
 * In-process domain events, emitted AFTER commit (contract §5). The realtime gateway subscribes
 * and forwards them as socket hints; everything is also available over REST.
 * Event names match the socket event names exactly.
 */
export const domainEvents = new EventEmitter();
domainEvents.setMaxListeners(50);

export interface ShopModeChangedEvent {
  shopId: string;
  approvalMode: 'MANUAL' | 'AUTO';
  autoPaused: boolean;
}

export const SHOP_MODE_CHANGED = 'shop.mode_changed';

export function emitShopModeChanged(event: ShopModeChangedEvent): void {
  // A failing listener must never break the request that already committed.
  try {
    domainEvents.emit(SHOP_MODE_CHANGED, event);
  } catch {
    /* listeners are best-effort hints */
  }
}
