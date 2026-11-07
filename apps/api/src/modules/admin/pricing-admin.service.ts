import { HttpStatus, Injectable } from '@nestjs/common';
import { type AdminCreatePricingRequest, type AdminPricingVersion } from '@kagaz/shared';
import { AppError } from '../../common/http/api-exception.filter.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { type StaffContext } from '../identity/staff-session.js';
import { auditStaffAction } from './admin-audit.js';
import { shopNotFound } from './shop-settings.service.js';

/** Allowed clock skew for "effective now" versions. */
const PAST_TOLERANCE_MS = 60_000;

/**
 * Pricing versions (P4.3 / FR-ADMIN-06). Rows are append-only: a change is a new version with
 * `effectiveFrom`; quotes use the latest effective row and paid orders keep their snapshot.
 * NOTE: minimal version owned here only until the payments workstream's endpoint lands; the
 * request/response shape follows the agreed `{ monoRatePaise, …, effectiveFrom }` contract.
 */
@Injectable()
export class PricingAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async list(shopId: string): Promise<AdminPricingVersion[]> {
    await this.assertShop(shopId);
    const now = new Date();
    const rows = await this.prisma.shopPricing.findMany({
      where: { shopId },
      orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
    });
    const current = rows.find((r) => r.effectiveFrom <= now)?.id;
    return rows.map((r) => ({
      id: r.id,
      monoRatePaise: r.monoRatePaise,
      colourRatePaise: r.colourRatePaise,
      monoDuplexRatePaise: r.monoDuplexRatePaise,
      colourDuplexRatePaise: r.colourDuplexRatePaise,
      duplexRule: r.duplexRule,
      minimumChargePaise: r.minimumChargePaise,
      effectiveFrom: r.effectiveFrom.toISOString(),
      createdAt: r.createdAt.toISOString(),
      current: r.id === current,
    }));
  }

  async create(
    staff: StaffContext,
    shopId: string,
    req: AdminCreatePricingRequest,
  ): Promise<AdminPricingVersion> {
    await this.assertShop(shopId);
    const now = Date.now();
    const effectiveFrom = req.effectiveFrom ? new Date(req.effectiveFrom) : new Date(now);
    if (effectiveFrom.getTime() < now - PAST_TOLERANCE_MS) {
      throw new AppError(
        'PRICING_IN_PAST',
        'A pricing version cannot start in the past',
        HttpStatus.BAD_REQUEST,
      );
    }
    const discounted = req.duplexRule === 'DISCOUNTED_SIDE_RATE';
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.shopPricing.create({
        data: {
          shopId,
          monoRatePaise: req.monoRatePaise,
          colourRatePaise: req.colourRatePaise,
          monoDuplexRatePaise: discounted ? (req.monoDuplexRatePaise ?? null) : null,
          colourDuplexRatePaise: discounted ? (req.colourDuplexRatePaise ?? null) : null,
          duplexRule: req.duplexRule,
          minimumChargePaise: req.minimumChargePaise,
          effectiveFrom,
        },
      });
      await auditStaffAction(tx, staff, 'pricing.created', shopId, {
        pricingId: created.id,
        monoRatePaise: created.monoRatePaise,
        colourRatePaise: created.colourRatePaise,
        monoDuplexRatePaise: created.monoDuplexRatePaise,
        colourDuplexRatePaise: created.colourDuplexRatePaise,
        duplexRule: created.duplexRule,
        minimumChargePaise: created.minimumChargePaise,
        effectiveFrom: created.effectiveFrom.toISOString(),
      });
      return created;
    });
    return (await this.list(shopId)).find((v) => v.id === row.id)!;
  }

  private async assertShop(shopId: string) {
    const shop = await this.prisma.shop.findUnique({ where: { id: shopId }, select: { id: true } });
    if (!shop) throw shopNotFound();
  }
}
