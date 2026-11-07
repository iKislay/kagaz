import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client.js';
import { APP_CONFIG } from '../config/config.module.js';
import { runInCommitScope } from '../events/after-commit.js';
import { type AppConfig } from '../config/config.schema.js';

/**
 * Prisma client for the whole API. Connects lazily on first query so the API can boot
 * (and report db: "error" on /api/health) even while Postgres is down.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super({ adapter: new PrismaPg({ connectionString: config.DATABASE_URL }) });
    // Every transaction runs in a commit scope so afterCommit() callbacks (realtime events)
    // fire only once it has committed — transparent to callers of $transaction.
    const base = this.$transaction.bind(this) as unknown as (
      ...args: unknown[]
    ) => Promise<unknown>;
    const logger = new Logger('PrismaService');
    this.$transaction = ((...args: unknown[]) =>
      runInCommitScope(
        () => base(...args),
        (err) => logger.error({ err }, 'afterCommit callback failed'),
      )) as unknown as PrismaClient['$transaction'];
  }

  async ping(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
