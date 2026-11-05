'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { DEMO_REFUND_NOTICE, OrderStatus, type PublicOrder, formatPaise } from '@kagaz/shared';
import { Group, Notice, Pill, Row, Spinner, cx } from '@/components/ui';
import { ApiRequestError, getOrder } from '@/lib/api';
import { REJECT_REASONS, STATUS_COPY, TERMINAL, TIMELINE_STEPS } from '@/lib/status';
import { loadTrackingToken, trackingUrl } from '@/lib/tracking';

const POLL_MS = 5000;

/** Live order status (FR-CUST-10/11). Polls until the order reaches a final state. */
export function OrderTracker({ orderId }: { orderId: string }) {
  const [order, setOrder] = useState<PublicOrder | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<{ notFound: boolean; message: string } | null>(null);

  useEffect(() => {
    const tok = loadTrackingToken(orderId);
    setToken(tok);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const tick = async () => {
      try {
        const next = await getOrder(orderId, tok);
        if (cancelled) return;
        setOrder(next);
        setError(null);
        if (!TERMINAL.includes(next.status)) timer = setTimeout(tick, POLL_MS);
      } catch (err) {
        if (cancelled) return;
        const notFound = err instanceof ApiRequestError && err.status === 404;
        setError({
          notFound,
          message: err instanceof ApiRequestError ? err.message : 'Something went wrong.',
        });
        if (!notFound) timer = setTimeout(tick, POLL_MS * 2); // keep retrying network errors
      }
    };
    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [orderId]);

  if (error?.notFound) {
    return (
      <section>
        <h1 className="mac-title">Order not found</h1>
        <Notice tone="orange">
          This link is incomplete or has expired. Open the tracking link from the device you ordered
          on.
        </Notice>
        <Link href="/" className="mac-button mt-5">
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

  const copy = STATUS_COPY[order.status];
  const quote = order.quote;

  return (
    <section>
      <p className="text-[13px] font-medium text-text-secondary">
        {order.shop.name} · <span className="font-mono">{order.publicRef}</span>
      </p>
      <div className="mt-0.5 flex flex-wrap items-center gap-3">
        <h1 className="mac-title">{copy.label}</h1>
        <Pill tone={copy.tone}>{order.publicRef}</Pill>
      </div>
      <p className="mt-1.5 text-[15px] text-text-secondary">{copy.detail}</p>
      {error && <Notice tone="orange">Reconnecting… {error.message}</Notice>}

      {order.status === OrderStatus.READY_FOR_PICKUP && order.pickupCode && (
        <PickupCodeCard code={order.pickupCode} shop={order.shop} />
      )}

      {(order.status === OrderStatus.REJECTED ||
        order.status === OrderStatus.REFUND_PENDING ||
        order.status === OrderStatus.REFUNDED) && (
        <Notice tone="red">
          <div className="font-semibold">
            {REJECT_REASONS[order.rejection?.code ?? 'OTHER'] ?? REJECT_REASONS.OTHER}
          </div>
          {order.rejection?.note && <div className="mt-0.5">“{order.rejection.note}”</div>}
          <div className="mt-1 text-[13px] opacity-80">
            {order.payment?.isSimulated
              ? DEMO_REFUND_NOTICE
              : order.status === OrderStatus.REFUNDED
                ? 'Your payment was refunded.'
                : 'Your refund is being processed.'}
          </div>
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
            label="Paid"
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

function PickupCodeCard({ code, shop }: { code: string; shop: PublicOrder['shop'] }) {
  return (
    <div className="mac-card mt-6 p-6 text-center">
      <div className="text-[12px] font-semibold uppercase tracking-wide text-text-secondary">
        Pickup code
      </div>
      <div
        className="mt-2 select-all font-mono text-[44px] font-bold tracking-[0.12em] text-text sm:text-[56px]"
        aria-label={`Pickup code ${code.split('').join(' ')}`}
      >
        {code.slice(0, 4)}
        <span className="text-text-secondary/50">-</span>
        {code.slice(4)}
      </div>
      <p className="mt-2 text-[14px] text-text-secondary">
        Tell this code to the counter at{' '}
        <span className="font-semibold text-text">{shop.name}</span>, {shop.address}.
      </p>
    </div>
  );
}

function Timeline({ order }: { order: PublicOrder }) {
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
                  {step.label}
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
