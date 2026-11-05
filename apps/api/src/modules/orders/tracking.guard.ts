import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { type Request } from 'express';
import { TRACKING_TOKEN_HEADER, trackingCookieName } from '@kagaz/shared';
import { AppError } from '../../common/http/api-exception.filter.js';
import { OrdersService } from './orders.service.js';

/** Minimal Cookie header parser (no dependency needed for one cookie). */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

/**
 * Customer access to /api/orders/:id* — requires the order's tracking token, from the
 * x-tracking-token header or the per-order httpOnly cookie. Wrong token and unknown order
 * both answer 404, so order ids can't be probed.
 */
@Injectable()
export class TrackingGuard implements CanActivate {
  constructor(private readonly orders: OrdersService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const orderId = req.params.id;
    const header = req.headers[TRACKING_TOKEN_HEADER];
    const token =
      (typeof header === 'string' ? header : undefined) ??
      (typeof orderId === 'string'
        ? readCookie(req.headers.cookie, trackingCookieName(orderId))
        : undefined);

    const uuid = /^[0-9a-f-]{36}$/i;
    if (typeof orderId !== 'string' || !uuid.test(orderId) || !token) throw notFound();
    const order = await this.orders.findByTrackingToken(orderId, token);
    if (!order) throw notFound();
    return true;
  }
}

function notFound(): AppError {
  return new AppError('ORDER_NOT_FOUND', 'Order not found', HttpStatus.NOT_FOUND);
}
