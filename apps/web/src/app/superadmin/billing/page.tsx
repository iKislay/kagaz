'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Fragment, useEffect, useState } from 'react';
import { type AdminBillingOverview } from '@kagaz/shared';
import { Notice, Pill } from '@/components/ui';
import { billingApi } from '../_lib/billing-api';
import { humanize, rupees } from '../_lib/format';
import {
  Button,
  Card,
  Empty,
  ErrorNote,
  Loading,
  PageHeader,
  Select,
  StatTile,
  Table,
  Td,
  useLoad,
} from '../_components/kit';
import { useAdminSession } from '../_components/session';
import {
  type BillingAction,
  ShopBillingPanel,
  fmtDate,
  summaryTone,
} from '../shops/[id]/subscription';

type Row = AdminBillingOverview['shops'][number];
type Sort = 'status' | 'due' | 'ends' | 'name';

/** Attention first: no plan / expired / expiring, then active. */
const STATUS_ORDER: Record<Row['status'], number> = { EXPIRED: 0, NONE: 1, EXPIRING: 2, ACTIVE: 3 };
const SORTS: Record<Sort, (a: Row, b: Row) => number> = {
  status: (a, b) =>
    STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (a.daysLeft ?? 0) - (b.daysLeft ?? 0),
  due: (a, b) => b.balanceDuePaise - a.balanceDuePaise,
  ends: (a, b) => (a.periodEnd ?? '9').localeCompare(b.periodEnd ?? '9'),
  name: (a, b) => a.shopName.localeCompare(b.shopName),
};

/** Subscriptions across all shops (ADR-004). Kaggaz admins only. */
export default function BillingPage() {
  const { me } = useAdminSession();
  const router = useRouter();
  useEffect(() => {
    if (me.role !== 'ADMIN') router.replace('/superadmin/shops');
  }, [me.role, router]);
  if (me.role !== 'ADMIN') return null;
  return <Billing />;
}

function Billing() {
  const { data, error, loading, reload } = useLoad(() => billingApi.overview(), []);
  const [sort, setSort] = useState<Sort>('status');
  const [open, setOpen] = useState<{ shopId: string; action: BillingAction } | null>(null);
  if (loading && !data) return <Loading />;

  const shops = [...(data?.shops ?? [])].sort(SORTS[sort]);
  const count = (s: Row['status']) => shops.filter((r) => r.status === s).length;
  const due = shops.reduce((sum, r) => sum + r.balanceDuePaise, 0);

  return (
    <>
      <PageHeader title="Billing" subtitle="Shop subscriptions, per connected printer." />
      <ErrorNote error={error} />
      {data && !data.enforced && (
        <Notice tone="orange">
          Billing isn’t enforced yet: set BILLING_ENFORCED=true on the API to stop shops without a
          plan from taking orders.
        </Notice>
      )}
      <div className="mb-5 grid gap-3 sm:grid-cols-4">
        <StatTile label="Collected this month" value={rupees(data?.collectedThisMonthPaise ?? 0)} />
        <StatTile label="Balance due" value={rupees(due)} />
        <StatTile
          label="Active"
          value={count('ACTIVE') + count('EXPIRING')}
          hint={`${count('EXPIRING')} ending within 7 days`}
        />
        <StatTile label="No plan / expired" value={count('NONE') + count('EXPIRED')} />
      </div>
      <Card
        title="Shops"
        flush
        actions={
          <Select
            label="Sort by"
            hideLabel
            value={sort}
            onChange={setSort}
            options={[
              { value: 'status', label: 'Needs attention' },
              { value: 'due', label: 'Balance due' },
              { value: 'ends', label: 'Ends soonest' },
              { value: 'name', label: 'Name' },
            ]}
          />
        }
      >
        {shops.length === 0 ? (
          <Empty>No shops yet.</Empty>
        ) : (
          <Table head={['Shop', 'Plan', 'Printers', 'Ends', 'Balance due', '']}>
            {shops.map((r) => (
              <Fragment key={r.shopId}>
                <tr>
                  <Td>
                    <Link
                      href={`/superadmin/shops/${r.shopId}`}
                      className="font-medium hover:text-accent"
                    >
                      {r.shopName}
                    </Link>
                  </Td>
                  <Td>
                    <Pill tone={summaryTone(r.status)}>{humanize(r.status)}</Pill>
                  </Td>
                  <Td>
                    <span
                      className={
                        r.connectedPrinters > r.printerSeats ? 'font-semibold text-red' : ''
                      }
                    >
                      {r.connectedPrinters} / {r.printerSeats}
                    </span>
                  </Td>
                  <Td>
                    {r.periodEnd ? fmtDate(r.periodEnd) : '—'}
                    {r.status !== 'NONE' && r.daysLeft !== null && r.daysLeft > 0 && (
                      <span className="text-text-secondary"> · {r.daysLeft} d</span>
                    )}
                  </Td>
                  <Td mono>{rupees(r.balanceDuePaise)}</Td>
                  <Td>
                    <RowActions
                      row={r}
                      active={open?.shopId === r.shopId ? open.action : null}
                      onPick={(action) =>
                        setOpen(
                          open?.shopId === r.shopId && open.action === action
                            ? null
                            : { shopId: r.shopId, action },
                        )
                      }
                    />
                  </Td>
                </tr>
                {open?.shopId === r.shopId && (
                  <tr>
                    <td colSpan={6} className="bg-bg/60 px-4 py-4">
                      <ShopBillingPanel
                        key={open.action}
                        shopId={r.shopId}
                        action={open.action}
                        onChanged={() => void reload()}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}

/** Row buttons; plan actions need a plan, renew/new works for every shop. */
function RowActions({
  row,
  active,
  onPick,
}: {
  row: Row;
  active: BillingAction | null;
  onPick: (a: BillingAction) => void;
}) {
  const hasPlan = row.status === 'ACTIVE' || row.status === 'EXPIRING';
  const items: [BillingAction, string, boolean][] = [
    ['renew', row.status === 'NONE' ? 'New plan' : 'Renew', true],
    ['change', 'Change plan', hasPlan],
    ['extend', 'Extend', hasPlan || row.status === 'EXPIRED'],
    ['pay', 'Record payment', row.status !== 'NONE'],
    ['cancel', 'Cancel', hasPlan],
  ];
  return (
    <span className="inline-flex flex-wrap justify-end gap-1.5">
      {items
        .filter(([, , show]) => show)
        .map(([action, label]) => (
          <Button
            key={action}
            variant={action === 'cancel' ? 'danger' : active === action ? 'primary' : 'secondary'}
            onClick={() => onPick(action)}
          >
            {label}
          </Button>
        ))}
    </span>
  );
}
