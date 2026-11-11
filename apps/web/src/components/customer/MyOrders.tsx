'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { type Customer, type MyOrder, formatPaise, formatPickupDate } from '@kagaz/shared';
import { Chevron, Group, Notice, Pill, Spinner, cx } from '@/components/ui';
import { ApiRequestError } from '@/lib/api';
import { getMe, listMyOrders, signOut } from '@/lib/customer-api';
import { STATUS_COPY } from '@/lib/status';

type State =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; customer: Customer; orders: MyOrder[] };

/** "My orders" for a signed-in customer (P2.2, FR-CUST-13). */
export function MyOrders() {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const customer = await getMe();
        if (!customer) {
          if (!cancelled) setState({ kind: 'signed-out' });
          return;
        }
        const orders = await listMyOrders();
        if (!cancelled) setState({ kind: 'ready', customer, orders });
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiRequestError && err.status === 401) setState({ kind: 'signed-out' });
        else setState({ kind: 'error', message: 'Can’t load your orders right now.' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.kind === 'loading') {
    return (
      <div className="flex items-center gap-2 py-10 text-text-secondary">
        <Spinner /> Loading your orders…
      </div>
    );
  }
  if (state.kind === 'signed-out') {
    return (
      <section>
        <h1 className="mac-title">My orders</h1>
        <p className="mt-1.5 text-[15px] text-text-secondary">
          Sign in with your mobile number to see every order you’ve placed.
        </p>
        <Link href="/signin?next=/orders" className="mac-button mt-5">
          Sign in
        </Link>
      </section>
    );
  }
  if (state.kind === 'error') return <Notice tone="red">{state.message}</Notice>;

  return (
    <section>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="mac-title">My orders</h1>
          <p className="mt-1 truncate text-[13px] text-text-secondary">
            Signed in as {state.customer.phone}
          </p>
        </div>
        <button
          type="button"
          className="mt-1 shrink-0 rounded-full border border-separator px-3 py-1 text-[13px] font-semibold text-accent hover:bg-selection"
          onClick={async () => {
            await signOut().catch(() => undefined);
            router.push('/');
            router.refresh();
          }}
        >
          Sign out
        </button>
      </div>

      <Group title="Orders">
        {state.orders.length === 0 && (
          <div className="px-4 py-6 text-center text-[14px] text-text-secondary">
            No orders yet.{' '}
            <Link href="/" className="font-semibold text-accent">
              Start one
            </Link>
          </div>
        )}
        {state.orders.map((o) => {
          const copy = STATUS_COPY[o.status];
          return (
            <Link
              key={o.id}
              href={`/order/${o.id}`}
              className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-selection/60"
            >
              <div
                className={cx(
                  'grid w-14 shrink-0 place-items-center rounded-lg py-1 text-center',
                  o.pickupNumber !== null ? 'bg-selection' : 'opacity-0',
                )}
                aria-label={
                  o.pickupNumber !== null && o.pickupDate
                    ? `Pickup code ${o.pickupNumber}, ${formatPickupDate(o.pickupDate)}`
                    : undefined
                }
                aria-hidden={o.pickupNumber === null}
              >
                {o.pickupNumber !== null && o.pickupDate && (
                  <>
                    <span className="text-[20px] leading-tight font-bold tabular-nums">
                      #{o.pickupNumber}
                    </span>
                    <span className="text-[11px] text-text-secondary">
                      {formatPickupDate(o.pickupDate)}
                    </span>
                  </>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-mono text-[14px] font-semibold whitespace-nowrap">
                    {o.publicRef}
                  </span>
                  <span className="whitespace-nowrap">
                    <Pill tone={copy.tone}>{copy.label}</Pill>
                  </span>
                </div>
                <div className="mt-0.5 truncate text-[13px] text-text-secondary">
                  {o.shopName} ·{' '}
                  {new Date(o.createdAt).toLocaleDateString('en-IN', {
                    timeZone: 'Asia/Kolkata',
                    dateStyle: 'medium',
                  })}
                </div>
              </div>
              <div className="shrink-0 text-right">
                {o.amountPaise !== null && (
                  <div className="text-[15px] font-semibold tabular-nums">
                    {formatPaise(o.amountPaise)}
                  </div>
                )}
                {o.isSimulated && <div className="text-[11px] text-text-secondary">Demo</div>}
              </div>
              <Chevron />
            </Link>
          );
        })}
      </Group>
    </section>
  );
}
