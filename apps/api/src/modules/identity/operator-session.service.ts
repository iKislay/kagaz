import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { SignJWT, jwtVerify } from 'jose';
import {
  type OperatorLoginRequest,
  type OperatorLoginResponse,
  type OperatorRole,
} from '@kagaz/shared';
import { type DeviceContext, type OperatorContext } from '../../common/auth/device-auth.guard.js';
import { APP_CONFIG } from '../../common/config/config.module.js';
import { type AppConfig } from '../../common/config/config.schema.js';
import { AppError } from '../../common/http/api-exception.filter.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { LoginRateLimiter } from './login-rate-limiter.js';
import { loginWhere, verifyPassword } from './passwords.js';

export const OPERATOR_SESSION_HOURS = 12;

/**
 * Operator sessions on a paired device (contract §4, P2.3). The token is a signed JWT bound to
 * the device; its `jti` is an `operator_sessions` row so logout and device revocation take
 * effect immediately. Only members (OWNER/OPERATOR) of the device's own shop can sign in —
 * anyone else gets the same 401 INVALID_CREDENTIALS as a wrong password.
 */
@Injectable()
export class OperatorSessionService {
  private readonly logger = new Logger(OperatorSessionService.name);
  /** Per device + login: 5 failures / 10 min. */
  private readonly limiter = new LoginRateLimiter();
  /** Per client IP across logins: 20 failures / 10 min. */
  private readonly ipLimiter = new LoginRateLimiter(20);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  async login(
    device: DeviceContext,
    body: OperatorLoginRequest,
    ip: string,
  ): Promise<OperatorLoginResponse> {
    const login = body.login.trim();
    const key = `${device.deviceId}|${login.toLowerCase()}`;
    if (this.limiter.isBlocked(key) || this.ipLimiter.isBlocked(ip)) throw rateLimited();

    const user = await this.prisma.user.findUnique({
      where: loginWhere(login),
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        kind: true,
        passwordHash: true,
        shopMemberships: { where: { shopId: device.shopId }, select: { role: true } },
      },
    });
    const passwordOk = await verifyPassword(user?.passwordHash, body.password);
    const membership = user?.kind === 'STAFF' ? user.shopMemberships[0] : undefined;

    if (!user || !passwordOk || !membership) {
      const blocked = this.limiter.fail(key);
      this.ipLimiter.fail(ip);
      await this.audit(device, null, 'operator.login_failed', {
        reason: !user ? 'unknown_login' : !passwordOk ? 'wrong_password' : 'not_shop_member',
        userId: user?.id ?? null,
      });
      this.logger.warn(
        { deviceId: device.deviceId, shopId: device.shopId },
        'Operator login failed',
      );
      if (blocked) throw rateLimited();
      throw new AppError(
        'INVALID_CREDENTIALS',
        'Wrong login or password for this shop',
        HttpStatus.UNAUTHORIZED,
      );
    }
    this.limiter.reset(key);

    const role: OperatorRole = membership.role === 'OWNER' ? 'SHOP_OWNER' : 'SHOP_OPERATOR';
    const expiresAt = new Date(Date.now() + OPERATOR_SESSION_HOURS * 3_600_000);
    const session = await this.prisma.operatorSession.create({
      data: { userId: user.id, deviceId: device.deviceId, shopId: device.shopId, expiresAt },
    });
    const operatorToken = await new SignJWT({ typ: 'operator', did: device.deviceId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setJti(session.id)
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(this.key());

    const name = displayName(user);
    await this.audit(device, user.id, 'operator.login', { role, sessionId: session.id });
    return {
      operatorToken,
      expiresAt: expiresAt.toISOString(),
      operator: { id: user.id, name, role },
    };
  }

  /** Ends the session carried by the token (idempotent; an invalid token is simply ignored). */
  async logout(device: DeviceContext, token: string | undefined): Promise<void> {
    const op = token ? await this.verify(device, token).catch(() => null) : null;
    if (!op) return;
    await this.prisma.operatorSession.updateMany({
      where: { id: op.sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit(device, op.userId, 'operator.logout', { sessionId: op.sessionId });
  }

  /**
   * Validates an operator token for this device: signature + expiry, bound to the same device,
   * session row live, and the user still a member of the device's shop.
   */
  async verify(device: DeviceContext, token: string): Promise<OperatorContext> {
    let sub: string;
    let jti: string;
    try {
      const { payload } = await jwtVerify(token, this.key(), { algorithms: ['HS256'] });
      if (
        payload.typ !== 'operator' ||
        payload.did !== device.deviceId ||
        typeof payload.sub !== 'string' ||
        typeof payload.jti !== 'string'
      ) {
        throw new Error('wrong token');
      }
      sub = payload.sub;
      jti = payload.jti;
    } catch {
      throw operatorLoginRequired();
    }

    const session = await this.prisma.operatorSession.findUnique({ where: { id: jti } });
    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.userId !== sub ||
      session.deviceId !== device.deviceId
    ) {
      throw operatorLoginRequired();
    }
    const member = await this.prisma.shopUser.findUnique({
      where: { shopId_userId: { shopId: device.shopId, userId: sub } },
      select: { role: true, user: { select: { name: true, email: true, phone: true } } },
    });
    if (!member) throw operatorLoginRequired();
    return {
      userId: sub,
      name: displayName(member.user),
      role: member.role === 'OWNER' ? 'SHOP_OWNER' : 'SHOP_OPERATOR',
      sessionId: session.id,
    };
  }

  /** Kills every live operator session on a device (revocation, token rotation by admin). */
  async revokeForDevice(deviceId: string): Promise<number> {
    const res = await this.prisma.operatorSession.updateMany({
      where: { deviceId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return res.count;
  }

  private key() {
    return new TextEncoder().encode(this.config.SESSION_JWT_SECRET);
  }

  private async audit(
    device: DeviceContext,
    userId: string | null,
    action: string,
    metadata: Record<string, string | null>,
  ) {
    await this.prisma.auditLog.create({
      data: {
        actorType: userId ? 'STAFF' : 'DEVICE',
        actorId: userId ?? device.deviceId,
        shopId: device.shopId,
        action,
        metadata: { ...metadata, deviceId: device.deviceId },
      },
    });
  }
}

export function displayName(u: {
  name: string | null;
  email: string | null;
  phone: string | null;
}): string {
  return u.name ?? u.email ?? u.phone ?? 'Staff';
}

export function operatorLoginRequired(): AppError {
  return new AppError(
    'OPERATOR_LOGIN_REQUIRED',
    'An operator must sign in on this device first',
    HttpStatus.UNAUTHORIZED,
  );
}

function rateLimited(): AppError {
  return new AppError(
    'RATE_LIMITED',
    'Too many failed sign-in attempts. Please wait and try again.',
    HttpStatus.TOO_MANY_REQUESTS,
  );
}
