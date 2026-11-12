'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { type AdminShop } from '@kagaz/shared';
import { Dot, Pill } from '@/components/ui';
import { adminApi } from './_lib/api';
import { fmtAgo, humanize, printerTone, rupees, shopStatusTone } from './_lib/format';
import { Card, Empty, ErrorNote, Loading, PageHeader, useLoad } from './_components/kit';
import { useAdminSession } from './_components/session';

/** Live queue counters, in the order the demo script walks through them. */
const QUEUE_BUCKETS = [
  { key: 'PENDING_REVIEW', label: 'Pending' },
  { key: 'QUEUED', label: 'Queue' },
  { key: 'PRINTING', label: 'Printing' },
  { key: 'NEEDS_OPERATOR_CHECK', label: 'Needs check' },
  { key: 'READY_FOR_PICKUP', label: 'Ready' },
] as const;

const REFRESH_MS = 10_000;

/**
 * Live operations overview (P2.13, FR-ADMIN-02; PRD §18 demo script 2:15–2:45).
 * One card per shop: open status, approval mode, device online dot, printer status,
 * the live queue and today's orders/revenue. Refreshes every 10 s.
 */
export default function AdminOverviewPage() {
  const { me } = useAdminSession();
  const router = useRouter();
  useEffect(() => {
    if (me.role !== 'ADMIN') router.replace('/superadmin/shops');
  }, [me.role, router]);
  if (me.role !== 'ADMIN') return null;
  return <Overview />;
}

function Overview() {
  const { data, error, loading, reload } = useLoad(() => adminApi.shops(), []);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  useEffect(() => {
    if (data) setUpdatedAt(new Date());
  }, [data]);

  // Safety poll: the API is the source of truth, so refresh on a timer (no sockets here).
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.hidden) return;
      void reload();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [reload]);

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="Live shop status — refreshes every 10 seconds."
        actions={
          updatedAt ? (
            <span className="text-[12px] text-text-secondary">
              Updated {fmtAgo(updatedAt.toISOString())}
            </span>
          ) : null
        }
      />
      <ErrorNote error={error} />
      {loading && !data ? (
        <Loading />
      ) : !data ? null : data.shops.length === 0 ? (
        <Card>
          <Empty>No shops yet.</Empty>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.shops.map((shop) => (
            <ShopCard key={shop.id} shop={shop} />
          ))}
        </div>
      )}
    </>
  );
}

function ShopCard({ shop }: { shop: AdminShop }) {
  const online = shop.devices.some((d) => d.online);
  const mode =
    shop.approvalMode === 'AUTO' ? (shop.autoPaused ? 'Auto · paused' : 'Auto') : 'Manual';
  const printer = shop.printers[0] ?? null;
  const simulated = shop.todaySimulatedRevenuePaise > 0;

  return (
    <section className="mac-card flex flex-col overflow-hidden">
      <header className="flex items-start justify-between gap-3 border-b border-separator px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-[15px] font-semibold">
            <Link href={`/superadmin/shops/${shop.id}`} className="hover:text-accent">
              {shop.name}
            </Link>
          </h2>
          <p className="truncate text-[12px] text-text-secondary">{shop.address}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {shop.isDemo && (
            <span className="rounded-full bg-notice px-2 py-0.5 text-[10px] font-semibold tracking-wide text-notice-text">
              DEMO
            </span>
          )}
          <Pill tone={shopStatusTone(shop.status)}>{humanize(shop.status)}</Pill>
        </div>
      </header>

      <div className="flex-1 px-4 py-3">
        <dl className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px]">
          <div className="flex items-center gap-1.5">
            <dt className="text-text-secondary">Mode</dt>
            <dd className="font-medium">{mode}</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt className="text-text-secondary">Shop PC</dt>
            <dd className="inline-flex items-center gap-1.5 font-medium">
              <Dot tone={online ? 'green' : shop.devices.length ? 'red' : 'neutral'} />
              {shop.devices.length === 0 ? 'Not paired' : online ? 'Online' : 'Offline'}
            </dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt className="text-text-secondary">Printer</dt>
            <dd className="inline-flex items-center gap-1.5 font-medium">
              {printer ? (
                <>
                  <Dot tone={printerTone(printer.status)} />
                  {printer.displayName}
                  <span className="font-normal text-text-secondary">
                    ({humanize(printer.status)})
                  </span>
                </>
              ) : (
                <span className="text-text-secondary">None</span>
              )}
            </dd>
          </div>
        </dl>

        {printer?.activeJob && (
          <p className="mt-2 text-[12px] text-text-secondary">
            Printing{' '}
            <Link
              href={`/superadmin/orders/${printer.activeJob.orderId}`}
              className="text-accent hover:underline"
            >
              {printer.activeJob.publicRef}
            </Link>{' '}
            (attempt {printer.activeJob.attempt})
          </p>
        )}

        <div className="mt-3 grid grid-cols-5 gap-1.5">
          {QUEUE_BUCKETS.map((b) => {
            const count = shop.orderCounts[b.key] ?? 0;
            return (
              <div
                key={b.key}
                className="rounded-lg bg-selection px-1 py-1.5 text-center"
                title={b.label}
              >
                <div
                  className={`text-[16px] font-semibold tabular-nums ${
                    b.key === 'NEEDS_OPERATOR_CHECK' && count > 0 ? 'text-orange' : ''
                  }`}
                >
                  {count}
                </div>
                <div className="text-[10px] leading-tight text-text-secondary">{b.label}</div>
              </div>
            );
          })}
        </div>
      </div>

      <footer className="flex items-baseline justify-between gap-2 border-t border-separator px-4 py-2 text-[12px]">
        <span className="text-text-secondary">Today</span>
        <span className="tabular-nums">
          {shop.todayOrders} order{shop.todayOrders === 1 ? '' : 's'} ·{' '}
          {rupees(shop.todayRevenuePaise)}
          {simulated && <span className="ml-1 text-notice-text">demo</span>}
        </span>
      </footer>
    </section>
  );
}
