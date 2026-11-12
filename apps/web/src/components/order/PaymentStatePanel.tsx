'use client';

import { useState } from 'react';
import {
  DEMO_REFUND_NOTICE,
  OrderStatus,
  type PublicOrder,
  formatPaise,
  formatPickupDate,
} from '@kagaz/shared';
import { Notice, Spinner } from '@/components/ui';
import { ApiRequestError } from '@/lib/api';
import { cancelOrder, retryPayment } from '@/lib/customer-api';

/**
 * Payment-side states on the tracking page (P3.4–P3.6), kept separate from the order timeline:
 * failed payment (retry), payment waiting for confirmation, cancel before payment, refund.
 * A browser action never marks anything paid — the server re-checks the provider.
 */
export function PaymentStatePanel({
  order,
  token,
  onChange,
}: {
  order: PublicOrder;
  token: string | null;
  onChange: (order: PublicOrder) => void;
}) {
  const [busy, setBusy] = useState<'pay' | 'cancel' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const payment = order.payment;
  const awaiting = order.status === OrderStatus.AWAITING_PAYMENT;
  const counter = payment?.method === 'COUNTER';

  const run = async (kind: 'pay' | 'cancel') => {
    setBusy(kind);
    setError(null);
    try {
      onChange(
        kind === 'pay'
          ? (await retryPayment(order.id, token)).order
          : await cancelOrder(order.id, token),
      );
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  };

  const refund = order.refund;
  const showRefund =
    refund &&
    (order.status === OrderStatus.REFUND_PENDING || order.status === OrderStatus.REFUNDED);

  return (
    <>
      {awaiting && payment?.status === 'FAILED' && (
        <Notice tone="red">
          <div className="font-semibold">Payment didn’t go through</div>
          <div className="mt-0.5">
            {payment.isSimulated
              ? 'The demo payment was declined. No money was charged.'
              : 'No money was taken. You can try again.'}
          </div>
          <button
            type="button"
            className="mac-button mt-3 w-full sm:w-auto"
            disabled={busy !== null}
            onClick={() => void run('pay')}
          >
            {busy === 'pay' ? <Spinner /> : null}
            Try again{order.amountPaise !== null ? ` · ${formatPaise(order.amountPaise)}` : ''}
          </button>
        </Notice>
      )}

      {awaiting &&
        counter &&
        payment?.status === 'PENDING' &&
        order.pickupNumber !== null &&
        order.pickupDate && (
          <CounterNumberCard
            pickupNumber={order.pickupNumber}
            pickupDate={order.pickupDate}
            amountPaise={order.amountPaise}
            shopName={order.shop.name}
          />
        )}

      {awaiting && !counter && (payment?.status === 'PENDING' || payment?.status === 'CREATED') && (
        <Notice tone="orange">
          <div className="flex items-center gap-2 font-semibold">
            <Spinner /> Waiting for payment confirmation
          </div>
          <div className="mt-0.5">
            We’re confirming your payment with the provider. This page updates by itself; the shop
            only sees your order once the payment is confirmed.
          </div>
          <button
            type="button"
            className="mt-2 text-[14px] font-semibold text-accent disabled:opacity-50"
            disabled={busy !== null}
            onClick={() => void run('pay')}
          >
            {busy === 'pay' ? 'Checking…' : 'Check again'}
          </button>
        </Notice>
      )}

      {showRefund && (
        <Notice tone={refund.status === 'SUCCEEDED' ? 'green' : 'orange'}>
          <div className="font-semibold">
            {refund.status === 'SUCCEEDED'
              ? `Refunded ${formatPaise(refund.amountPaise)}`
              : `Refund of ${formatPaise(refund.amountPaise)} in progress`}
          </div>
          {counter && (
            <div className="mt-0.5">You paid at the counter, so the shop returns it in cash.</div>
          )}
          {refund.isSimulated && <div className="mt-0.5">{DEMO_REFUND_NOTICE}</div>}
        </Notice>
      )}

      {order.canCancel && (
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            className="rounded-full border border-separator px-4 py-1.5 text-[14px] font-semibold text-red hover:bg-selection disabled:opacity-50"
            disabled={busy !== null}
            onClick={() => {
              if (
                window.confirm(
                  counter
                    ? 'Cancel this order? Only do this if you haven’t paid at the counter.'
                    : 'Cancel this order? You haven’t been charged.',
                )
              )
                void run('cancel');
            }}
          >
            {busy === 'cancel' ? 'Cancelling…' : 'Cancel order'}
          </button>
        </div>
      )}

      {error && <Notice tone="red">{error}</Notice>}
    </>
  );
}

/**
 * ADR-003: the customer's daily pickup number, shown at the counter to pay — and later to collect
 * the prints — with the exact amount. The shop approves the payment; this page then moves on.
 */
function CounterNumberCard({
  pickupNumber,
  pickupDate,
  amountPaise,
  shopName,
}: {
  pickupNumber: number;
  pickupDate: string;
  amountPaise: number | null;
  shopName: string;
}) {
  const date = formatPickupDate(pickupDate);
  return (
    <div
      className="mac-card mt-5 px-5 pt-4 pb-5 text-center"
      role="group"
      aria-label={`Pickup code number ${pickupNumber}, ${date}`}
    >
      <div className="text-[12px] font-semibold uppercase tracking-wide text-text-secondary">
        Your pickup code
      </div>
      <div className="mt-1 flex items-baseline justify-center gap-3">
        <span className="text-[72px] leading-none font-bold tracking-[-0.03em] tabular-nums sm:text-[88px]">
          #{pickupNumber}
        </span>
        <span className="text-[22px] font-semibold text-text-secondary sm:text-[26px]">
          · {date}
        </span>
      </div>
      {amountPaise !== null && (
        <div className="mt-3 text-[17px]">
          Show it at <span className="font-semibold">{shopName}</span> and pay{' '}
          <span className="font-semibold tabular-nums">{formatPaise(amountPaise)}</span>
        </div>
      )}
      <p className="mt-1 text-[13px] text-text-secondary">
        Use the same number to collect your prints.
      </p>
      <div className="mt-3 flex items-center justify-center gap-2 text-[13px] text-text-secondary">
        <Spinner /> Waiting for the shop to confirm your payment…
      </div>
    </div>
  );
}
