import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { DemoPaymentOutcome, type DemoPayments } from '@kagaz/shared';
import { APP_CONFIG } from '../../common/config/config.module.js';
import { type AppConfig, demoControlsEnabled } from '../../common/config/config.schema.js';
import { AppError } from '../../common/http/api-exception.filter.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { DemoMockProvider } from './demo-mock.provider.js';
import { PAYMENT_PROVIDER, type PaymentProvider } from './payment-provider.js';
import { WebhooksService } from './webhooks.service.js';

/**
 * Demo-only payment controls (P3.5). Connects the simulated gateway's signed webhooks to the
 * real webhook pipeline, and lets the admin demo page (or the demo-only `?demoOutcome=` pay
 * flag) choose an outcome per order. Disabled — 404 — outside demo/local/staging or when the
 * live provider is configured.
 */
@Injectable()
export class DemoControlsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DemoControlsService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly prisma: PrismaService,
    private readonly webhooks: WebhooksService,
  ) {}

  onModuleInit(): void {
    if (!(this.provider instanceof DemoMockProvider)) return;
    this.provider.attachWebhookSink(async (rawBody, headers) => {
      try {
        await this.webhooks.receive(this.provider.name, rawBody, headers);
      } catch (err) {
        this.logger.warn({ err }, 'simulated webhook delivery failed');
      }
    });
  }

  onModuleDestroy(): void {
    if (this.provider instanceof DemoMockProvider) this.provider.onModuleDestroy();
  }

  get enabled(): boolean {
    return demoControlsEnabled(this.config) && this.provider instanceof DemoMockProvider;
  }

  private demo(): DemoMockProvider {
    if (!this.enabled || !(this.provider instanceof DemoMockProvider)) {
      throw new AppError('NOT_FOUND', 'Demo controls are disabled', HttpStatus.NOT_FOUND);
    }
    return this.provider;
  }

  async setOutcome(orderId: string, outcome: DemoPaymentOutcome | null): Promise<void> {
    const provider = this.demo();
    const order = /^[0-9a-f-]{36}$/i.test(orderId)
      ? await this.prisma.order.findUnique({ where: { id: orderId } })
      : null;
    if (!order) throw new AppError('ORDER_NOT_FOUND', 'Order not found', HttpStatus.NOT_FOUND);
    provider.setOutcome(orderId, outcome);
    this.logger.log({ orderId, outcome }, 'demo payment outcome set');
  }

  /** Demo-only `POST /api/orders/:id/pay?demoOutcome=…` (rejected when demo is off). */
  async applyPayFlag(orderId: string, raw: string | undefined): Promise<void> {
    if (raw === undefined || raw === '') return;
    const outcome = Object.values(DemoPaymentOutcome).find((o) => o === raw);
    if (!outcome) {
      throw new AppError('VALIDATION_FAILED', `Unknown demo outcome "${raw}"`, 400);
    }
    if (!this.enabled) {
      throw new AppError('DEMO_CONTROLS_DISABLED', 'Demo payment controls are disabled', 400);
    }
    await this.setOutcome(orderId, outcome);
  }

  async overview(): Promise<DemoPayments> {
    const provider = this.demo();
    const pending = provider.pendingOutcomes();
    const orders = await this.prisma.order.findMany({
      where: { status: { not: 'DRAFT' } },
      include: {
        shop: { select: { name: true } },
        payments: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    return {
      outcomes: Object.values(DemoPaymentOutcome),
      orders: orders.map((o) => ({
        id: o.id,
        publicRef: o.publicRef,
        shopName: o.shop.name,
        status: o.status,
        amountPaise: o.amountPaise,
        paymentStatus: o.payments[0]?.status ?? null,
        nextOutcome: pending.get(o.id) ?? null,
        createdAt: o.createdAt.toISOString(),
      })),
    };
  }
}
