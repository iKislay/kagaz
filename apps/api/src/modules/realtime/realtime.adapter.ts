import { type INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { REALTIME_PATH } from '@kagaz/shared';
import { type Server, type ServerOptions } from 'socket.io';

/**
 * Socket.IO server options shared by every namespace: same origin/port as the API, CORS limited
 * to the web app (cookies allowed), no client bundle served, tiny inbound frames (clients only
 * listen — commands go over REST).
 */
export class RealtimeIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly webOrigin: string,
  ) {
    super(app);
  }

  override createIOServer(port: number, options?: Partial<ServerOptions>): Server {
    const merged: Partial<ServerOptions> = {
      ...options,
      path: REALTIME_PATH,
      serveClient: false,
      maxHttpBufferSize: 16 * 1024,
      cors: { origin: [this.webOrigin], credentials: true },
    };
    // `as never`: IoAdapter's ServerOptions type requires `adapter`, which socket.io defaults.
    const server = super.createIOServer(port, merged as never) as Server;
    // Only /shop, /customer and /admin carry events; refuse the unauthenticated main namespace.
    server.of('/').use((_socket, next) => next(new Error('UNKNOWN_NAMESPACE')));
    return server;
  }
}
