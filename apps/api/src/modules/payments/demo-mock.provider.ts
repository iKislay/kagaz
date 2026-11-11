import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { DemoPaymentOutcome } from '@kagaz/shared';
import {
  type CreatePaymentInput,
  type PaymentProvider,
  PaymentProviderInputError,
  type PaymentSession,
  type ProviderPaymentState,
  type ProviderPaymentStatus,
  type RefundInput,
  type RefundResult,
  type VerifiedPaymentEvent,
  WebhookSignatureError,
  assertProviderPaise,
} from './payment-provider.js';

export const DEMO_SIGNATURE_HEADER = 'x-demo-signature';

/** Body of a webhook sent by the simulated demo gateway (HMAC-SHA256 over the raw bytes). */
const DemoWebhookBodySchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('PAYMENT'),
    eventId: z.string().min(1).max(200),
    providerOrderId: z.string().min(1).max(200),
    providerPaymentId: z.string().max(200).nullable().optional(),
    status: z.enum(['PENDING', 'PAID', 'FAILED']),
    amountPaise: z.int().nonnegative().nullable().optional(),
    occurredAt: z.iso.datetime().optional(),
  }),
  z.object({
    type: z.literal('REFUND'),
    eventId: z.string().min(1).max(200),
    providerRefundId: z.string().min(1).max(200),
    providerPaymentId: z.string().max(200).nullable().optional(),
    status: z.enum(['PENDING', 'SUCCEEDED', 'FAILED']),
    amountPaise: z.int().nonnegative().nullable().optional(),
    occurredAt: z.iso.datetime().optional(),
  }),
]);
export type DemoWebhookBody = z.input<typeof DemoWebhookBodySchema>;

/** Delivers a signed webhook to the API's own webhook pipeline (wired by DemoControlsService). */
export type DemoWebhookSink = (rawBody: Buffer, headers: Record<string, string>) => Promise<void>;

interface DemoPayment {
  providerOrderId: string;
  providerPaymentId: string;
  receipt: string;
  amountPaise: number;
  outcome: DemoPaymentOutcome;
  state: ProviderPaymentState;
  refundedPaise: number;
  seq: number;
}

export interface DemoMockOptions {
  webhookSecret: string;
  /** Delay before the simulated gateway delivers its webhooks. */
  webhookDelayMs?: number;
  /** PENDING outcome: how long until the payment resolves to PAID. */
  pendingResolveMs?: number;
}

/**
 * DEMO ONLY (FR-PAY-02, FR-PAY-08): a simulated gateway that never moves money.
 * - references look like DEMO-ORD-<receipt> / DEMO-PAY-<receipt> / DEMO-RFD-<receipt>-<n>
 * - no UPI intent, card fields, QR code or real charge is ever created
 * - it emits HMAC-signed webhooks (DEMO_WEBHOOK_SECRET) so the real webhook pipeline runs
 * - the API refuses to start with this provider when APP_ENV=production (FR-PAY-03)
 *
 * Outcomes (P3.5), chosen per order via admin demo controls or the demo-only pay flag:
 * SUCCESS (paid at once + one webhook), FAIL, PENDING (paid after N s), DUPLICATE_WEBHOOK
 * (the same PAID event delivered twice), OUT_OF_ORDER (PAID, then a stale PENDING event).
 * Gateway state lives in memory: after an API restart an unknown DEMO order counts as paid.
 */
export class DemoMockProvider implements PaymentProvider {
  readonly name = 'demo';
  readonly refundMode = 'API' as const;
  readonly simulated = true;

  private readonly payments = new Map<string, DemoPayment>();
  private readonly refunds = new Map<string, { providerRefundId: string; amountPaise: number }>();
  private readonly nextOutcome = new Map<string, DemoPaymentOutcome>();
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private sink: DemoWebhookSink | null = null;
  private readonly webhookDelayMs: number;
  private readonly pendingResolveMs: number;

  constructor(private readonly opts: DemoMockOptions) {
    this.webhookDelayMs = opts.webhookDelayMs ?? 300;
    this.pendingResolveMs = opts.pendingResolveMs ?? 10_000;
  }

  // ─── PaymentProvider ───

  async createPayment(input: CreatePaymentInput): Promise<PaymentSession> {
    assertProviderPaise(input.amountPaise, 'amountPaise');
    if (input.currency !== 'INR') throw new PaymentProviderInputError('Only INR is supported');
    const providerOrderId = `DEMO-ORD-${input.receipt}`;
    const existing = this.payments.get(providerOrderId);
    if (existing) return { providerOrderId, checkout: { kind: 'DEMO_AUTO_APPROVE' } };

    const outcome = this.nextOutcome.get(input.orderId) ?? DemoPaymentOutcome.SUCCESS;
    this.nextOutcome.delete(input.orderId); // one-shot: a retry after FAIL succeeds
    const payment: DemoPayment = {
      providerOrderId,
      providerPaymentId: `DEMO-PAY-${input.receipt}`,
      receipt: input.receipt,
      amountPaise: input.amountPaise,
      outcome,
      state:
        outcome === DemoPaymentOutcome.SUCCESS
          ? 'PAID'
          : outcome === DemoPaymentOutcome.FAIL
            ? 'FAILED'
            : 'PENDING',
      refundedPaise: 0,
      seq: 0,
    };
    this.payments.set(providerOrderId, payment);
    this.scheduleOutcome(payment);
    return { providerOrderId, checkout: { kind: 'DEMO_AUTO_APPROVE' } };
  }

  async fetchPaymentStatus(providerOrderId: string): Promise<ProviderPaymentStatus> {
    const payment = this.payments.get(providerOrderId);
    if (!payment) {
      if (!providerOrderId.startsWith('DEMO-ORD-')) {
        throw new PaymentProviderInputError(`Unknown demo order ${providerOrderId}`);
      }
      // Gateway memory lost (API restart): the demo gateway approves by default.
      return {
        state: 'PAID',
        providerPaymentId: providerOrderId.replace(/^DEMO-ORD-/, 'DEMO-PAY-'),
        amountPaise: null,
      };
    }
    return {
      state: payment.state,
      providerPaymentId: payment.state === 'PAID' ? payment.providerPaymentId : null,
      amountPaise: payment.amountPaise,
    };
  }

  async verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string>,
  ): Promise<VerifiedPaymentEvent> {
    const given = headers[DEMO_SIGNATURE_HEADER] ?? '';
    const a = Buffer.from(/^[0-9a-f]{64}$/i.test(given) ? given : '', 'hex');
    const b = Buffer.from(this.sign(rawBody), 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new WebhookSignatureError('Invalid demo webhook signature');
    }
    let json: unknown;
    try {
      json = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new WebhookSignatureError('Demo webhook body is not JSON');
    }
    const body = DemoWebhookBodySchema.safeParse(json);
    if (!body.success) throw new WebhookSignatureError('Demo webhook body has an unknown shape');
    const b2 = body.data;
    const occurredAt = b2.occurredAt ? new Date(b2.occurredAt) : new Date();
    if (b2.type === 'PAYMENT') {
      return {
        type: 'PAYMENT',
        eventId: b2.eventId,
        providerOrderId: b2.providerOrderId,
        providerPaymentId: b2.providerPaymentId ?? null,
        status: b2.status,
        amountPaise: b2.amountPaise ?? null,
        occurredAt,
      };
    }
    return {
      type: 'REFUND',
      eventId: b2.eventId,
      providerRefundId: b2.providerRefundId,
      providerPaymentId: b2.providerPaymentId ?? null,
      status: b2.status,
      amountPaise: b2.amountPaise ?? null,
      occurredAt,
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    assertProviderPaise(input.amountPaise, 'amountPaise');
    if (!input.idempotencyKey) throw new PaymentProviderInputError('idempotencyKey is required');
    const seen = this.refunds.get(input.idempotencyKey);
    if (seen) return { providerRefundId: seen.providerRefundId, status: 'SUCCEEDED' };

    const payment = [...this.payments.values()].find(
      (p) => p.providerPaymentId === input.providerPaymentId,
    );
    if (payment) {
      if (payment.state !== 'PAID') {
        throw new PaymentProviderInputError('Only a paid payment can be refunded');
      }
      if (payment.refundedPaise + input.amountPaise > payment.amountPaise) {
        throw new PaymentProviderInputError('Refund exceeds the paid amount');
      }
      payment.refundedPaise += input.amountPaise;
    } else if (!input.providerPaymentId.startsWith('DEMO-PAY-')) {
      throw new PaymentProviderInputError(`Unknown demo payment ${input.providerPaymentId}`);
    }
    // First refund of a payment: DEMO-RFD-<receipt>; later partial refunds get -2, -3, …
    const base = input.providerPaymentId.replace(/^DEMO-PAY-/, 'DEMO-RFD-');
    const n =
      [...this.refunds.values()].filter(
        (r) => r.providerRefundId === base || r.providerRefundId.startsWith(`${base}-`),
      ).length + 1;
    const providerRefundId = n === 1 ? base : `${base}-${n}`;
    this.refunds.set(input.idempotencyKey, { providerRefundId, amountPaise: input.amountPaise });
    return { providerRefundId, status: 'SUCCEEDED' };
  }

  // ─── Demo controls (never part of the PaymentProvider contract) ───

  /** Outcome for the next payment created for this order (one-shot). null clears it. */
  setOutcome(orderId: string, outcome: DemoPaymentOutcome | null): void {
    if (outcome === null) this.nextOutcome.delete(orderId);
    else this.nextOutcome.set(orderId, outcome);
  }

  pendingOutcomes(): Map<string, DemoPaymentOutcome> {
    return new Map(this.nextOutcome);
  }

  attachWebhookSink(sink: DemoWebhookSink | null): void {
    this.sink = sink;
  }

  /** Signs a webhook body exactly as the demo "gateway" would. */
  sign(rawBody: Buffer | string): string {
    return createHmac('sha256', this.opts.webhookSecret).update(rawBody).digest('hex');
  }

  /** Builds a signed webhook request (used by the simulated gateway and by tests). */
  buildWebhook(body: DemoWebhookBody): { rawBody: Buffer; headers: Record<string, string> } {
    const rawBody = Buffer.from(JSON.stringify(body), 'utf8');
    return {
      rawBody,
      headers: { 'content-type': 'application/json', [DEMO_SIGNATURE_HEADER]: this.sign(rawBody) },
    };
  }

  /** Force the gateway-side state of a payment (contract tests / demo controls). */
  settle(providerOrderId: string, state: ProviderPaymentState): void {
    const payment = this.payments.get(providerOrderId);
    if (!payment) throw new PaymentProviderInputError(`Unknown demo order ${providerOrderId}`);
    payment.state = state;
  }

  /** Stops pending simulated webhooks (Nest calls this on shutdown). */
  onModuleDestroy(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.sink = null;
  }

  // ─── Simulation ───

  private scheduleOutcome(p: DemoPayment): void {
    const paid = (): DemoWebhookBody => ({
      type: 'PAYMENT',
      eventId: `DEMO-EVT-${p.receipt}-${++p.seq}`,
      providerOrderId: p.providerOrderId,
      providerPaymentId: p.providerPaymentId,
      status: 'PAID',
      amountPaise: p.amountPaise,
      occurredAt: new Date().toISOString(),
    });
    const d = this.webhookDelayMs;
    switch (p.outcome) {
      case DemoPaymentOutcome.SUCCESS:
        this.later(d, () => this.emit(paid()));
        break;
      case DemoPaymentOutcome.FAIL:
        this.later(d, () =>
          this.emit({
            type: 'PAYMENT',
            eventId: `DEMO-EVT-${p.receipt}-${++p.seq}`,
            providerOrderId: p.providerOrderId,
            providerPaymentId: null,
            status: 'FAILED',
            amountPaise: p.amountPaise,
            occurredAt: new Date().toISOString(),
          }),
        );
        break;
      case DemoPaymentOutcome.PENDING:
        this.later(this.pendingResolveMs, () => {
          p.state = 'PAID';
          return this.emit(paid());
        });
        break;
      case DemoPaymentOutcome.DUPLICATE_WEBHOOK:
        this.later(d, async () => {
          p.state = 'PAID';
          const event = paid();
          await this.emit(event);
          await this.emit(event); // exact same event id and bytes again
        });
        break;
      case DemoPaymentOutcome.OUT_OF_ORDER: {
        const staleAt = new Date().toISOString();
        this.later(d, async () => {
          p.state = 'PAID';
          await this.emit(paid());
          // A PENDING event that "happened" before the PAID one arrives last.
          await this.emit({
            type: 'PAYMENT',
            eventId: `DEMO-EVT-${p.receipt}-${++p.seq}`,
            providerOrderId: p.providerOrderId,
            providerPaymentId: null,
            status: 'PENDING',
            amountPaise: p.amountPaise,
            occurredAt: staleAt,
          });
        });
        break;
      }
    }
  }

  private later(ms: number, fn: () => Promise<void>): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn().catch(() => undefined);
    }, ms);
    t.unref?.();
    this.timers.add(t);
  }

  private async emit(body: DemoWebhookBody): Promise<void> {
    const sink = this.sink;
    if (!sink) return;
    const { rawBody, headers } = this.buildWebhook(body);
    await sink(rawBody, headers).catch(() => undefined);
  }
}
