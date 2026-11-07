import {
  type CallHandler,
  type ExecutionContext,
  HttpStatus,
  Injectable,
  Logger,
  type NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants.js';
import { Reflector } from '@nestjs/core';
import { type Request, type Response } from 'express';
import { type Observable, catchError, from, mergeMap, of, throwError } from 'rxjs';
import { type DeviceContext } from '../auth/device-auth.guard.js';
import { sha256Hex } from '../crypto/tokens.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AppError } from './api-exception.filter.js';

export const IDEMPOTENCY_HEADER = 'idempotency-key';
const SKIP_IDEMPOTENCY = Symbol('skipIdempotency');
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const KEY_FORMAT = /^[A-Za-z0-9._:-]{8,128}$/;
/** An in-progress reservation older than this is treated as abandoned (crashed request). */
const STALE_RESERVATION_MS = 2 * 60_000;
/** responseStatus of a reservation whose request hasn't finished yet. */
const IN_PROGRESS = 0;

/**
 * Opt a handler out, e.g. lease: its response carries a signed URL (a bearer secret that
 * must not be persisted) and lease is natively idempotent for the lease holder.
 */
export const SkipIdempotency = () => SetMetadata(SKIP_IDEMPOTENCY, true);

/**
 * `Idempotency-Key` support for mutating shop/agent endpoints (PRD §9.4 rule 6, P2.1).
 *
 * Scope = the authenticated device. The first request reserves (scope, key) with a hash of
 * method + path + body, runs, and stores its successful response. A replay with the same
 * hash gets the stored status + body without running the handler again (so no extra events
 * or audit rows); a different request with the same key → `409 IDEMPOTENCY_KEY_REUSED`; a
 * replay while the first is still running → `409 IDEMPOTENCY_REQUEST_IN_PROGRESS`.
 * Errors are not stored: the reservation is released so the client can retry.
 * Requests without the header behave exactly as before.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  private readonly logger = new Logger(IdempotencyInterceptor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request & { device?: DeviceContext }>();
    const res = http.getResponse<Response>();
    const handler = context.getHandler();

    const key = req.headers[IDEMPOTENCY_HEADER];
    if (
      key === undefined ||
      !MUTATING.has(req.method) ||
      this.reflector.get<boolean>(SKIP_IDEMPOTENCY, handler) ||
      !req.device
    ) {
      return next.handle();
    }
    if (typeof key !== 'string' || !KEY_FORMAT.test(key)) {
      throw new AppError(
        'IDEMPOTENCY_KEY_INVALID',
        'Idempotency-Key must be 8-128 characters of A-Z a-z 0-9 . _ : -',
        HttpStatus.BAD_REQUEST,
      );
    }

    const scope = `device:${req.device.deviceId}`;
    const path = (req.originalUrl ?? req.url).split('?')[0];
    const requestHash = sha256Hex(
      JSON.stringify({ method: req.method, path, body: canonical(req.body) }),
    );

    const replay = await this.reserve(scope, key, requestHash);
    if (replay) {
      res.status(replay.status);
      return of(replay.body);
    }

    const status =
      this.reflector.get<number>(HTTP_CODE_METADATA, handler) ??
      (req.method === 'POST' ? HttpStatus.CREATED : HttpStatus.OK);
    return next.handle().pipe(
      mergeMap(async (body: unknown) => {
        await this.prisma.idempotencyRecord.update({
          where: { scope_key: { scope, key } },
          data: { responseStatus: status, responseBody: toJson(body) },
        });
        return body;
      }),
      catchError((err: unknown) =>
        from(this.release(scope, key)).pipe(mergeMap(() => throwError(() => err))),
      ),
    );
  }

  /** Reserve the key, or return the stored response for a matching replay. */
  private async reserve(
    scope: string,
    key: string,
    requestHash: string,
    retried = false,
  ): Promise<{ status: number; body: unknown } | null> {
    try {
      await this.prisma.idempotencyRecord.create({
        data: { scope, key, requestHash, responseStatus: IN_PROGRESS, responseBody: {} },
      });
      return null;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }

    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: { scope_key: { scope, key } },
    });
    if (!existing) {
      if (retried) throw inProgress();
      return this.reserve(scope, key, requestHash, true); // released meanwhile
    }
    if (existing.requestHash !== requestHash) {
      throw new AppError(
        'IDEMPOTENCY_KEY_REUSED',
        'This Idempotency-Key was already used for a different request',
        HttpStatus.CONFLICT,
      );
    }
    if (existing.responseStatus === IN_PROGRESS) {
      const stale = Date.now() - existing.createdAt.getTime() > STALE_RESERVATION_MS;
      if (stale && !retried) {
        await this.release(scope, key);
        return this.reserve(scope, key, requestHash, true);
      }
      throw inProgress();
    }
    return { status: existing.responseStatus, body: existing.responseBody };
  }

  private async release(scope: string, key: string): Promise<void> {
    try {
      await this.prisma.idempotencyRecord.deleteMany({
        where: { scope, key, responseStatus: IN_PROGRESS },
      });
    } catch (err) {
      this.logger.error({ err }, 'failed to release idempotency reservation');
    }
  }
}

function inProgress(): AppError {
  return new AppError(
    'IDEMPOTENCY_REQUEST_IN_PROGRESS',
    'A request with this Idempotency-Key is still being processed; retry shortly',
    HttpStatus.CONFLICT,
  );
}

/** Key-order-independent JSON value, so {a,b} and {b,a} hash the same. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, canonical((value as Record<string, unknown>)[k])]),
    );
  }
  return value ?? null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma Json input
function toJson(body: unknown): any {
  return body === undefined ? {} : (JSON.parse(JSON.stringify(body ?? null)) ?? {});
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
}
