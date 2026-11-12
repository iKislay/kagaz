'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  DEMO_REFUND_NOTICE,
  OrderStatus,
  type PublicOrder,
  formatPaise,
  formatPickupDate,
} from '@kagaz/shared';
import { PaymentStatePanel } from '@/components/order/PaymentStatePanel';
import { Group, Notice, Pill, Row, Spinner, cx } from '@/components/ui';
import { useOrderUpdates } from '@/lib/realtime';
import { REJECT_REASONS, TIMELINE_STEPS, statusCopy } from '@/lib/status';
import { trackingUrl } from '@/lib/tracking';

/** Live order status (FR-CUST-10/11) until the order reaches a final state. */
export function OrderTracker({ orderId }: { orderId: string }) {
  // Socket hints + 30 s safety poll (P2.9); REST stays the source of truth.
  const { order, token, error, setOrder } = useOrderUpdates(orderId);

  if (error?.notFound) {
    return (
      <section>
        <h1 className="mac-title">Order not found</h1>
        <Notice tone="orange">
          This link is incomplete or has expired. Open the tracking link from the device you ordered
          on.
        </Notice>
        <Link href="/shops" className="mac-button mt-5">
          Start a new order
        </Link>
      </section>
    );
  }
  if (!order) {
    return (
      <div className="flex items-center gap-2 py-10 text-text-secondary">
        <Spinner /> Loading your order…
      </div>
    );
  }

  const copy = statusCopy(order);
  const atCounter = order.payment?.atCounter ?? false;
  const quote = order.quote;

  return (
    <section>
      {order.pickupNumber !== null && order.pickupDate && SHOW_PICKUP.includes(order.status) && (
        <PickupCodeCard
          pickupNumber={order.pickupNumber}
          pickupDate={order.pickupDate}
          ready={order.status === OrderStatus.READY_FOR_PICKUP}
          shop={order.shop}
          amountDue={atCounter && order.status !== OrderStatus.COLLECTED ? order.amountPaise : null}
        />
      )}

      <p className="text-[13px] font-medium text-text-secondary">
        {order.shop.name} · <span className="font-mono">{order.publicRef}</span>
      </p>
      <div className="mt-0.5 flex flex-wrap items-center gap-3">
        <h1 className="mac-title">{copy.label}</h1>
        <Pill tone={copy.tone}>{order.publicRef}</Pill>
      </div>
      <p className="mt-1.5 text-[15px] text-text-secondary">{copy.detail}</p>
      {error && <Notice tone="orange">Reconnecting… {error.message}</Notice>}

      <PaymentStatePanel order={order} token={token} onChange={setOrder} />

      {(order.status === OrderStatus.REJECTED ||
        order.status === OrderStatus.REFUND_PENDING ||
        order.status === OrderStatus.REFUNDED) && (
        <Notice tone="red">
          <div className="font-semibold">
            {REJECT_REASONS[order.rejection?.code ?? 'OTHER'] ?? REJECT_REASONS.OTHER}
          </div>
          {order.rejection?.note && <div className="mt-0.5">“{order.rejection.note}”</div>}
          {/* Refund amount and status are shown by PaymentStatePanel when known. */}
          {!order.refund && (
            <div className="mt-1 text-[13px] opacity-80">
              {atCounter
                ? 'Nothing to pay.'
                : order.payment?.isSimulated
                  ? DEMO_REFUND_NOTICE
                  : order.status === OrderStatus.REFUNDED
                    ? 'Your payment was refunded.'
                    : 'Your refund is being processed.'}
            </div>
          )}
        </Notice>
      )}

      <Timeline order={order} />

      <Group title="Order">
        <Row label="Document" hint={order.file ? `${order.file.pageCount} pages` : undefined}>
          <span className="text-[15px] text-text-secondary">
            {quote ? `${quote.selectedPages} pg × ${quote.copies}` : `× ${order.options.copies}`}
          </span>
        </Row>
        <Row label="Print">
          <span className="text-[15px] text-text-secondary">
            {order.options.colour ? 'Colour' : 'B/W'} ·{' '}
            {order.options.duplex ? 'Double-sided' : 'Single-sided'} · A4
          </span>
        </Row>
        {order.amountPaise !== null && (
          <Row
            label={
              order.status === OrderStatus.AWAITING_PAYMENT
                ? 'Total'
                : atCounter
                  ? 'Pay at counter'
                  : 'Paid'
            }
            hint={order.payment?.isSimulated ? 'Demo payment — no money was charged' : undefined}
          >
            <span className="text-[15px] font-semibold tabular-nums">
              {formatPaise(order.amountPaise)}
            </span>
          </Row>
        )}
      </Group>

      {token && <ShareLink url={trackingUrl(order.id, token)} />}
    </section>
  );
}

/** Statuses that show the ADR-002 pickup code (paid and not rejected/refunded). */
const SHOW_PICKUP: readonly OrderStatus[] = [
  OrderStatus.PENDING_REVIEW,
  OrderStatus.QUEUED,
  OrderStatus.PRINTING,
  OrderStatus.NEEDS_OPERATOR_CHECK,
  OrderStatus.READY_FOR_PICKUP,
  OrderStatus.COLLECTED,
];

/**
 * ADR-002 pickup code: the shop's daily number, shown large with its date so the counter can
 * match it to the slip on top of the printed stack ("#7 · 7 Nov").
 */
function PickupCodeCard({
  pickupNumber,
  pickupDate,
  ready,
  shop,
  amountDue,
}: {
  pickupNumber: number;
  pickupDate: string;
  ready: boolean;
  shop: PublicOrder['shop'];
  /** Pay-at-counter: the amount the customer pays the shop at pickup. */
  amountDue: number | null;
}) {
  const date = formatPickupDate(pickupDate);
  return (
    <div
      className={cx(
        'mac-card mb-6 px-5 pt-4 pb-5 text-center',
        ready && 'border-green/60 ring-1 ring-green/40',
      )}
      role="group"
      aria-label={`Pickup code number ${pickupNumber}, ${date}`}
    >
      <div className="text-[12px] font-semibold uppercase tracking-wide text-text-secondary">
        Pickup code
      </div>
      <div className="mt-1 flex items-baseline justify-center gap-3">
        <span className="text-[72px] leading-none font-bold tracking-[-0.03em] tabular-nums sm:text-[88px]">
          #{pickupNumber}
        </span>
        <span className="text-[22px] font-semibold text-text-secondary sm:text-[26px]">
          · {date}
        </span>
      </div>
      <p
        className={cx(
          'mt-3 text-[15px]',
          ready ? 'font-semibold text-text' : 'text-text-secondary',
        )}
      >
        {ready ? (
          <>Printed — collect at the counter with pickup code #{pickupNumber}</>
        ) : (
          <>
            Show this at <span className="font-semibold text-text">{shop.name}</span> when your
            prints are ready.
          </>
        )}
      </p>
      {amountDue !== null && (
        <div className="mx-auto mt-4 inline-flex items-baseline gap-2 rounded-full bg-orange/12 px-4 py-1.5">
          <span className="text-[13px] font-medium text-text-secondary">Pay at the counter</span>
          <span className="text-[20px] font-bold tabular-nums">{formatPaise(amountDue)}</span>
        </div>
      )}
      {ready && <p className="mt-1 text-[13px] text-text-secondary">{shop.address}</p>}
    </div>
  );
}

function Timeline({ order }: { order: PublicOrder }) {
  const atCounter = order.payment?.atCounter ?? false;
  const reached = new Set(order.timeline.map((e) => e.status));
  const at = (status: OrderStatus) => order.timeline.findLast((e) => e.status === status)?.at;
  const offPath =
    order.status === OrderStatus.REJECTED ||
    order.status === OrderStatus.REFUND_PENDING ||
    order.status === OrderStatus.REFUNDED ||
    order.status === OrderStatus.CANCELLED;
  const currentIndex = TIMELINE_STEPS.findIndex((s) => s.status === order.status);

  return (
    <Group title="Progress">
      <ol className="px-4 py-3">
        {TIMELINE_STEPS.map((step, i) => {
          const done = reached.has(step.status) && !(offPath && i > 0 && !reached.has(step.status));
          const current = i === currentIndex;
          const time = at(step.status);
          return (
            <li key={step.status} className="relative flex gap-3 pb-4 last:pb-0">
              {i < TIMELINE_STEPS.length - 1 && (
                <span
                  aria-hidden
                  className={cx(
                    'absolute top-6 left-[9px] h-[calc(100%-16px)] w-0.5 rounded-full',
                    done && reached.has(TIMELINE_STEPS[i + 1]!.status)
                      ? 'bg-green'
                      : 'bg-separator',
                  )}
                />
              )}
              <span
                className={cx(
                  'relative z-10 mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white',
                  done
                    ? 'bg-green'
                    : current
                      ? 'bg-accent'
                      : 'border-2 border-separator bg-surface',
                )}
              >
                {done ? '✓' : ''}
              </span>
              <div className="min-w-0">
                <div className={cx('text-[15px]', !done && !current && 'text-text-secondary')}>
                  {atCounter && step.status === OrderStatus.PENDING_REVIEW
                    ? 'Order placed'
                    : step.label}
                </div>
                {time && (
                  <div className="text-[12px] text-text-secondary">
                    {new Date(time).toLocaleString('en-IN', {
                      timeZone: 'Asia/Kolkata',
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </Group>
  );
}

function ShareLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Group
      title="Tracking link"
      footer="Anyone with this link can see this order and its pickup code."
    >
      <div className="flex items-center gap-3 px-4 py-2.5">
        <code className="min-w-0 flex-1 truncate text-[12px] text-text-secondary">{url}</code>
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(url);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              /* clipboard blocked */
            }
          }}
          className="shrink-0 rounded-full border border-separator px-3 py-1 text-[13px] font-semibold text-accent hover:bg-selection"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </Group>
  );
}
