import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { APP_CONFIG } from '../../../common/config/config.module.js';
import { type AppConfig } from '../../../common/config/config.schema.js';
import { PrismaService } from '../../../common/prisma/prisma.service.js';
import { hashPassword, verifyPassword } from '../../identity/passwords.js';

/**
 * The Kagaz superadmin comes from SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD. At startup (and again
 * on that login if the DB was unreachable at boot) it is synced to a User of kind ADMIN, so it
 * signs in like any admin and owns its audit rows. The .env is the source of truth: changing
 * the password there rotates it on the next start, and the account can't be removed or have its
 * password reset from /sudoadmin. The password itself is never logged or stored in plaintext.
 */
@Injectable()
export class SuperAdminService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SuperAdminService.name);
  private synced: Promise<string | null> | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  /** Lowercased superadmin email, or null when not configured. */
  get email(): string | null {
    return this.config.SUPERADMIN_EMAIL ?? null;
  }

  isSuperAdmin(user: { email: string | null }): boolean {
    return !!this.email && user.email === this.email;
  }

  onApplicationBootstrap(): void {
    // Don't block or fail boot (the API must start even while Postgres is down).
    void this.ensureSynced();
  }

  /** Superadmin user id once synced; null when unconfigured or the sync failed (retried later). */
  ensureSynced(): Promise<string | null> {
    if (!this.email) return Promise.resolve(null);
    this.synced ??= this.sync().catch((err: unknown) => {
      this.synced = null;
      this.logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        'Could not set up the SUPERADMIN_EMAIL account',
      );
      return null;
    });
    return this.synced;
  }

  private async sync(): Promise<string> {
    const email = this.email!;
    const password = this.config.SUPERADMIN_PASSWORD!;
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (user && user.kind !== 'ADMIN') {
      // Never silently turn a shop owner or customer into a platform admin.
      throw new Error(
        `SUPERADMIN_EMAIL belongs to an existing ${user.kind} account; use another email`,
      );
    }
    if (user && (await verifyPassword(user.passwordHash, password))) return user.id;

    const passwordHash = await hashPassword(password);
    const saved = user
      ? await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } })
      : await this.prisma.user.create({
          data: { email, name: 'Kagaz Superadmin', kind: 'ADMIN', passwordHash },
        });
    await this.prisma.auditLog.create({
      data: {
        actorType: 'SYSTEM',
        action: user ? 'superadmin.password_synced' : 'superadmin.created',
        metadata: { userId: saved.id, source: 'env' },
      },
    });
    this.logger.log(
      { userId: saved.id },
      user ? 'Superadmin password updated from .env' : 'Superadmin created from .env',
    );
    return saved.id;
  }
}
