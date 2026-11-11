import { Inject, Injectable, type OnModuleDestroy, Optional } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client.js';
import { APP_CONFIG } from '../config/config.module.js';
import { type AppConfig } from '../config/config.schema.js';
import { DomainEventBus } from '../events/domain-events.js';
import { assertTenantScoped, currentTenantShop } from './tenant-scope.js';

/**
 * Prisma client for the whole API. Connects lazily on first query so the API can boot
 * (and report db: "error" on /api/health) even while Postgres is down.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    @Optional() readonly domainEvents?: DomainEventBus,
  ) {
    super({ adapter: new PrismaPg({ connectionString: config.DATABASE_URL }) });
    // Tenant guard (P4.1): in a request bound to a shop device, every query on a shop-owned model
    // must be pinned to that shop (see tenant-scope.ts). The extended client forwards everything
    // else (ping, domainEvents, the patched $transaction) to this instance, so Nest injects it as
    // the PrismaService.
    return this.$extends({
      query: {
        $allModels: {
          $allOperations({ model, operation, args, query }) {
            const shopId = currentTenantShop();
            if (shopId) assertTenantScoped(model, operation, args, shopId);
            return query(args);
          },
        },
      },
    }) as unknown as PrismaService;
  }

  async ping(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

/**
 * Interactive transactions get a post-commit domain-event queue (P2.1): events published with
 * the `tx` client (DomainEventBus.publish) are emitted only after the transaction COMMITS, and
 * dropped on rollback. Batch (array) transactions pass straight through. Patched onto the
 * prototype (rather than a TS override) so callers keep Prisma's exact overloaded types.
 */
const baseTransaction = PrismaClient.prototype.$transaction as (
  this: PrismaClient,
  arg: unknown,
  options?: unknown,
) => Promise<unknown>;

Object.defineProperty(PrismaService.prototype, '$transaction', {
  configurable: true,
  writable: true,
  value: function $transaction(this: PrismaService, arg: unknown, options?: unknown) {
    const events = this.domainEvents;
    if (typeof arg !== 'function' || !events) return baseTransaction.call(this, arg, options);
    const fn = arg as (tx: object) => Promise<unknown>;
    let queue: ReturnType<DomainEventBus['open']> = [];
    return baseTransaction
      .call(
        this,
        (tx: object) => {
          queue = events.open(tx);
          return fn(tx);
        },
        options,
      )
      .then((result) => {
        events.flush(queue);
        return result;
      });
  },
});
