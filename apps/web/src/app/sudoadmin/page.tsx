'use client';

import Link from 'next/link';
import { Chevron, Pill } from '@/components/ui';
import { rupees } from '../admin/_lib/format';
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
} from '../admin/_components/kit';
import { sudoApi } from './_lib/api';
import { ATTENTION, METHOD_LABEL, fmtDate } from './_lib/format';
import { sudoIcons } from './_components/icons';
import { LinkButton } from './_components/parts';

/** Platform overview: tenants, recurring revenue, collections and what needs attention. */
export default function SudoOverviewPage() {
  const { data, error, loading } = useLoad(() => sudoApi.overview(), []);

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="Every shop on Kagaz, their subscriptions and what needs a follow-up."
        actions={
          <LinkButton href="/sudoadmin/shops/new">
            {sudoIcons.plus}
            New shop
          </LinkButton>
        }
      />
      <ErrorNote error={error} />
      {loading && !data ? (
        <Loading />
      ) : (
        data && (
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile
                label="Live shops"
                value={data.shops.live}
                hint={`${data.shops.suspended} suspended · ${data.shops.archived} archived`}
              />
              <StatTile
                label="Monthly recurring"
                value={rupees(data.mrrPaise)}
                hint={`${data.subscriptions.active} active · ${data.subscriptions.trialing} on trial`}
              />
              <StatTile
                label="Collected this month"
                value={rupees(data.collectedThisMonthPaise)}
                hint={`Last month ${rupees(data.collectedLastMonthPaise)}`}
              />
              <StatTile
                label="Paid orders · 30 days"
                value={data.orders30d}
                hint={`${rupees(data.gmv30dPaise)} order value (incl. demo)`}
              />
            </div>

            <Card
              title={`Needs attention${data.attention.length ? ` (${data.attention.length})` : ''}`}
              flush
            >
              {data.attention.length === 0 ? (
                <Empty>Nothing to follow up. Every live shop is paid up and paired.</Empty>
              ) : (
                <ul className="divide-y divide-separator">
                  {data.attention.map((a, i) => (
                    <li key={`${a.shopId}-${a.kind}-${i}`}>
                      <Link
                        href={`/sudoadmin/shops/${a.shopId}`}
                        className="flex items-center gap-3 px-4 py-2.5 hover:bg-selection/40"
                      >
                        <span className="w-28 shrink-0">
                          <Pill tone={ATTENTION[a.kind].tone}>{ATTENTION[a.kind].label}</Pill>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="text-[13px] font-medium">{a.shopName}</span>
                          <span className="ml-2 text-[13px] text-text-secondary">{a.detail}</span>
                        </span>
                        <Chevron />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Recent subscription payments" flush>
              {data.recentPayments.length === 0 ? (
                <Empty>No payments recorded yet.</Empty>
              ) : (
                <Table head={['Date', 'Shop', 'Method', 'Amount']}>
                  {data.recentPayments.map((p) => (
                    <tr key={p.id}>
                      <Td>{fmtDate(p.paidAt)}</Td>
                      <Td>
                        <Link
                          href={`/sudoadmin/shops/${p.shopId}`}
                          className="font-medium hover:text-accent"
                        >
                          {p.shopName}
                        </Link>
                      </Td>
                      <Td>{METHOD_LABEL[p.method]}</Td>
                      <Td className="tabular-nums">{rupees(p.amountPaise)}</Td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>
          </div>
        )
      )}
    </>
  );
}
