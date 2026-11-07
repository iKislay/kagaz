import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
  SetMetadata,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type Request } from 'express';
import { SignJWT, jwtVerify } from 'jose';
import { type StaffRole } from '@kagaz/shared';
import { type Actor } from '../../common/actor.js';
import { APP_CONFIG } from '../../common/config/config.module.js';
import { type AppConfig } from '../../common/config/config.schema.js';
import { AppError } from '../../common/http/api-exception.filter.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';

/**
 * Web staff sessions (P2.3): ADMIN, SHOP_OWNER, SHOP_OPERATOR sign in with email/phone +
 * Argon2id password and get an httpOnly `kgz_admin` cookie holding an HS256 JWT (12 h).
 * Roles are re-derived from the database on every request, so membership changes apply at once.
 */
export const STAFF_COOKIE = 'kgz_admin';
export const STAFF_SESSION_HOURS = 12;

export interface StaffContext {
  userId: string;
  email: string | null;
  role: StaffRole;
  /** Shops where the user is OWNER (owners) or any member (operators). Empty for admins. */
  shopIds: string[];
}

export type StaffRequest = Request & {
  staff?: StaffContext;
  /** Back-compat for Phase 1 admin controllers. */
  admin?: { userId: string; email: string };
};

/** The audit actor for a web staff action. */
export function staffActor(staff: StaffContext): Actor {
  return { type: staff.role === 'ADMIN' ? 'ADMIN' : 'STAFF', id: staff.userId };
}

export async function signStaffToken(secret: string, userId: string): Promise<string> {
  return new SignJWT({ typ: 'staff' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${STAFF_SESSION_HOURS}h`)
    .sign(new TextEncoder().encode(secret));
}

export function staffCookie(token: string | null, secure: boolean): string {
  const maxAge = token === null ? 0 : STAFF_SESSION_HOURS * 60 * 60;
  return `${STAFF_COOKIE}=${token ?? ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${
    secure ? '; Secure' : ''
  }`;
}

/** Loads a user's effective web role; null when the user can't hold a staff session. */
export async function resolveStaff(
  prisma: PrismaService,
  userId: string,
): Promise<StaffContext | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      kind: true,
      shopMemberships: { select: { shopId: true, role: true } },
    },
  });
  if (!user) return null;
  if (user.kind === 'ADMIN') {
    return { userId: user.id, email: user.email, role: 'ADMIN', shopIds: [] };
  }
  if (user.kind !== 'STAFF' || user.shopMemberships.length === 0) return null;
  const owned = user.shopMemberships.filter((m) => m.role === 'OWNER').map((m) => m.shopId);
  return owned.length > 0
    ? { userId: user.id, email: user.email, role: 'SHOP_OWNER', shopIds: owned }
    : {
        userId: user.id,
        email: user.email,
        role: 'SHOP_OPERATOR',
        shopIds: user.shopMemberships.map((m) => m.shopId),
      };
}

/** Authenticates any staff web session (cookie, or Bearer for tooling). Sets `req.staff`. */
@Injectable()
export class StaffAuthGuard implements CanActivate {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<StaffRequest>();
    if (req.staff) return true;
    const token = readCookie(req.headers.cookie, STAFF_COOKIE) ?? bearerToken(req);
    if (!token) throw notAuthenticated();

    let userId: string;
    try {
      const { payload } = await jwtVerify(
        token,
        new TextEncoder().encode(this.config.SESSION_JWT_SECRET),
        { algorithms: ['HS256'] },
      );
      if (payload.typ !== 'staff' || typeof payload.sub !== 'string') throw notAuthenticated();
      userId = payload.sub;
    } catch {
      throw notAuthenticated();
    }
    const staff = await resolveStaff(this.prisma, userId);
    if (!staff) throw notAuthenticated();
    req.staff = staff;
    if (staff.role === 'ADMIN') req.admin = { userId: staff.userId, email: staff.email ?? '' };
    return true;
  }
}

const ROLES_KEY = 'kagaz:roles';
/** Allowed web roles for a route; used with RolesGuard. Without it, only ADMIN passes. */
export const Roles = (...roles: StaffRole[]) => SetMetadata(ROLES_KEY, roles);

/** Must run after StaffAuthGuard. A staff member without the role gets 403 FORBIDDEN. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<StaffRequest>();
    if (!req.staff) throw notAuthenticated();
    const allowed = this.reflector.getAllAndOverride<StaffRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) ?? ['ADMIN'];
    if (!allowed.includes(req.staff.role)) {
      throw new AppError('FORBIDDEN', 'Your role cannot perform this action', HttpStatus.FORBIDDEN);
    }
    return true;
  }
}

/**
 * Tenant isolation for `/admin/shops/:id/*` (CLAUDE.md invariant 10): admins see every shop;
 * owners only shops they own. Another shop is indistinguishable from a missing one (404).
 */
@Injectable()
export class ShopScopeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<StaffRequest>();
    if (!req.staff) throw notAuthenticated();
    if (req.staff.role === 'ADMIN') return true;
    const shopId = req.params.id ?? req.params.shopId;
    if (typeof shopId === 'string' && req.staff.shopIds.includes(shopId)) return true;
    throw new AppError('SHOP_NOT_FOUND', 'Shop not found', HttpStatus.NOT_FOUND);
  }
}

export const CurrentStaff = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const staff = ctx.switchToHttp().getRequest<StaffRequest>().staff;
  if (!staff) throw notAuthenticated();
  return staff;
});

export function notAuthenticated(): AppError {
  return new AppError('ADMIN_UNAUTHENTICATED', 'Admin sign-in required', HttpStatus.UNAUTHORIZED);
}

function bearerToken(req: Request): string | null {
  const match = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
  return match?.[1] ?? null;
}

/** Minimal Cookie header parser (mirrors orders/tracking.guard.ts). */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}
