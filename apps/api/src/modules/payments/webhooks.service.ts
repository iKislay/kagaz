import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { type WebhookAck } from '@kagaz/shared';
import { sha256Hex } from '../../common/crypto/tokens.js';
import { AppError } from '../../common/http/api-exception.filter.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
  type VerifiedPaymentEvent,
  WebhookSignatureError,
} from './payment-provider.js';
import { PaymentsService, type ProviderPaymentUpdate } from './payments.service.js';
import { RefundsService } from './refunds.service.js';

/**
 * Webhook pipeline (P3.3, FR-PAY-04/05/06):
 * 1. signature verified by the provider over the EXACT raw body (invalid → 400, no change)
 * 2. `WebhookEvent` inserted with unique (provider, provider_event_id) in the SAME transaction
 *    as processing: a duplicate is a 200 no-op; a processing error rolls back so the
 *    provider's retry is processed again
 * 3. monotonic payment status; the paid transition is a conditional update (one winner)
 * 4. ambiguous success (no amount or payment id) is confirmed by a server-to-server fetch
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly prisma: PrismaService,
    private readonly payments: PaymentsService,
    private readonly refunds: RefundsService,
  ) {}

  async receive(
    providerName: string,
    rawBody: Buffer | undefined,
    headers: Record<string, string>,
  ): Promise<WebhookAck> {
    if (providerName !== this.provider.name) {
      throw new AppError('WEBHOOK_PROVIDER_UNKNOWN', 'Unknown payment provider', 404);
    }
    if (!rawBody || rawBody.length === 0) {
      throw new AppError('WEBHOOK_BODY_MISSING', 'Webhook body is missing', 400);
    }
    const rawHash = sha256Hex(rawBody);

    let event: VerifiedPaymentEvent;
    try {
      event = await this.provider.verifyWebhook(rawBody, headers);
    } catch (err) {
      if (!(err instanceof WebhookSignatureError)) throw err;
      this.logger.warn({ provider: providerName, rawHash }, 'webhook signature invalid — rejected');
      // Recorded under a synthetic id: an unverified event id must never block the real one.
      await this.prisma.webhookEvent.createMany({
        data: [
          {
            provider: providerName,
            providerEventId: `invalid-signature:${rawHash}`,
            signatureValid: false,
            rawPayloadHash: rawHash,
            error: 'INVALID_SIGNATURE',
          },
        ],
        skipDuplicates: true,
      });
      throw new AppError(
        'WEBHOOK_SIGNATURE_INVALID',
        'Webhook signature is invalid',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Ambiguous success → confirm with the provider before treating it as paid.
    let update: ProviderPaymentUpdate | null = null;
    if (event.type === 'PAYMENT') {
      update = {
        status: event.status,
        providerPaymentId: event.providerPaymentId,
        amountPaise: event.amountPaise,
        source: 'WEBHOOK',
      };
      if (event.status === 'PAID' && (event.amountPaise === null || !event.providerPaymentId)) {
        const fetched = await this.provider.fetchPaymentStatus(event.providerOrderId);
        update = {
          status: fetched.state,
          providerPaymentId: fetched.providerPaymentId,
          amountPaise: fetched.amountPaise,
          source: 'STATUS_FETCH',
        };
      }
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const inserted = await tx.webhookEvent.createMany({
        data: [
          {
            provider: providerName,
            providerEventId: event.eventId,
            signatureValid: true,
            rawPayloadHash: rawHash,
          },
        ],
        skipDuplicates: true,
      });
      if (inserted.count === 0) {
        return { duplicate: true, outcome: 'DUPLICATE', paidOrderId: null as string | null };
      }

      let outcome: string;
      let paidOrderId: string | null = null;
      let error: string | null = null;
      if (event.type === 'PAYMENT') {
        const payment = await tx.payment.findFirst({
          where: { provider: providerName, providerOrderId: event.providerOrderId },
        });
        if (!payment) {
          outcome = 'PAYMENT_NOT_FOUND';
          error = outcome;
        } else {
          const applied = await this.payments.applyProviderUpdate(tx, payment.id, update!);
          outcome = applied.outcome;
          paidOrderId = applied.paidOrderId;
          if (outcome === 'AMOUNT_MISMATCH' || outcome === 'PAID_ORDER_NOT_PAYABLE') {
            error = outcome;
          }
        }
      } else {
        const refund = await tx.refund.findFirst({
          where: { providerRefundId: event.providerRefundId, payment: { provider: providerName } },
        });
        if (!refund) {
          outcome = 'REFUND_NOT_FOUND';
          error = outcome;
        } else {
          outcome = await this.refunds.applyProviderRefundState(
            tx,
            refund.id,
            event.status,
            event.providerRefundId,
          );
        }
      }
      await tx.webhookEvent.update({
        where: {
          provider_providerEventId: { provider: providerName, providerEventId: event.eventId },
        },
        data: error ? { error } : { processedAt: new Date() },
      });
      return { duplicate: false, outcome, paidOrderId };
    });

    if (result.paidOrderId) await this.payments.afterPaid(result.paidOrderId);
    this.logger.log(
      { provider: providerName, duplicate: result.duplicate, outcome: result.outcome },
      'webhook processed',
    );
    return { received: true, duplicate: result.duplicate, outcome: result.outcome };
  }
}
