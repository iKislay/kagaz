'use client';

import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import {
  DECLINE_REASON_TEXT,
  DEMO_REFUND_NOTICE,
  MANUAL_REFUND_NOTICE,
  OrderStatus,
  type PublicOrder,
  UtrSchema,
  formatPaise,
} from '@kagaz/shared';
import { Group, Notice, Spinner, cx } from '@/components/ui';
import { ApiRequestError, getOrder } from '@/lib/api';
import {
  cancelOrder,
  openCheckout,
  reportPayment,
  retryPayment,
  safeCheckoutUrl,
} from '@/lib/customer-api';

/**
 * Payment-side states on the tracking page (P3.4–P3.6, ADR-003), kept separate from the order
 * timeline: failed payment (retry), payment waiting for confirmation (UPI checkout), the
 * "I paid but it isn't confirmed" report, cancel before payment, refund.
 * A browser action never marks anything paid — the server re-checks, or the shop approves.
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
  const [busy, setBusy] = useState<'retry' | 'check' | 'cancel' | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** "Check again" came back still unconfirmed — say so instead of looking like nothing happened. */
  const [stillWaiting, setStillWaiting] = useState(false);
  const payment = order.payment;
  const awaiting = order.status === OrderStatus.AWAITING_PAYMENT;
  const live = payment !== null && !payment.isSimulated;
  const reportOpen = order.paymentReport?.status === 'OPEN';
  const paymentOpen = payment?.status === 'PENDING' || payment?.status === 'CREATED';
  const mayReport = order.canReportPayment || order.reportPaymentAfter !== null;
  const checkoutUrl = safeCheckoutUrl(payment?.checkoutUrl);
  const total = order.amountPaise !== null ? formatPaise(order.amountPaise) : null;

  const refresh = () => getOrder(order.id, token).then(onChange, () => undefined);

  // Back from the UPI page via the back/forward cache: don't stay stuck on "busy".
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) setBusy(null);
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  const run = async (kind: 'retry' | 'check' | 'cancel') => {
    setBusy(kind);
    setError(null);
    setStillWaiting(false);
    try {
      if (kind === 'cancel') {
        onChange(await cancelOrder(order.id, token));
      } else {
        const res = await retryPayment(order.id, token);
        // A retry after a failed UPI payment opens a fresh checkout page. "Check again" only
        // re-checks: it never navigates away (the waiting notice links to the open page).
        if (kind === 'retry' && res.mode === 'UPI_CHECKOUT' && openCheckout(res.checkoutUrl)) {
          return; // keep the spinner while the browser leaves
        }
        onChange(res.order);
        if (kind === 'check' && res.order.status === OrderStatus.AWAITING_PAYMENT) {
          setStillWaiting(true);
        }
      }
    } catch (err) {
      setError(payErrorMessage(err));
      if (err instanceof ApiRequestError && PAY_REFRESH_CODES.has(err.code)) void refresh();
    }
    setBusy(null);
  };

  const refund = order.refund;
  const showRefund =
    refund &&
    (order.status === OrderStatus.REFUND_PENDING || order.status === OrderStatus.REFUNDED);

  return (
    <>
      {awaiting && payment?.status === 'FAILED' && (
        <Notice tone={live ? 'orange' : 'red'}>
          <div className="font-semibold">
            {live ? 'Payment not confirmed' : 'Payment didn’t go through'}
          </div>
          <div className="mt-0.5">
            {payment.isSimulated
              ? 'The demo payment was declined. No money was charged.'
              : live && mayReport
                ? 'We couldn’t confirm your UPI payment. If money left your account, don’t pay again — report it below.'
                : live
                  ? 'We couldn’t confirm a UPI payment. If you haven’t paid yet, try again.'
                  : 'No money was taken. You can try again.'}
          </div>
          {!reportOpen && (
            <button
              type="button"
              className="mac-button mt-3 w-full sm:w-auto"
              disabled={busy !== null}
              onClick={() => void run('retry')}
            >
              {busy === 'retry' ? <Spinner /> : null}
              {live ? 'Pay again with UPI' : 'Try again'}
              {total ? ` · ${total}` : ''}
            </button>
          )}
        </Notice>
      )}

      {awaiting && paymentOpen && !reportOpen && live && (
        <Notice tone="orange">
          <div className="flex items-center gap-2 font-semibold">
            <Spinner /> Waiting for your UPI payment to be confirmed
          </div>
          <div className="mt-0.5">
            Finish paying{total ? ` ${total}` : ''} in your UPI app. This page updates by itself —
            already paid? Don’t pay again.
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            {checkoutUrl && (
              <a href={checkoutUrl} className="mac-button">
                Open payment page
              </a>
            )}
            <button
              type="button"
              className="rounded-full border border-separator bg-surface px-4 py-1.5 text-[14px] font-semibold text-accent hover:bg-selection disabled:opacity-50"
              disabled={busy !== null}
              onClick={() => void run('check')}
            >
              {busy === 'check' ? 'Checking…' : 'Check again'}
            </button>
          </div>
          {stillWaiting && busy === null && (
            <div className="mt-2 text-[13px]">Not confirmed yet. It can take a minute or two.</div>
          )}
        </Notice>
      )}

      {awaiting && paymentOpen && !reportOpen && !live && (
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
            onClick={() => void run('check')}
          >
            {busy === 'check' ? 'Checking…' : 'Check again'}
          </button>
        </Notice>
      )}

      {awaiting && <PaymentReportSection order={order} token={token} onChange={onChange} />}

      {showRefund && (
        <Notice tone={refund.status === 'SUCCEEDED' ? 'green' : 'orange'}>
          <div className="font-semibold">
            {refund.status === 'SUCCEEDED'
              ? `Refunded ${formatPaise(refund.amountPaise)}`
              : `Refund of ${formatPaise(refund.amountPaise)} in progress`}
          </div>
          {refund.isSimulated ? (
            <div className="mt-0.5">{DEMO_REFUND_NOTICE}</div>
          ) : refund.manual ? (
            <div className="mt-0.5">
              {refund.status === 'SUCCEEDED'
                ? 'The shop sent this money back to your UPI account.'
                : MANUAL_REFUND_NOTICE}
            </div>
          ) : null}
        </Notice>
      )}

      {order.canCancel && (
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            className="rounded-full border border-separator px-4 py-1.5 text-[14px] font-semibold text-red hover:bg-selection disabled:opacity-50"
            disabled={busy !== null}
            onClick={() => {
              const question = live
                ? 'Cancel this order? Only cancel if you haven’t paid for it.'
                : 'Cancel this order? You haven’t been charged.';
              if (window.confirm(question)) void run('cancel');
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

// ─── "Paid but not confirmed?" (ADR-003 fallback) ───

/** After these errors the server's view changed: re-fetch so the page matches it. */
const PAY_REFRESH_CODES = new Set(['PAYMENT_REPORT_OPEN', 'ORDER_NOT_PAYABLE']);
const REPORT_REFRESH_CODES = new Set([
  'PAYMENT_REPORT_TOO_EARLY',
  'PAYMENT_REPORT_OPEN',
  'PAYMENT_REPORT_LIMIT',
  'ORDER_NOT_PAYABLE',
]);

function PaymentReportSection({
  order,
  token,
  onChange,
}: {
  order: PublicOrder;
  token: string | null;
  onChange: (order: PublicOrder) => void;
}) {
  const report = order.paymentReport;
  const amount = order.amountPaise !== null ? formatPaise(order.amountPaise) : 'your payment';
  const refresh = () => {
    void getOrder(order.id, token).then(onChange, () => undefined);
  };

  if (report?.status === 'OPEN') {
    return (
      <Notice tone="orange">
        <div className="flex items-center gap-2 font-semibold">
          <Spinner /> Sent to the shop
        </div>
        <div className="mt-0.5">
          They’re checking their account for {amount} (ref {lastFour(report.utr)}). This page
          updates by itself.
        </div>
      </Notice>
    );
  }

  return (
    <>
      {report?.status === 'DECLINED' && (
        <Notice tone="red">
          <div className="font-semibold">The shop couldn’t confirm your payment</div>
          <div className="mt-0.5">
            {DECLINE_REASON_TEXT[report.declineReason ?? 'OTHER']} (ref {lastFour(report.utr)})
          </div>
          {!order.canReportPayment && (
            <div className="mt-1 text-[13px] opacity-80">
              If you’re sure you paid, please talk to the shop.
            </div>
          )}
        </Notice>
      )}

      {order.canReportPayment ? (
        <ReportPaymentForm
          order={order}
          token={token}
          again={report?.status === 'DECLINED'}
          onChange={onChange}
          onStale={refresh}
        />
      ) : (
        order.reportPaymentAfter && (
          <ReportLater
            key={order.reportPaymentAfter}
            after={order.reportPaymentAfter}
            onReached={refresh}
          />
        )
      )}
    </>
  );
}

function ReportPaymentForm({
  order,
  token,
  again,
  onChange,
  onStale,
}: {
  order: PublicOrder;
  token: string | null;
  again: boolean;
  onChange: (order: PublicOrder) => void;
  onStale: () => void;
}) {
  const id = useId();
  const [utr, setUtr] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = UtrSchema.safeParse(utr);
    if (!parsed.success) {
      setError('Enter the 12-digit UPI reference number.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onChange(await reportPayment(order.id, parsed.data, token));
      setUtr('');
    } catch (err) {
      setError(reportErrorMessage(err));
      if (err instanceof ApiRequestError && REPORT_REFRESH_CODES.has(err.code)) onStale();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Group title={again ? 'Report again' : 'Paid but not confirmed?'}>
      <form className="px-4 py-3" onSubmit={(e) => void submit(e)} noValidate>
        <p className="text-[14px] text-text-secondary">
          If money left your account but this page still says waiting, send the shop your UPI
          reference number. They’ll check it and confirm your order.
        </p>
        <label htmlFor={id} className="mt-3 block text-[13px] font-medium">
          UPI reference number (12 digits)
        </label>
        <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
          <input
            id={id}
            value={utr}
            // Digits only; pasted spaces/dashes are stripped (no maxLength: it would cut a paste).
            onChange={(e) => setUtr(e.target.value.replace(/\D/g, '').slice(0, 12))}
            inputMode="numeric"
            autoComplete="off"
            enterKeyHint="send"
            placeholder="e.g. 412345678901"
            aria-invalid={!!error}
            aria-describedby={`${id}-hint`}
            className={cx(
              'min-w-0 flex-1 rounded-lg border bg-surface px-3 py-2 font-mono text-[16px] tracking-wider tabular-nums outline-none transition-shadow',
              'placeholder:font-sans placeholder:tracking-normal placeholder:text-text-secondary/70 focus:ring-4 focus:ring-accent/20',
              error ? 'border-red' : 'border-separator focus:border-accent',
            )}
          />
          <button
            type="submit"
            className="mac-button disabled:opacity-40"
            disabled={busy || utr.length !== 12}
          >
            {busy ? <Spinner /> : null}
            Send to shop
          </button>
        </div>
        <p id={`${id}-hint`} className="mt-1.5 text-[12px] text-text-secondary">
          Find it as <span className="font-medium">UPI Ref No.</span> /{' '}
          <span className="font-medium">UTR</span> in your UPI app’s payment details.
          {utr.length > 0 && utr.length < 12 && ` ${utr.length}/12 digits.`}
        </p>
        {error && (
          <p role="alert" className="mt-1.5 text-[13px] font-medium text-red">
            {error}
          </p>
        )}
      </form>
    </Group>
  );
}

/** Muted "you can report it after 3:42 pm (in 4:12)" line; re-fetches when the time comes. */
function ReportLater({ after, onReached }: { after: string; onReached: () => void }) {
  const target = Date.parse(after);
  const remaining = useMsUntil(target, onReached);
  if (!Number.isFinite(target) || remaining <= 0) return null;
  return (
    <p className="mt-3 px-1 text-[13px] text-text-secondary">
      If you’ve paid and it isn’t confirmed, you can report it after {formatTime(target)} (in{' '}
      <span className="tabular-nums">{formatCountdown(remaining)}</span>).
    </p>
  );
}

/** Milliseconds until `target`, ticking each second; calls `onReached` once when it passes. */
function useMsUntil(target: number, onReached: () => void): number {
  const [now, setNow] = useState(() => Date.now());
  const reached = useRef(onReached);
  useEffect(() => {
    reached.current = onReached;
  });
  useEffect(() => {
    if (!Number.isFinite(target)) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    let grace: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      const n = Date.now();
      setNow(n);
      return n < target;
    };
    // Already past on mount: nothing to wait for (the server said "not now" for another reason).
    if (tick()) {
      timer = setInterval(() => {
        if (tick()) return;
        clearInterval(timer);
        // Small grace period so the server's clock agrees the time has passed.
        grace = setTimeout(() => reached.current(), 1500);
      }, 1000);
    }
    return () => {
      clearInterval(timer);
      clearTimeout(grace);
    };
  }, [target]);
  return Number.isFinite(target) ? Math.max(0, target - now) : 0;
}

// ─── Copy helpers ───

/** The API already masks the UTR; show just its last four digits. */
const lastFour = (maskedUtr: string) => `••••${maskedUtr.slice(-4)}`;

const formatTime = (ms: number) =>
  new Date(ms).toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: '2-digit',
  });

function formatCountdown(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

function payErrorMessage(err: unknown): string {
  if (!(err instanceof ApiRequestError)) return 'Something went wrong. Please try again.';
  switch (err.code) {
    case 'PAYMENT_REPORT_OPEN':
      return 'You’ve reported a payment for this order. Please wait while the shop checks it.';
    case 'ORDER_NOT_PAYABLE':
      return 'This order can’t take a payment any more.';
    default:
      return err.message;
  }
}

function reportErrorMessage(err: unknown): string {
  if (!(err instanceof ApiRequestError)) return 'Something went wrong. Please try again.';
  switch (err.code) {
    case 'VALIDATION_FAILED':
      return 'Enter the 12-digit UPI reference number.';
    case 'PAYMENT_REPORT_TOO_EARLY': {
      const after = afterOf(err.details);
      return after
        ? `It’s a little early — we’re still checking automatically. You can report it after ${formatTime(after)}.`
        : 'It’s a little early — we’re still checking automatically. Please try again in a few minutes.';
    }
    case 'PAYMENT_REPORT_OPEN':
      return 'You’ve already reported this payment. The shop is checking it.';
    case 'PAYMENT_REPORT_LIMIT':
      return 'This order has been reported too many times. Please talk to the shop.';
    case 'PAYMENT_REPORT_UTR_USED':
      return 'This UPI reference number has already been used. Check you copied the right one from your UPI app.';
    case 'ORDER_NOT_PAYABLE':
      return 'This order can’t take a payment any more.';
    default:
      return err.message;
  }
}

/** `details.after` (ISO time) from a PAYMENT_REPORT_TOO_EARLY error, if present. */
function afterOf(details: unknown): number | null {
  if (typeof details !== 'object' || details === null || !('after' in details)) return null;
  const after = Date.parse(String(details.after));
  return Number.isFinite(after) ? after : null;
}
