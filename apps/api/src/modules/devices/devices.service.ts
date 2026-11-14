import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  type EnrollDeviceRequest,
  type EnrollDeviceResponse,
  type EnrollWithLoginRequest,
  type ShopSignupRequest,
  type HeartbeatRequest,
  type HeartbeatResponse,
} from '@kagaz/shared';
import { isUpgradeRequired } from '../../common/auth/agent-version.guard.js';
import { subscriptionSummary } from '../billing/entitlement.js';
import { type DeviceContext } from '../../common/auth/device-auth.guard.js';
import { APP_CONFIG } from '../../common/config/config.module.js';
import { type AppConfig } from '../../common/config/config.schema.js';
import { generateToken, normalizeCode, sha256Hex } from '../../common/crypto/tokens.js';
import { DomainEvent, DomainEventBus } from '../../common/events/domain-events.js';
import { AppError } from '../../common/http/api-exception.filter.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { type Prisma } from '../../generated/prisma/client.js';
import { DEFAULT_AUTO_LIMITS } from '../admin/shop-settings.service.js';
import { AuditService } from '../audit/audit.service.js';
import { LoginRateLimiter } from '../identity/login-rate-limiter.js';
import { hashPassword, loginWhere, verifyPassword } from '../identity/passwords.js';
import { PrintLeaseService } from '../printing/print-leases.service.js';
import { DeviceHealthService } from './device-health.service.js';
import { SIGNUP_PRICING } from './shop-signup.js';

@Injectable()
export class DevicesService {
  private readonly loginLimiter = new LoginRateLimiter();
  private readonly ipLimiter = new LoginRateLimiter(20);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly leases: PrintLeaseService,
    private readonly health: DeviceHealthService,
    private readonly events: DomainEventBus,
  ) {}

  /** Exchange a one-time enrollment code for a device token (FR-SHOP-01). */
  async enroll(req: EnrollDeviceRequest): Promise<EnrollDeviceResponse> {
    const codeHash = sha256Hex(normalizeCode(req.code));
    const token = generateToken();

    return this.prisma.$transaction(async (tx) => {
      const code = await tx.enrollmentCode.findUnique({
        where: { codeHash },
        include: { shop: { select: { id: true, name: true, isDemo: true } } },
      });
      if (!code || code.usedAt || code.expiresAt < new Date()) {
        throw new AppError(
          'ENROLLMENT_CODE_INVALID',
          'This pairing code is invalid, expired or already used',
          HttpStatus.BAD_REQUEST,
        );
      }
      const enrolled = await this.createDevice(tx, code.shop, req.name, req.appVersion, {
        action: 'device.enrolled',
        token,
      });
      // Single use, even under concurrent enrollment attempts.
      const used = await tx.enrollmentCode.updateMany({
        where: { id: code.id, usedAt: null },
        data: { usedAt: new Date(), usedByDeviceId: enrolled.device.id },
      });
      if (used.count !== 1) {
        throw new AppError('ENROLLMENT_CODE_INVALID', 'This pairing code was already used', 400);
      }
      return enrolled;
    });
  }

  /**
   * Shop sign-up from the Kaggaz Shop app: the shop (CLOSED until Kaggaz activates it, default
   * prices), the owner login (mobile + Argon2id password) and this PC's device, in one transaction.
   */
  async signup(req: ShopSignupRequest, slug: string, ip: string): Promise<EnrollDeviceResponse> {
    const passwordHash = await hashPassword(req.password);
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({
        where: { phone: req.phone },
        select: { kind: true, _count: { select: { shopMemberships: true } } },
      });
      if (existing && (existing.kind === 'ADMIN' || existing._count.shopMemberships > 0)) {
        throw new AppError(
          'PHONE_IN_USE',
          'This mobile number already has a Kaggaz account — sign in instead',
          HttpStatus.CONFLICT,
        );
      }
      const shop = await tx.shop.create({
        data: {
          slug,
          name: req.shopName,
          contactPhone: req.phone,
          status: 'CLOSED', // Kaggaz activates it (subscription), then the owner opens it
          approvalMode: 'MANUAL',
          autoLimits: DEFAULT_AUTO_LIMITS,
          openingHours: {}, // unused column (opening hours were removed)
          isDemo: false,
          pricing: { create: { ...SIGNUP_PRICING, effectiveFrom: new Date() } },
        },
        select: { id: true, name: true, isDemo: true },
      });
      // A customer account with this number becomes the owner login (its orders stay linked).
      const user = await tx.user.upsert({
        where: { phone: req.phone },
        update: { name: req.ownerName, kind: 'STAFF', passwordHash },
        create: { phone: req.phone, name: req.ownerName, kind: 'STAFF', passwordHash },
      });
      await tx.shopUser.create({ data: { shopId: shop.id, userId: user.id, role: 'OWNER' } });
      await this.audit.record(tx, { type: 'SYSTEM', id: null }, 'shop.self_signup', {
        shopId: shop.id,
        metadata: { slug, ownerUserId: user.id, ip },
      });
      return this.createDevice(tx, shop, req.deviceName, req.appVersion, {
        action: 'device.enrolled_with_login',
        userId: user.id,
      });
    });
  }

  /**
   * Connect a new PC with the owner's mobile number + password instead of a pairing code.
   * Only shop owners can; failures are rate limited per IP+login and per IP.
   */
  async enrollWithLogin(req: EnrollWithLoginRequest, ip: string): Promise<EnrollDeviceResponse> {
    const key = `${ip}|${req.login}`;
    if (this.loginLimiter.isBlocked(key) || this.ipLimiter.isBlocked(ip)) {
      throw new AppError(
        'RATE_LIMITED',
        'Too many failed sign-in attempts. Please wait and try again.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const user = await this.prisma.user.findUnique({
      where: loginWhere(req.login),
      select: {
        id: true,
        kind: true,
        passwordHash: true,
        shopMemberships: {
          where: { role: 'OWNER' },
          select: { shop: { select: { id: true, name: true, isDemo: true } } },
        },
      },
    });
    if (!(await verifyPassword(user?.passwordHash, req.password)) || !user) {
      this.loginLimiter.fail(key);
      this.ipLimiter.fail(ip);
      throw new AppError(
        'LOGIN_FAILED',
        'Wrong mobile number or password',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const owned = user.kind === 'STAFF' ? user.shopMemberships.map((m) => m.shop) : [];
    const shop = req.shopId ? owned.find((s) => s.id === req.shopId) : owned[0];
    if (!shop) {
      throw new AppError(
        'NOT_SHOP_OWNER',
        'Only the shop owner can connect a new PC. Ask your owner, or contact Kaggaz support.',
        HttpStatus.FORBIDDEN,
      );
    }
    if (!req.shopId && owned.length > 1) {
      throw new AppError(
        'MULTIPLE_SHOPS',
        'Choose which shop this PC is for',
        HttpStatus.CONFLICT,
        {
          shops: owned.map((s) => ({ id: s.id, name: s.name })),
        },
      );
    }
    this.loginLimiter.reset(key);
    return this.prisma.$transaction((tx) =>
      this.createDevice(tx, shop, req.deviceName, req.appVersion, {
        action: 'device.enrolled_with_login',
        userId: user.id,
      }),
    );
  }

  /** One device token per PC; only its SHA-256 is stored (shown once to the app). */
  private async createDevice(
    tx: Prisma.TransactionClient,
    shop: { id: string; name: string; isDemo: boolean },
    name: string,
    appVersion: string | undefined,
    opts: { action: string; userId?: string; token?: string },
  ): Promise<EnrollDeviceResponse> {
    const token = opts.token ?? generateToken();
    const device = await tx.shopDevice.create({
      data: {
        shopId: shop.id,
        name,
        tokenHash: sha256Hex(token),
        appVersion: appVersion ?? null,
        lastHeartbeatAt: new Date(),
      },
    });
    await this.audit.record(tx, { type: 'DEVICE', id: device.id }, opts.action, {
      shopId: shop.id,
      metadata: {
        name,
        appVersion: appVersion ?? null,
        ...(opts.userId ? { userId: opts.userId } : {}),
      },
    });
    return { deviceToken: token, device: { id: device.id, name: device.name }, shop };
  }

  /**
   * Heartbeat (contract §1, P4.4, every 15 s): records liveness + health, printer status,
   * renews the leases of `activePrintJobIds`, and tells the agent the lease TTL, the
   * minimum agent version and the shop's mode.
   */
  async heartbeat(device: DeviceContext, req: HeartbeatRequest): Promise<HeartbeatResponse> {
    const now = new Date();
    const at = now.toISOString();
    const result = await this.prisma.$transaction(async (tx) => {
      const before = await tx.shopDevice.findUniqueOrThrow({
        where: { id: device.deviceId, shopId: device.shopId },
        select: { lastHeartbeatAt: true },
      });
      const updated = await tx.shopDevice.update({
        where: { id: device.deviceId, shopId: device.shopId },
        data: {
          lastHeartbeatAt: now,
          ...(req.appVersion ? { appVersion: req.appVersion } : {}),
          ...(req.os === undefined ? {} : { os: req.os }),
          ...(req.uptimeSeconds === undefined ? {} : { uptimeSeconds: req.uptimeSeconds }),
          ...(req.queueDepth === undefined ? {} : { queueDepth: req.queueDepth }),
        },
        select: {
          appVersion: true,
          shop: { select: { status: true, approvalMode: true, autoPaused: true } },
        },
      });
      if (!this.health.isOnline(before.lastHeartbeatAt, now)) {
        this.events.publish(tx, DomainEvent.DEVICE_STATUS_CHANGED, {
          deviceId: device.deviceId,
          shopId: device.shopId,
          online: true,
          at,
        });
      }

      for (const p of req.printers ?? []) {
        // Scoped to this shop: a device can't touch another shop's printers.
        const printer = await tx.printer.findFirst({
          where: { id: p.printerId, shopId: device.shopId },
          select: { id: true, status: true, lastError: true },
        });
        if (!printer) continue;
        const lastError = p.lastError ?? null;
        await tx.printer.update({
          where: { id: printer.id, shopId: device.shopId },
          data: { status: p.status, lastStatusAt: now, lastError },
        });
        if (printer.status !== p.status || printer.lastError !== lastError) {
          this.events.publish(tx, DomainEvent.PRINTER_STATUS_CHANGED, {
            printerId: printer.id,
            shopId: device.shopId,
            status: p.status,
            lastError,
            at,
          });
        }
      }

      await this.leases.renew(tx, device, req.activePrintJobIds ?? [], this.leases.leaseUntil(now));
      return updated;
    });

    const min = this.config.MIN_AGENT_VERSION ?? null;
    return {
      serverTime: at,
      leaseTtlSeconds: this.config.PRINTER_LEASE_TTL_SECONDS,
      minAgentVersion: min,
      upgradeRequired: isUpgradeRequired(result.appVersion, min ?? undefined),
      shop: result.shop,
      subscription: await subscriptionSummary(this.prisma, device.shopId, now),
    };
  }

  /** Swap the token hash in one conditional update; the old token is dead on commit. */
  async rotateToken(device: DeviceContext): Promise<{ deviceToken: string }> {
    const token = generateToken();
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.shopDevice.updateMany({
        where: { id: device.deviceId, shopId: device.shopId, status: 'ACTIVE' },
        data: { tokenHash: sha256Hex(token) },
      });
      if (updated.count !== 1) {
        throw new AppError('DEVICE_REVOKED', 'This device was revoked', HttpStatus.UNAUTHORIZED);
      }
      await tx.auditLog.create({
        data: {
          actorType: 'DEVICE',
          actorId: device.deviceId,
          shopId: device.shopId,
          action: 'device.token_rotated',
          metadata: { deviceId: device.deviceId },
        },
      });
    });
    return { deviceToken: token };
  }
}
