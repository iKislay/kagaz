import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { APP_CONFIG } from '../../../common/config/config.module.js';
import { type AppConfig } from '../../../common/config/config.schema.js';
import { PrismaService } from '../../../common/prisma/prisma.service.js';
import { hashPassword, verifyPassword } from '../../identity/passwords.js';

/**
 * ADMIN_EMAIL + ADMIN_PASSWORD (set in the host's secret manager) define the /admin login: on boot
 * the account is created, or its password reset when it no longer matches. Unset = no-op, so
 * local/demo keep using the seed. The password is only ever stored as an Argon2id hash.
 */
@Injectable()
export class AdminBootstrapService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminBootstrapService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const { ADMIN_EMAIL: email, ADMIN_PASSWORD: password } = this.config;
    if (!email || !password) return;

    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, kind: true, passwordHash: true },
    });
    if (existing?.kind === 'ADMIN' && (await verifyPassword(existing.passwordHash, password)))
      return;

    const passwordHash = await hashPassword(password);
    const user = await this.prisma.user.upsert({
      where: { email },
      update: { kind: 'ADMIN', passwordHash },
      create: { email, name: 'Kagaz Admin', kind: 'ADMIN', passwordHash },
    });
    await this.prisma.auditLog.create({
      data: {
        actorType: 'SYSTEM',
        action: existing ? 'admin.password_set_from_env' : 'admin.created_from_env',
        metadata: { userId: user.id },
      },
    });
    this.logger.log(
      { userId: user.id },
      existing ? 'Admin password updated from env' : 'Admin created from env',
    );
  }
}
