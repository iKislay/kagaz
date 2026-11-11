import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { RealtimeEvent } from '@kagaz/shared';
import {
  DomainEvent,
  type DeviceRevokedEvent,
  type DeviceStatusChangedEvent,
  type OrderStatusChangedEvent,
  type PrinterStatusChangedEvent,
  type ShopModeChangedEvent,
} from '../../common/events/domain-events.js';
import { emissionsFor } from './realtime-mapping.js';
import { RealtimePublisher } from './realtime.publisher.js';

/**
 * Domain events (all emitted after commit) → Socket.IO hints. Handlers are synchronous and never
 * throw into the emitter: a failed hint must not affect the request that caused it.
 */
@Injectable()
export class RealtimeListener {
  constructor(private readonly publisher: RealtimePublisher) {}

  @OnEvent(DomainEvent.ORDER_STATUS_CHANGED, { suppressErrors: true })
  onOrderTransitioned(e: OrderStatusChangedEvent): void {
    for (const m of emissionsFor(e)) this.publisher.emit(m.namespace, m.room, m.event, m.payload);
  }

  @OnEvent(DomainEvent.SHOP_MODE_CHANGED, { suppressErrors: true })
  onShopModeChanged(e: ShopModeChangedEvent): void {
    this.publisher.publishToShop(e.shopId, RealtimeEvent.SHOP_MODE_CHANGED, {
      approvalMode: e.approvalMode,
      autoPaused: e.autoPaused,
    });
  }

  @OnEvent(DomainEvent.DEVICE_REVOKED, { suppressErrors: true })
  onDeviceRevoked(e: DeviceRevokedEvent): void {
    this.publisher.revokeDevice(e.shopId, e.deviceId);
    this.publisher.publishToAdmin(RealtimeEvent.DEVICE_STATUS, {
      deviceId: e.deviceId,
      shopId: e.shopId,
      online: false,
    });
  }

  @OnEvent(DomainEvent.PRINTER_STATUS_CHANGED, { suppressErrors: true })
  onPrinterStatus(e: PrinterStatusChangedEvent): void {
    this.publisher.publishToAdmin(RealtimeEvent.PRINTER_STATUS, {
      printerId: e.printerId,
      shopId: e.shopId,
      status: e.status,
    });
  }

  @OnEvent(DomainEvent.DEVICE_STATUS_CHANGED, { suppressErrors: true })
  onDeviceStatus(e: DeviceStatusChangedEvent): void {
    this.publisher.publishToAdmin(RealtimeEvent.DEVICE_STATUS, {
      deviceId: e.deviceId,
      shopId: e.shopId,
      online: e.online,
    });
  }
}
