import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { type Request } from 'express';
import { jwtVerify } from 'jose';
import { APP_CONFIG } from '../../../common/config/config.module.js';
import { type AppConfig } from '../../../common/config/config.schema.js';
import { Inject } from '@nestjs/common';
import { AppError } from '../../../common/http/api-exception.filter.js';

/**
 * Protects every `/api/admin/*` route. Authenticates via the httpOnly `kgz_admin`
 * cookie (or a Bearer token for tooling). Sets `req.admin`.
 */
@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AdminRequest>();
    const token = readCookie(req.headers.cookie, 'kgz_admin') ?? bearerToken(req);
    if (!token) throw notAuthenticated();

    try {
      const { payload } = await jwtVerify(
        token,
        new TextEncoder().encode(this.config.SESSION_JWT_SECRET),
        { algorithms: ['HS256'] },
      );
      if (payload.kind !== 'ADMIN' || typeof payload.sub !== 'string') {
        throw notAuthenticated();
      }
      req.admin = {
        userId: payload.sub,
        email: typeof payload.email === 'string' ? payload.email : '',
      };
      return true;
    } catch {
      throw notAuthenticated();
    }
  }
}

type AdminRequest = Request & { admin?: { userId: string; email: string } };

function bearerToken(req: Request): string | null {
  const header = req.headers.authorization ?? '';
  const match = /^Bearer (.+)$/.exec(header);
  return match?.[1] ?? null;
}

function notAuthenticated(): AppError {
  return new AppError('ADMIN_UNAUTHENTICATED', 'Admin sign-in required', HttpStatus.UNAUTHORIZED);
}

/** Minimal Cookie header parser (mirrors orders/tracking.guard.ts). */
function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}
