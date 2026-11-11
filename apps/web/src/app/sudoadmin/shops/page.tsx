'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { type ShopLifecycle } from '@kagaz/shared';
import { Chevron, Dot, Pill, SegmentedControl } from '@/components/ui';
import { rupees } from '../../admin/_lib/format';
import {
  Card,
  Empty,
  ErrorNote,
  Input,
  Loading,
  PageHeader,
  Table,
  Td,
  useLoad,
} from '../../admin/_components/kit';
import { sudoApi } from '../_lib/api';
import {
  LIFECYCLE_LABEL,
  coverageText,
  lifecycleTone,
  price,
  subscriptionBadge,
} from '../_lib/format';
import { sudoIcons } from '../_components/icons';
import { LinkButton } from '../_components/parts';

type Filter = 'ALL' | ShopLifecycle;

/** Every tenant: lifecycle, owner, subscription, devices and 30-day activity. */
export default function SudoShopsPage() {
  const { data, error, loading } = useLoad(() => sudoApi.shops(), []);
  const [filter, setFilter] = useState<Filter>('LIVE');
  const [q, setQ] = useState('');

  const shops = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (data?.shops ?? []).filter(
      (s) =>
        (filter === 'ALL' || s.lifecycle === filter) &&
        (!needle ||
          [s.name, s.slug, s.address, ...s.owners.map((o) => `${o.name} ${o.login}`)]
            .join(' ')
            .toLowerCase()
            .includes(needle)),
    );
  }, [data, filter, q]);
  const count = (l: ShopLifecycle) => data?.shops.filter((s) => s.lifecycle === l).length ?? 0;

  return (
    <>
      <PageHeader
        title="Shops"
        subtitle="Onboard shops, manage their accounts and subscriptions."
        actions={
          <LinkButton href="/sudoadmin/shops/new">
            {sudoIcons.plus}
            New shop
          </LinkButton>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <SegmentedControl
          label="Filter shops"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'LIVE', label: `Live ${count('LIVE')}` },
            { value: 'SUSPENDED', label: `Suspended ${count('SUSPENDED')}` },
            { value: 'ARCHIVED', label: `Archived ${count('ARCHIVED')}` },
            { value: 'ALL', label: 'All' },
          ]}
        />
        <Input
          label="Search"
          hideLabel
          placeholder="Search name, slug, owner…"
          value={q}
          onChange={setQ}
          className="w-64"
        />
      </div>
      <ErrorNote error={error} />
      {loading && !data ? (
        <Loading />
      ) : (
        data && (
          <Card flush>
            {shops.length === 0 ? (
              <Empty>
                {data.shops.length === 0 ? 'No shops yet. Onboard the first one.' : 'No matches.'}
              </Empty>
            ) : (
              <Table head={['Shop', 'Owner', 'Subscription', 'Shop PC', '30 days', '']}>
                {shops.map((s) => {
                  const badge = subscriptionBadge(s.subscription);
                  return (
                    <tr key={s.id} className="hover:bg-selection/40">
                      <Td className="min-w-56">
                        <Link
                          href={`/sudoadmin/shops/${s.id}`}
                          className="font-medium hover:text-accent"
                        >
                          {s.name}
                        </Link>
                        <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-text-secondary">
                          <span className="font-mono">{s.slug}</span>
                          {s.lifecycle !== 'LIVE' && (
                            <Pill tone={lifecycleTone(s.lifecycle)}>
                              {LIFECYCLE_LABEL[s.lifecycle]}
                            </Pill>
                          )}
                          {s.isDemo && <Pill tone="orange">Demo</Pill>}
                        </div>
                      </Td>
                      <Td>
                        {s.owners.length === 0 ? (
                          <span className="text-text-secondary">No owner</span>
                        ) : (
                          s.owners.map((o, i) => (
                            <div key={i} className="whitespace-nowrap">
                              {o.name ?? o.login}
                              {o.name && (
                                <div className="text-[12px] text-text-secondary">{o.login}</div>
                              )}
                            </div>
                          ))
                        )}
                      </Td>
                      <Td>
                        <Pill tone={badge.tone}>{badge.label}</Pill>
                        {s.subscription && (
                          <div className="mt-0.5 text-[12px] whitespace-nowrap text-text-secondary">
                            {s.subscription.plan.name} ·{' '}
                            {price(s.subscription.pricePaise, s.subscription.interval)}
                            <br />
                            {coverageText(s.subscription)}
                          </div>
                        )}
                      </Td>
                      <Td>
                        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                          <Dot
                            tone={
                              s.devicesOnline > 0 ? 'green' : s.devicesTotal ? 'red' : 'neutral'
                            }
                          />
                          {s.devicesTotal === 0
                            ? 'Not paired'
                            : `${s.devicesOnline}/${s.devicesTotal} online`}
                        </span>
                        <div className="text-[12px] text-text-secondary">
                          {s.printers} printer{s.printers === 1 ? '' : 's'}
                        </div>
                      </Td>
                      <Td className="tabular-nums">
                        {s.orders30d} orders
                        <div className="text-[12px] text-text-secondary">
                          {rupees(s.gmv30dPaise)}
                        </div>
                      </Td>
                      <Td>
                        <Link href={`/sudoadmin/shops/${s.id}`} aria-label={`Open ${s.name}`}>
                          <Chevron />
                        </Link>
                      </Td>
                    </tr>
                  );
                })}
              </Table>
            )}
          </Card>
        )
      )}
    </>
  );
}
