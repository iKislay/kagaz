'use client';

/**
 * Admin demo controls (P2.2 / P3.5) — self-contained page: OTP inbox + per-order simulated
 * payment outcome. Available only while demo controls are enabled (never in production).
 */
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import {
  AdminLoginResponseSchema,
  type DemoOtpInbox,
  DemoOtpInboxSchema,
  type DemoPaymentOutcome,
  type DemoPayments,
  DemoPaymentsSchema,
  formatPaise,
} from '@kagaz/shared';
import { Group, Notice, Pill, Spinner } from '@/components/ui';
import { ApiRequestError, apiFetch } from '@/lib/api';
import { STATUS_COPY } from '@/lib/status';

const REFRESH_MS = 3000;

const OUTCOME_COPY: Record<DemoPaymentOutcome, string> = {
  SUCCESS: 'Success',
  FAIL: 'Fail',
  PENDING: 'Pending → paid later',
  DUPLICATE_WEBHOOK: 'Duplicate webhook',
  OUT_OF_ORDER: 'Out-of-order webhooks',
};

type Load =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'disabled' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; inbox: DemoOtpInbox; payments: DemoPayments };

export default function AdminDemoPage() {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  useEffect(() => {
    document.title = 'Demo controls — Kagaz admin';
  }, []);
  const [saving, setSaving] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [inbox, payments] = await Promise.all([
        apiFetch('/admin/demo/otp-inbox', DemoOtpInboxSchema),
        apiFetch('/admin/demo/payments', DemoPaymentsSchema),
      ]);
      setLoad({ kind: 'ready', inbox, payments });
    } catch (err) {
      if (err instanceof ApiRequestError && err.status === 401) setLoad({ kind: 'signed-out' });
      else if (err instanceof ApiRequestError && err.status === 404) setLoad({ kind: 'disabled' });
      else setLoad({ kind: 'error', message: 'Can’t reach the Kagaz API.' });
    }
  }, []);

  // Poll only while the controls are showing (no repeated 401/404s when signed out or off).
  const live = load.kind === 'ready' || load.kind === 'error';
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(t);
  }, [live, refresh]);

  const setOutcome = async (orderId: string, outcome: DemoPaymentOutcome | null) => {
    setSaving(orderId);
    try {
      await apiFetch(`/admin/demo/payments/${orderId}/outcome`, z.unknown(), {
        method: 'PUT',
        body: { outcome },
      });
      await refresh();
    } finally {
      setSaving(null);
    }
  };

  return (
    <section>
      <p className="text-[13px] font-medium text-text-secondary">
        <Link href="/admin" className="text-accent">
          Admin
        </Link>{' '}
        · Demo
      </p>
      <h1 className="mac-title mt-0.5">Demo controls</h1>
      <p className="mt-1.5 text-[15px] text-text-secondary">
        Simulated channels for the investor demo. No SMS is sent and no money moves.
      </p>

      {load.kind === 'loading' && (
        <div className="flex items-center gap-2 py-10 text-text-secondary">
          <Spinner /> Loading…
        </div>
      )}
      {load.kind === 'signed-out' && <AdminSignIn onDone={() => void refresh()} />}
      {load.kind === 'disabled' && (
        <Notice tone="orange">Demo controls are turned off in this environment.</Notice>
      )}
      {load.kind === 'error' && <Notice tone="red">{load.message}</Notice>}

      {load.kind === 'ready' && (
        <>
          <Group
            title="OTP inbox"
            footer="Sign-in codes sent by the demo OTP provider. Newest first; refreshes every 3 s."
          >
            {load.inbox.items.length === 0 && (
              <div className="px-4 py-5 text-center text-[14px] text-text-secondary">
                No codes sent yet.
              </div>
            )}
            {load.inbox.items.slice(0, 10).map((m) => {
              const expired = new Date(m.expiresAt).getTime() < Date.now();
              return (
                <div key={`${m.phone}-${m.sentAt}`} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-[14px]">{m.phone}</div>
                    <div className="text-[12px] text-text-secondary">
                      {new Date(m.sentAt).toLocaleTimeString('en-IN', {
                        timeZone: 'Asia/Kolkata',
                        timeStyle: 'medium',
                      })}
                    </div>
                  </div>
                  <span
                    className={`select-all font-mono text-[22px] font-bold tracking-[0.15em] ${
                      expired ? 'text-text-secondary line-through' : ''
                    }`}
                  >
                    {m.code}
                  </span>
                </div>
              );
            })}
          </Group>

          <Group
            title="Payment outcome per order"
            footer="Applies to the order’s next payment attempt, then resets to Success."
          >
            {load.payments.orders.length === 0 && (
              <div className="px-4 py-5 text-center text-[14px] text-text-secondary">
                No orders yet.
              </div>
            )}
            {load.payments.orders.map((o) => {
              const copy = STATUS_COPY[o.status];
              return (
                <div
                  key={o.id}
                  className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[14px] font-semibold">{o.publicRef}</span>
                      <Pill tone={copy.tone}>{copy.label}</Pill>
                      {o.paymentStatus && (
                        <span className="text-[12px] text-text-secondary">
                          payment {o.paymentStatus.toLowerCase()}
                        </span>
                      )}
                    </div>
                    <div className="truncate text-[12px] text-text-secondary">
                      {o.shopName}
                      {o.amountPaise !== null && ` · ${formatPaise(o.amountPaise)}`}
                    </div>
                  </div>
                  <select
                    aria-label={`Next payment outcome for ${o.publicRef}`}
                    className="rounded-lg border border-separator bg-surface px-2 py-1.5 text-[13px] outline-none focus:border-accent focus:ring-4 focus:ring-accent/20 disabled:opacity-50"
                    disabled={saving === o.id || o.status !== 'AWAITING_PAYMENT'}
                    value={o.nextOutcome ?? 'SUCCESS'}
                    onChange={(e) => {
                      const v = e.target.value as DemoPaymentOutcome;
                      void setOutcome(o.id, v === 'SUCCESS' ? null : v);
                    }}
                  >
                    {load.payments.outcomes.map((outcome) => (
                      <option key={outcome} value={outcome}>
                        {OUTCOME_COPY[outcome]}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </Group>
        </>
      )}
    </section>
  );
}

/** Minimal admin sign-in so this page works on its own. */
function AdminSignIn({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('admin@kagaz.local');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input =
    'w-full rounded-lg border border-separator bg-surface px-3 py-2 text-[15px] outline-none focus:border-accent focus:ring-4 focus:ring-accent/20';
  return (
    <form
      className="mac-card mt-6 max-w-sm space-y-3 p-5"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          await apiFetch('/admin/auth/login', AdminLoginResponseSchema, {
            method: 'POST',
            body: { email, password },
          });
          onDone();
        } catch (err) {
          setError(err instanceof ApiRequestError ? err.message : 'Sign-in failed.');
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="text-[15px] font-semibold">Admin sign-in required</p>
      <input
        className={input}
        type="email"
        autoComplete="username"
        aria-label="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        className={input}
        type="password"
        autoComplete="current-password"
        aria-label="Password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <button type="submit" className="mac-button w-full" disabled={busy}>
        {busy && <Spinner />} Sign in
      </button>
      {error && <p className="text-[13px] text-red">{error}</p>}
    </form>
  );
}
