import { Global, Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module.js';
import { RealtimeAuthService } from './realtime-auth.service.js';
import { AdminGateway, CustomerGateway, ShopGateway } from './realtime.gateways.js';
import { RealtimeListener } from './realtime.listener.js';
import { RealtimePublisher } from './realtime.publisher.js';

/**
 * Socket.IO hints (P2.9, PRD §12, contract §5): namespaces /shop, /customer, /admin on the API
 * origin. Global so any module can inject RealtimePublisher without an import cycle.
 */
@Global()
@Module({
  imports: [OrdersModule],
  providers: [
    RealtimeAuthService,
    RealtimePublisher,
    RealtimeListener,
    ShopGateway,
    CustomerGateway,
    AdminGateway,
  ],
  exports: [RealtimePublisher],
})
export class RealtimeModule {}
