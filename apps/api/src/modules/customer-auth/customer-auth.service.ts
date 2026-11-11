import { randomInt } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { type Customer, type MyOrder, OrderStatus, type OtpRequestResponse } from '@kagaz/shared';
import { APP_CONFIG } from '../../common/config/config.module.js';
import { type AppConfig } from '../../common/config/config.schema.js';
import { hmacHex, safeEqualHex } from '../../common/crypto/tokens.js';
import { AppError } from '../../common/http/api-exception.filter.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { pickupDateString } from '../pickup/pickup-number.service.js';
import { maskPhoneLast4 } from './demo-otp.provider.js';
import { OTP_PROVIDER, type OtpProvider } from './otp-provider.js';

/** OTP policy (P2.2). Brute force is bounded: ≤ 3 codes / 10 min / phone × 5 tries each. */
export const OTP_POLICY = {
  codeTtlSeconds: 300,
  resendAfterSeconds: 30,
  perPhoneWindowSeconds: 600,
  perPhoneMax: 3,
  perIpWindowSeconds: 3600,
  perIpMax: 10,
  maxAttemptsPerCode: 5,
  verifyFailuresPerIpWindowSeconds: 600,
  verifyFailuresPerIpMax: 20,
} as const;

function tooMany(code: string, message: string, retryAfterSeconds?: number): AppError {
  return new AppError(
    code,
    message,
    HttpStatus.TOO_MANY_REQUESTS,
    retryAfterSeconds === undefined ? undefined : { retryAfterSeconds },
  );
}

@Injectable()
export class CustomerAuthService {
  private readonly logger = new Logger(CustomerAuthService.name);
  /** ip → failure timestamps (ms) for verify attempts. */
  private readonly verifyFailures = new Map<string, number[]>();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(OTP_PROVIDER) private readonly otp: OtpProvider,
    private readonly prisma: PrismaService,
  ) {}

  /** POST /api/auth/otp/request — rate-limited per phone and per IP. */
  async request(phone: string, ip: string | null): Promise<OtpRequestResponse> {
    const now = Date.now();
    const recent = await this.prisma.otpChallenge.findMany({
      where: {
        phone,
        createdAt: { gte: new Date(now - OTP_POLICY.perPhoneWindowSeconds * 1000) },
      },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    const last = recent[0];
    if (last && now - last.createdAt.getTime() < OTP_POLICY.resendAfterSeconds * 1000) {
      const wait = Math.ceil(
        (OTP_POLICY.resendAfterSeconds * 1000 - (now - last.createdAt.getTime())) / 1000,
      );
      throw tooMany('OTP_RESEND_TOO_SOON', `Please wait ${wait} s before asking again`, wait);
    }
    if (recent.length >= OTP_POLICY.perPhoneMax) {
      throw tooMany('OTP_RATE_LIMITED', 'Too many codes requested. Try again in a few minutes.');
    }
    if (ip) {
      const perIp = await this.prisma.otpChallenge.count({
        where: { ip, createdAt: { gte: new Date(now - OTP_POLICY.perIpWindowSeconds * 1000) } },
      });
      if (perIp >= OTP_POLICY.perIpMax) {
        throw tooMany('OTP_RATE_LIMITED', 'Too many codes requested. Try again later.');
      }
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const expiresAt = new Date(now + OTP_POLICY.codeTtlSeconds * 1000);
    await this.prisma.$transaction(async (tx) => {
      // Only the newest code is valid.
      await tx.otpChallenge.updateMany({
        where: { phone, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      await tx.otpChallenge.create({
        data: { phone, ip, codeHmac: this.hmac(phone, code), expiresAt },
      });
    });
    await this.otp.send({ phone, code, expiresAt });

    return {
      sentTo: maskPhoneLast4(phone),
      expiresInSeconds: OTP_POLICY.codeTtlSeconds,
      resendAfterSeconds: OTP_POLICY.resendAfterSeconds,
      demo: this.otp.simulated,
    };
  }

  /**
   * POST /api/auth/otp/verify. One-time: the code is consumed by a conditional update. Wrong
   * codes count against the code (locks after 5) and the caller's IP.
   */
  async verify(phone: string, code: string, ip: string | null): Promise<Customer> {
    const ipKey = ip ?? 'unknown';
    this.pruneFailures(ipKey);
    if ((this.verifyFailures.get(ipKey)?.length ?? 0) >= OTP_POLICY.verifyFailuresPerIpMax) {
      throw tooMany('OTP_RATE_LIMITED', 'Too many attempts. Try again in a few minutes.');
    }

    const challenge = await this.prisma.otpChallenge.findFirst({
      where: { phone, consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!challenge) throw this.invalid(ipKey);
    if (challenge.attempts >= OTP_POLICY.maxAttemptsPerCode) {
      throw tooMany('OTP_LOCKED', 'Too many wrong codes. Request a new code.');
    }

    if (!safeEqualHex(challenge.codeHmac, this.hmac(phone, code))) {
      const updated = await this.prisma.otpChallenge.update({
        where: { id: challenge.id },
        data: { attempts: { increment: 1 } },
      });
      if (updated.attempts >= OTP_POLICY.maxAttemptsPerCode) {
        await this.prisma.auditLog.create({
          data: {
            actorType: 'CUSTOMER',
            action: 'customer.otp_locked',
            metadata: { phone: maskPhoneLast4(phone) },
            ip,
          },
        });
      }
      throw this.invalid(ipKey);
    }

    const customer = await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.otpChallenge.updateMany({
        where: { id: challenge.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      if (consumed.count !== 1) throw this.invalid(ipKey);
      const user = await tx.user.upsert({
        where: { phone },
        update: {},
        create: { phone, kind: 'CUSTOMER' },
      });
      // Guest orders placed with this (now verified) phone become the customer's orders.
      await tx.order.updateMany({
        where: { customerPhone: phone, customerId: null },
        data: { customerId: user.id },
      });
      return user;
    });
    this.verifyFailures.delete(ipKey);
    this.logger.log({ customerId: customer.id }, 'customer signed in');
    return { id: customer.id, phone };
  }

  async me(customerId: string): Promise<Customer | null> {
    const user = await this.prisma.user.findUnique({ where: { id: customerId } });
    return user?.phone ? { id: user.id, phone: user.phone } : null;
  }

  /** GET /api/me/orders — the signed-in customer's orders, newest first. */
  async myOrders(customerId: string): Promise<MyOrder[]> {
    const orders = await this.prisma.order.findMany({
      where: { customerId, status: { not: OrderStatus.DRAFT } },
      include: {
        shop: { select: { name: true } },
        payments: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return orders.map((o) => ({
      id: o.id,
      publicRef: o.publicRef,
      status: o.status,
      shopName: o.shop.name,
      amountPaise: o.amountPaise,
      paymentStatus: o.payments[0]?.status ?? null,
      isSimulated: o.payments[0]?.isSimulated ?? false,
      pickupNumber: o.pickupNumber,
      pickupDate: pickupDateString(o.pickupDate),
      createdAt: o.createdAt.toISOString(),
    }));
  }

  private hmac(phone: string, code: string): string {
    return hmacHex(`otp:${this.config.SESSION_JWT_SECRET}`, `${phone}:${code}`);
  }

  private invalid(ipKey: string): AppError {
    const list = this.verifyFailures.get(ipKey) ?? [];
    list.push(Date.now());
    this.verifyFailures.set(ipKey, list);
    return new AppError('OTP_INVALID', 'That code is wrong or has expired', HttpStatus.BAD_REQUEST);
  }

  private pruneFailures(ipKey: string): void {
    const since = Date.now() - OTP_POLICY.verifyFailuresPerIpWindowSeconds * 1000;
    const list = (this.verifyFailures.get(ipKey) ?? []).filter((t) => t > since);
    if (list.length) this.verifyFailures.set(ipKey, list);
    else this.verifyFailures.delete(ipKey);
  }
}
