import { Inject, Injectable } from '@nestjs/common';
import { jwtVerify } from 'jose';
import { RealtimeErrorCode, trackingCookieName } from '@kagaz/shared';
import { type Socket } from 'socket.io';
import { APP_CONFIG } from '../../common/config/config.module.js';
import { type AppConfig } from '../../common/config/config.schema.js';
import { sha256Hex } from '../../common/crypto/tokens.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { resolveStaff } from '../identity/staff-session.js';
import { OrdersService } from '../orders/orders.service.js';
import { readCookie } from '../orders/tracking.guard.js';

/** A refused handshake: the client gets `connect_error` with this message and `data.code`. */
export class HandshakeError extends Error {
  readonly data: { code: RealtimeErrorCode };
  constructor(code: RealtimeErrorCode) {
    super(code);
    this.data = { code };
  }
}

export interface ShopSocketData {
  deviceId: string;
  shopId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEVICE_TOKEN = /^[A-Za-z0-9_-]{20,200}$/;

const authField = (socket: Socket, name: string): string | undefined => {
  const value = (socket.handshake.auth as Record<string, unknown> | undefined)?.[name];
  return typeof value === 'string' ? value : undefined;
};

/**
 * Socket handshake authentication. Mirrors the REST guards: the shop comes ONLY from the device
 * token (invariant 10), customers need the order's tracking token, admins the admin session.
 */
@Injectable()
export class RealtimeAuthService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
  ) {}

  async authenticateDevice(socket: Socket): Promise<ShopSocketData> {
    const header = socket.handshake.headers.authorization;
    const token =
      authField(socket, 'token') ??
      (typeof header === 'string' ? /^Bearer (.+)$/.exec(header)?.[1] : undefined);
    if (!token || !DEVICE_TOKEN.test(token)) throw new HandshakeError('UNAUTHORIZED');
    const device = await this.prisma.shopDevice.findUnique({
      where: { tokenHash: sha256Hex(token) },
      select: { id: true, shopId: true, status: true },
    });
    if (!device) throw new HandshakeError('UNAUTHORIZED');
    if (device.status !== 'ACTIVE') throw new HandshakeError('DEVICE_REVOKED');
    return { deviceId: device.id, shopId: device.shopId };
  }

  /** Returns the order id the socket may follow. Unknown order and wrong token look the same. */
  async authenticateCustomer(socket: Socket): Promise<string> {
    const orderId = authField(socket, 'orderId');
    if (!orderId || !UUID.test(orderId)) throw new HandshakeError('ORDER_NOT_FOUND');
    const token =
      authField(socket, 'trackingToken') ??
      readCookie(socket.handshake.headers.cookie, trackingCookieName(orderId));
    if (!token) throw new HandshakeError('ORDER_NOT_FOUND');
    const order = await this.orders.findByTrackingToken(orderId, token);
    if (!order) throw new HandshakeError('ORDER_NOT_FOUND');
    return order.id;
  }

  /** Admin session cookie `kgz_admin` (or `auth.token` for tooling), same JWT as AdminAuthGuard. */
  async authenticateAdmin(socket: Socket): Promise<string> {
    const token =
      readCookie(socket.handshake.headers.cookie, 'kgz_admin') ?? authField(socket, 'token');
    if (!token) throw new HandshakeError('ADMIN_UNAUTHENTICATED');
    try {
      const { payload } = await jwtVerify(
        token,
        new TextEncoder().encode(this.config.SESSION_JWT_SECRET),
        { algorithms: ['HS256'] },
      );
      if (payload.typ !== 'staff' || typeof payload.sub !== 'string') throw new Error('typ');
      // Same rule as AdminAuthGuard: the user must currently hold the ADMIN role.
      const staff = await resolveStaff(this.prisma, payload.sub);
      if (staff?.role !== 'ADMIN') throw new Error('role');
      return staff.userId;
    } catch {
      throw new HandshakeError('ADMIN_UNAUTHENTICATED');
    }
  }

  /** Device ids among `ids` that are no longer ACTIVE (revoked while connected). */
  async inactiveDevices(ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.shopDevice.findMany({
      where: { id: { in: ids }, status: { not: 'ACTIVE' } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }
}
