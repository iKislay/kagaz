import { Inject, Injectable } from '@nestjs/common';
import { type Request, type Response } from 'express';
import { SignJWT, jwtVerify } from 'jose';
import { CUSTOMER_SESSION_COOKIE } from '@kagaz/shared';
import { APP_CONFIG } from '../config/config.module.js';
import { type AppConfig, environmentProfile } from '../config/config.schema.js';

export interface CustomerSession {
  customerId: string;
  phone: string;
}

const SESSION_DAYS = 7;

/** Minimal Cookie header parser. */
function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

/**
 * Customer session (P2.2, contract §6): `kagaz_session` cookie holding a signed HS256 JWT
 * `{ sub: userId, kind: "CUSTOMER", phone }`, 7-day expiry, httpOnly, SameSite=Lax, Secure
 * outside local. Also usable by the realtime gateway to authenticate `/customer` sockets.
 */
@Injectable()
export class CustomerSessionService {
  private readonly key: Uint8Array;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.key = new TextEncoder().encode(config.SESSION_JWT_SECRET);
  }

  async issue(res: Response, session: CustomerSession): Promise<void> {
    const token = await new SignJWT({ kind: 'CUSTOMER', phone: session.phone })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(session.customerId)
      .setIssuedAt()
      .setExpirationTime(`${SESSION_DAYS}d`)
      .sign(this.key);
    res.cookie(CUSTOMER_SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: environmentProfile(this.config.APP_ENV).secureCookies,
      path: '/',
      maxAge: SESSION_DAYS * 86_400_000,
    });
  }

  clear(res: Response): void {
    res.clearCookie(CUSTOMER_SESSION_COOKIE, {
      httpOnly: true,
      sameSite: 'lax',
      secure: environmentProfile(this.config.APP_ENV).secureCookies,
      path: '/',
    });
  }

  /** Verify a raw token (cookie value). Invalid/expired/foreign tokens → null. */
  async verify(token: string | undefined | null): Promise<CustomerSession | null> {
    if (!token) return null;
    try {
      const { payload } = await jwtVerify(token, this.key, { algorithms: ['HS256'] });
      if (payload.kind !== 'CUSTOMER' || typeof payload.sub !== 'string') return null;
      if (typeof payload.phone !== 'string') return null;
      return { customerId: payload.sub, phone: payload.phone };
    } catch {
      return null;
    }
  }

  /** Session from a request's cookie header, or null. */
  fromRequest(req: Pick<Request, 'headers'>): Promise<CustomerSession | null> {
    return this.verify(readCookie(req.headers.cookie, CUSTOMER_SESSION_COOKIE));
  }
}
