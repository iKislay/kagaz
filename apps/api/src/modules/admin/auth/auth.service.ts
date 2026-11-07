import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { type AdminLoginRequest, type AdminLoginResponse, type AdminMe } from '@kagaz/shared';
import { APP_CONFIG } from '../../../common/config/config.module.js';
import { type AppConfig } from '../../../common/config/config.schema.js';
import { AppError } from '../../../common/http/api-exception.filter.js';
import { PrismaService } from '../../../common/prisma/prisma.service.js';
import { LoginRateLimiter } from '../../identity/login-rate-limiter.js';
import { loginWhere, verifyPassword } from '../../identity/passwords.js';
import {
  resolveStaff,
  signStaffToken,
  staffCookie,
  notAuthenticated,
} from '../../identity/staff-session.js';

/**
 * Staff web sign-in (PRD §11.3, FR-ADMIN-01, P2.3) for ADMIN, SHOP_OWNER and SHOP_OPERATOR.
 *
 * Unknown login, wrong password and a user without a staff role all yield
 * 401 ADMIN_LOGIN_FAILED so the cases are indistinguishable. Failures are rate-limited per
 * IP+login and every success/failure is audited.
 */
@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);
  private readonly limiter = new LoginRateLimiter();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  async login(body: AdminLoginRequest, ip: string) {
    const login = (body.login ?? body.email ?? '').trim();
    const key = `${ip}|${login.toLowerCase()}`;
    if (this.limiter.isBlocked(key)) throw rateLimited();

    const user = await this.prisma.user.findUnique({
      where: loginWhere(login),
      select: { id: true, email: true, passwordHash: true },
    });
    const passwordOk = await verifyPassword(user?.passwordHash, body.password);
    const staff = user && passwordOk ? await resolveStaff(this.prisma, user.id) : null;

    if (!user || !staff) {
      const blocked = this.limiter.fail(key);
      await this.audit('ADMIN_LOGIN_FAILED', user?.id ?? null, ip, {
        login,
        reason: !user ? 'unknown_login' : !passwordOk ? 'wrong_password' : 'no_staff_role',
      });
      this.logger.warn({ ip }, 'Staff login failed');
      if (blocked) throw rateLimited();
      throw new AppError(
        'ADMIN_LOGIN_FAILED',
        'Invalid email or password',
        HttpStatus.UNAUTHORIZED,
      );
    }

    this.limiter.reset(key);
    const token = await signStaffToken(this.config.SESSION_JWT_SECRET, user.id);
    await this.audit('ADMIN_LOGIN_SUCCESS', user.id, ip, { login, role: staff.role });

    const admin: AdminLoginResponse['admin'] = { id: user.id, email: user.email, role: staff.role };
    return { cookie: staffCookie(token, this.secureCookies()), admin };
  }

  logoutCookie() {
    return staffCookie(null, this.secureCookies());
  }

  async me(userId: string): Promise<AdminMe> {
    const staff = await resolveStaff(this.prisma, userId);
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        phone: true,
        name: true,
        shopMemberships: {
          select: { role: true, shop: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!staff || !user) throw notAuthenticated();
    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      name: user.name,
      role: staff.role,
      shops: user.shopMemberships.map((m) => ({
        id: m.shop.id,
        name: m.shop.name,
        role: m.role === 'OWNER' ? ('SHOP_OWNER' as const) : ('SHOP_OPERATOR' as const),
      })),
    };
  }

  private secureCookies() {
    return this.config.APP_ENV !== 'local';
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
      .catch((err: unknown) => {
        this.logger.error({ err, action }, 'Failed to write admin audit log');
      });
  }
}

function rateLimited(): AppError {
  return new AppError(
    'ADMIN_RATE_LIMITED',
    'Too many failed login attempts. Please try again later.',
    HttpStatus.TOO_MANY_REQUESTS,
  );
}
