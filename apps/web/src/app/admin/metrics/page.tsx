'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { type AdminOverview } from '@kagaz/shared';
import { Pill, SegmentedControl } from '@/components/ui';
import { adminApi } from '../_lib/api';
import { fmtDay, fmtDuration, humanize, orderTone, rupees } from '../_lib/format';
import {
  Card,
  Empty,
  ErrorNote,
  Loading,
  PageHeader,
  StatTile,
  Table,
  Td,
  useLoad,
} from '../_components/kit';
import { useAdminSession } from '../_components/session';

type Range = '7' | '14' | '30';

/**
 * Investor metrics dashboard (P4.8, FR-ADMIN-11): orders by shop/status/day, turnaround and
 * printer uptime. The live per-shop overview lives at /admin.
 */
export default function AdminMetricsPage() {
  const { me } = useAdminSession();
  const router = useRouter();
  useEffect(() => {
    if (me.role !== 'ADMIN') router.replace('/admin/shops');
  }, [me.role, router]);
  if (me.role !== 'ADMIN') return null;
  return <Metrics />;
}

function Metrics() {
  const [range, setRange] = useState<Range>('14');
  const { data, error, loading } = useLoad(
    () => adminApi.overview({ days: Number(range) }),
    [range],
  );

  return (
    <>
      <PageHeader
        title="Metrics"
        subtitle={data ? `${fmtDay(data.from)} – ${fmtDay(data.to)} · Asia/Kolkata` : ' '}
        actions={
          <SegmentedControl
            label="Date range"
            value={range}
            onChange={setRange}
            options={[
              { value: '7', label: '7 days' },
              { value: '14', label: '14 days' },
              { value: '30', label: '30 days' },
            ]}
          />
        }
      />
      <ErrorNote error={error} />
      {loading && !data ? <Loading /> : data && <OverviewBody data={data} />}
    </>
  );
}

function OverviewBody({ data }: { data: AdminOverview }) {
  const t = data.turnaround;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Orders" value={data.totals.orders} hint="excluding drafts" />
        <StatTile
          label="Paid"
          value={data.totals.paidOrders}
          hint={rupees(data.totals.paidPaise)}
        />
        <StatTile label="Collected" value={data.totals.collected} />
        <StatTile label="Rejected" value={data.totals.rejected} hint="incl. refunded" />
        <StatTile
          label="Paid → ready"
          value={fmtDuration(t.paidToReadyMedianSeconds)}
          hint={`median · ${t.paidToReadySamples} orders`}
        />
        <StatTile
          label="Ready → collected"
          value={fmtDuration(t.readyToCollectedMedianSeconds)}
          hint={`median · ${t.readyToCollectedSamples} orders`}
        />
      </div>

      <Card title="Orders per day">
        <DayBars days={data.byDay} />
      </Card>

      <div className="grid gap-5 2xl:grid-cols-[3fr_2fr]">
        <Card title="By shop" flush>
          {data.byShop.length === 0 ? (
            <Empty>No shops yet.</Empty>
          ) : (
            <Table
              head={[
                'Shop',
                'Orders',
                'Collected',
                'Rejected',
                'Paid → ready',
                'Ready → collected',
              ]}
            >
              {data.byShop.map((s) => (
                <tr key={s.shopId}>
                  <Td className="min-w-48 font-medium">{s.shopName}</Td>
                  <Td className="tabular-nums">{s.total}</Td>
                  <Td className="tabular-nums">{s.byStatus.COLLECTED ?? 0}</Td>
                  <Td className="tabular-nums">
                    {(s.byStatus.REJECTED ?? 0) +
                      (s.byStatus.REFUND_PENDING ?? 0) +
                      (s.byStatus.REFUNDED ?? 0)}
                  </Td>
                  <Td>{fmtDuration(s.turnaround.paidToReadyMedianSeconds)}</Td>
                  <Td>{fmtDuration(s.turnaround.readyToCollectedMedianSeconds)}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card title="By status" flush>
          {Object.keys(data.byStatus).length === 0 ? (
            <Empty>No orders in this range.</Empty>
          ) : (
            <Table head={['Status', 'Orders']}>
              {Object.entries(data.byStatus)
                .sort((a, b) => b[1] - a[1])
                .map(([status, count]) => (
                  <tr key={status}>
                    <Td>
                      <Pill tone={orderTone(status)}>{humanize(status)}</Pill>
                    </Td>
                    <Td className="tabular-nums">{count}</Td>
                  </tr>
                ))}
            </Table>
          )}
        </Card>
      </div>

      <Card title="Printer uptime" flush>
        {data.printerUptime.length === 0 ? (
          <Empty>No printers registered.</Empty>
        ) : (
          <Table head={['Printer', 'Shop', 'Uptime', 'Samples']}>
            {data.printerUptime.map((p) => (
              <tr key={p.printerId}>
                <Td className="font-medium">{p.displayName}</Td>
                <Td className="text-text-secondary">{p.shopName}</Td>
                <Td>
                  <Meter ratio={p.uptimeRatio} />
                </Td>
                <Td className="tabular-nums text-text-secondary">{p.observedSamples}</Td>
              </tr>
            ))}
          </Table>
        )}
        <p className="border-t border-separator px-4 py-2 text-[12px] text-text-secondary">
          Approximate: sampled once a minute — up when the printer reports Ready and its shop PC is
          online.
        </p>
      </Card>
    </div>
  );
}

/** Single-series bar chart (accent), baseline-anchored, hover tooltip per bar. */
function DayBars({ days }: { days: AdminOverview['byDay'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...days.map((d) => d.total));
  const showEvery = days.length > 14 ? 3 : days.length > 7 ? 2 : 1;
  const h = hover === null ? null : days[hover];
  return (
    <div>
      <div className="relative">
        <div
          className="flex h-40 items-end gap-[2px] border-b border-separator"
          role="img"
          aria-label="Orders per day"
        >
          {days.map((d, i) => (
            <div
              key={d.date}
              className="flex h-full flex-1 cursor-default items-end px-[1px]"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              <div
                className={`w-full rounded-t-[4px] transition-opacity ${hover !== null && hover !== i ? 'opacity-50' : ''} bg-accent`}
                style={{ height: `${d.total === 0 ? 0 : Math.max(3, (d.total / max) * 100)}%` }}
              />
            </div>
          ))}
        </div>
        {h && hover !== null && (
          <div
            className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-lg border border-separator bg-surface px-2.5 py-1.5 text-[12px] shadow-card"
            style={{ left: `${((hover + 0.5) / days.length) * 100}%` }}
          >
            <div className="font-semibold">{fmtDay(h.date)}</div>
            <div className="tabular-nums text-text-secondary">
              {h.total} order{h.total === 1 ? '' : 's'}
              {h.byStatus.COLLECTED ? ` · ${h.byStatus.COLLECTED} collected` : ''}
            </div>
          </div>
        )}
      </div>
      <div className="mt-1.5 flex gap-[2px] text-[11px] text-text-secondary">
        {days.map((d, i) => (
          <div key={d.date} className="flex-1 truncate text-center">
            {i % showEvery === 0 ? fmtDay(d.date) : ''}
          </div>
        ))}
      </div>
      <div className="mt-1 text-right text-[11px] text-text-secondary">max {max} / day</div>
    </div>
  );
}

function Meter({ ratio }: { ratio: number | null }) {
  if (ratio === null) return <span className="text-text-secondary">no data</span>;
  const pct = Math.round(ratio * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-28 overflow-hidden rounded-full bg-selection">
        <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
      <span className="tabular-nums">{pct}%</span>
    </div>
  );
}
