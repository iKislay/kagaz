import { Injectable, Logger } from '@nestjs/common';
import { RealtimeEvent, RealtimeNamespace } from '@kagaz/shared';
import { type Namespace } from 'socket.io';
import { ADMIN_ROOM, orderRoom, shopRoom } from './realtime-mapping.js';

/**
 * The one place that writes to Socket.IO. Other modules inject this to push hints (call it
 * AFTER your transaction commits — or emit a DomainEvent and let RealtimeListener do it).
 * Before the gateways are initialised (or in unit tests without a server) publishing is a no-op:
 * hints are best-effort by design, REST is the source of truth.
 */
@Injectable()
export class RealtimePublisher {
  private readonly logger = new Logger(RealtimePublisher.name);
  private readonly namespaces = new Map<RealtimeNamespace, Namespace>();

  /** Called by each gateway's afterInit. */
  register(name: RealtimeNamespace, nsp: Namespace): void {
    this.namespaces.set(name, nsp);
  }

  publishToShop(shopId: string, event: string, payload: object): void {
    this.emit(RealtimeNamespace.SHOP, shopRoom(shopId), event, payload);
  }

  publishToOrder(orderId: string, event: string, payload: object): void {
    this.emit(RealtimeNamespace.CUSTOMER, orderRoom(orderId), event, payload);
  }

  publishToAdmin(event: string, payload: object): void {
    this.emit(RealtimeNamespace.ADMIN, ADMIN_ROOM, event, payload);
  }

  emit(namespace: RealtimeNamespace, room: string, event: string, payload: object): void {
    const nsp = this.namespaces.get(namespace);
    if (!nsp) return;
    try {
      nsp.to(room).emit(event, payload);
    } catch (err) {
      this.logger.warn({ err, namespace, event }, 'Realtime emit failed');
    }
  }

  /**
   * Tells a revoked device and drops its live sockets (the handshake check refuses reconnects).
   */
  revokeDevice(shopId: string, deviceId: string): void {
    const nsp = this.namespaces.get(RealtimeNamespace.SHOP);
    if (!nsp) return;
    for (const socket of nsp.sockets.values()) {
      if ((socket.data as { deviceId?: string }).deviceId === deviceId) {
        socket.emit(RealtimeEvent.DEVICE_REVOKED, { deviceId });
        socket.disconnect(true);
      }
    }
    this.logger.log({ shopId, deviceId }, 'Realtime: revoked device disconnected');
  }
}
