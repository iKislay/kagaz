import { Injectable, HttpStatus, Logger } from '@nestjs/common';
import { verify } from '@node-rs/argon2';
import { SignJWT } from 'jose';
import { APP_CONFIG } from '../../../common/config/config.module.js';
import { type AppConfig } from '../../../common/config/config.schema.js';
import { Inject } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service.js';
import { AppError } from '../../../common/http/api-exception.filter.js';
import { type AdminLoginRequest, AdminLoginResponseSchema } from '@kagaz/shared';

/**
 * Admin authentication (PRD §11.3, FR-ADMIN-01).
 *
 * Wrong email and wrong password both yield 401 ADMIN_LOGIN_FAILED so the two
 * cases are indistinguishable. Failed attempts are rate-limited per IP+email.
 * Every login success and failure is written to audit_logs (actorType ADMIN).
 */
@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);
  private readonly failures = new Map<string, number[]>();
  private readonly windowMs = 10 * 60 * 1000;
  private readonly maxFailures = 5;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  async login(body: AdminLoginRequest, ip: string) {
    const key = `${ip}|${body.email.toLowerCase()}`;
    this.prune(key);
    const attempts = (this.failures.get(key) ?? []).length;
    if (attempts >= this.maxFailures) {
      throw new AppError(
        'ADMIN_RATE_LIMITED',
        'Too many failed login attempts. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { email: body.email },
      select: { id: true, email: true, name: true, passwordHash: true, kind: true },
    });

    const ok =
      !!user &&
      user.kind === 'ADMIN' &&
      typeof user.passwordHash === 'string' &&
      (await verify(user.passwordHash, body.password));

    if (!ok) {
      this.recordFailure(key);
      const nowCount = (this.failures.get(key) ?? []).length;
      await this.audit('ADMIN_LOGIN_FAILED', user?.id ?? null, ip, {
        email: body.email,
        reason: !user ? 'unknown_email' : user.kind !== 'ADMIN' ? 'not_admin' : 'wrong_password',
      });
      this.logger.warn({ ip, email: body.email }, 'Admin login failed');
      if (nowCount >= this.maxFailures) {
        throw new AppError(
          'ADMIN_RATE_LIMITED',
          'Too many failed login attempts. Please try again later.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      throw new AppError(
        'ADMIN_LOGIN_FAILED',
        'Invalid email or password',
        HttpStatus.UNAUTHORIZED,
      );
    }

    this.failures.delete(key);
    const token = await new SignJWT({ sub: user.id, kind: 'ADMIN', email: user.email })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('12h')
      .sign(new TextEncoder().encode(this.config.SESSION_JWT_SECRET));

    await this.audit('ADMIN_LOGIN_SUCCESS', user.id, ip, { email: user.email });

    const cookie = this.cookieString(token);
    return {
      cookie,
      admin: AdminLoginResponseSchema.parse({
        admin: { id: user.id, email: user.email },
      }).admin,
    };
  }

  logoutCookie() {
    return this.cookieString(null);
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, kind: true, createdAt: true },
    });
    if (!user || user.kind !== 'ADMIN') {
      throw new AppError(
        'ADMIN_UNAUTHENTICATED',
        'Admin account not found',
        HttpStatus.UNAUTHORIZED,
      );
    }
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      kind: user.kind,
      createdAt: user.createdAt,
    };
  }

  private recordFailure(key: string) {
    const now = Date.now();
    const attempts = [...(this.failures.get(key) ?? []), now];
    this.failures.set(key, attempts);
  }

  private prune(key: string) {
    const now = Date.now();
    const attempts = (this.failures.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (attempts.length === 0) this.failures.delete(key);
    else this.failures.set(key, attempts);
  }

  private cookieString(token: string | null) {
    const secure = this.config.APP_ENV !== 'local';
    const maxAge = token === null ? 0 : 12 * 60 * 60;
    const value = token === null ? '' : token;
    return `kgz_admin=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  }

  private async audit(
    action: string,
    actorId: string | null,
    ip: string,
    metadata: { [key: string]: string | number | boolean | null | undefined },
  ) {
    await this.prisma.auditLog
      .create({
        data: { actorType: 'ADMIN', actorId, shopId: null, orderId: null, action, metadata, ip },
      })
      .catch((err) => {
        this.logger.error({ err, action }, 'Failed to write admin audit log');
      });
  }
}
