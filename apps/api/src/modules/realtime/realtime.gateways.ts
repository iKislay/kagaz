import { Logger, type OnModuleDestroy } from '@nestjs/common';
import {
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
  WebSocketGateway,
} from '@nestjs/websockets';
import { RealtimeEvent, RealtimeNamespace } from '@kagaz/shared';
import { type Namespace, type Socket } from 'socket.io';
import { ADMIN_ROOM, orderRoom, shopRoom } from './realtime-mapping.js';
import {
  HandshakeError,
  RealtimeAuthService,
  type ShopSocketData,
} from './realtime-auth.service.js';
import { RealtimePublisher } from './realtime.publisher.js';

/** How often live /shop sockets are re-checked against device revocation. */
const REVOCATION_SWEEP_MS = 30_000;

type Next = (err?: Error) => void;

/** Turns an auth failure into a `connect_error`; unexpected errors don't leak details. */
function handshake(
  logger: Logger,
  check: (socket: Socket) => Promise<void>,
): (socket: Socket, next: Next) => void {
  return (socket, next) => {
    check(socket).then(
      () => next(),
      (err: unknown) => {
        if (err instanceof HandshakeError) return next(err);
        logger.error({ err }, 'Realtime handshake failed');
        next(new Error('UNAVAILABLE'));
      },
    );
  };
}

/** `/shop` — Windows agents. Room `shop:{shopId}` from the device token only (invariant 10). */
@WebSocketGateway({ namespace: RealtimeNamespace.SHOP })
export class ShopGateway
  implements
    OnGatewayInit<Namespace>,
    OnGatewayConnection<Socket>,
    OnGatewayDisconnect<Socket>,
    OnModuleDestroy
{
  private readonly logger = new Logger(ShopGateway.name);
  private nsp?: Namespace;
  private sweep?: NodeJS.Timeout;

  constructor(
    private readonly auth: RealtimeAuthService,
    private readonly publisher: RealtimePublisher,
  ) {}

  afterInit(nsp: Namespace): void {
    this.nsp = nsp;
    this.publisher.register(RealtimeNamespace.SHOP, nsp);
    nsp.use(
      handshake(this.logger, async (socket) => {
        socket.data = await this.auth.authenticateDevice(socket);
      }),
    );
    this.sweep = setInterval(() => void this.sweepRevoked(), REVOCATION_SWEEP_MS);
    this.sweep.unref();
  }

  async handleConnection(socket: Socket): Promise<void> {
    const { shopId, deviceId } = socket.data as ShopSocketData;
    await socket.join(shopRoom(shopId));
    this.publisher.publishToAdmin(RealtimeEvent.DEVICE_STATUS, { deviceId, shopId, online: true });
  }

  handleDisconnect(socket: Socket): void {
    const data = socket.data as Partial<ShopSocketData>;
    if (!data.deviceId || !data.shopId || this.deviceConnected(data.deviceId)) return;
    this.publisher.publishToAdmin(RealtimeEvent.DEVICE_STATUS, {
      deviceId: data.deviceId,
      shopId: data.shopId,
      online: false,
    });
  }

  onModuleDestroy(): void {
    clearInterval(this.sweep);
  }

  private deviceConnected(deviceId: string): boolean {
    for (const s of this.nsp?.sockets.values() ?? []) {
      if ((s.data as Partial<ShopSocketData>).deviceId === deviceId) return true;
    }
    return false;
  }

  /** Safety net: drop sockets of devices revoked by code paths that didn't call the publisher. */
  private async sweepRevoked(): Promise<void> {
    if (!this.nsp || this.nsp.sockets.size === 0) return;
    const live = new Map<string, string>();
    for (const s of this.nsp.sockets.values()) {
      const d = s.data as Partial<ShopSocketData>;
      if (d.deviceId && d.shopId) live.set(d.deviceId, d.shopId);
    }
    try {
      for (const id of await this.auth.inactiveDevices([...live.keys()])) {
        this.publisher.revokeDevice(live.get(id)!, id);
      }
    } catch (err) {
      this.logger.warn({ err }, 'Realtime revocation sweep failed');
    }
  }
}

/** `/customer` — order tracking page. Room `order:{id}` after the tracking-token check. */
@WebSocketGateway({ namespace: RealtimeNamespace.CUSTOMER })
export class CustomerGateway implements OnGatewayInit<Namespace>, OnGatewayConnection<Socket> {
  private readonly logger = new Logger(CustomerGateway.name);

  constructor(
    private readonly auth: RealtimeAuthService,
    private readonly publisher: RealtimePublisher,
  ) {}

  afterInit(nsp: Namespace): void {
    this.publisher.register(RealtimeNamespace.CUSTOMER, nsp);
    nsp.use(
      handshake(this.logger, async (socket) => {
        socket.data = { orderId: await this.auth.authenticateCustomer(socket) };
      }),
    );
  }

  async handleConnection(socket: Socket): Promise<void> {
    await socket.join(orderRoom((socket.data as { orderId: string }).orderId));
  }
}

/** `/admin` — admin dashboard, admin session cookie. Single room `admin`. */
@WebSocketGateway({ namespace: RealtimeNamespace.ADMIN })
export class AdminGateway implements OnGatewayInit<Namespace>, OnGatewayConnection<Socket> {
  private readonly logger = new Logger(AdminGateway.name);

  constructor(
    private readonly auth: RealtimeAuthService,
    private readonly publisher: RealtimePublisher,
  ) {}

  afterInit(nsp: Namespace): void {
    this.publisher.register(RealtimeNamespace.ADMIN, nsp);
    nsp.use(
      handshake(this.logger, async (socket) => {
        socket.data = { userId: await this.auth.authenticateAdmin(socket) };
      }),
    );
  }

  async handleConnection(socket: Socket): Promise<void> {
    await socket.join(ADMIN_ROOM);
  }
}
