import type { Server as SocketServer } from 'socket.io'

declare global {
  // Socket.io server instance, set in server.js and used by API routes
  var io: SocketServer | undefined
}

export {}
