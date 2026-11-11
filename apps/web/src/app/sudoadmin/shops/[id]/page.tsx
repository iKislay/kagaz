'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Pill, SegmentedControl } from '@/components/ui';
import { humanize, shopStatusTone } from '../../../admin/_lib/format';
import { ErrorNote, Loading, PageHeader, useLoad } from '../../../admin/_components/kit';
import { sudoApi } from '../../_lib/api';
import { LIFECYCLE_LABEL, lifecycleTone, subscriptionBadge } from '../../_lib/format';
import { BillingSection } from './billing';
import { OverviewSection } from './overview';
import { TeamSection } from './team';

type Tab = 'overview' | 'team' | 'billing';

/** One tenant: details + lifecycle, team accounts, subscription and payments. */
export default function SudoShopPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('overview');
  const { data: shop, error, loading, reload, setData } = useLoad(() => sudoApi.shop(id), [id]);

  const badge = subscriptionBadge(shop?.subscription ?? null);

  return (
    <>
      <Link
        href="/sudoadmin/shops"
        className="mb-2 inline-block text-[13px] text-accent hover:underline"
      >
        ‹ Shops
      </Link>
      {loading && !shop ? (
        <Loading />
      ) : (
        <>
          <ErrorNote error={error} />
          {shop && (
            <>
              <PageHeader
                title={shop.name}
                subtitle={
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <Pill tone={lifecycleTone(shop.lifecycle)}>
                      {LIFECYCLE_LABEL[shop.lifecycle]}
                    </Pill>
                    <Pill tone={shopStatusTone(shop.status)}>{humanize(shop.status)}</Pill>
                    <Pill tone={badge.tone}>{badge.label}</Pill>
                    {shop.isDemo && <Pill tone="orange">Demo shop</Pill>}
                    <span className="font-mono">{shop.slug}</span>
                  </span>
                }
              />
              <div className="mb-5">
                <SegmentedControl
                  label="Shop section"
                  value={tab}
                  onChange={setTab}
                  options={[
                    { value: 'overview', label: 'Overview' },
                    { value: 'team', label: `Team ${shop.memberCount}` },
                    { value: 'billing', label: 'Subscription' },
                  ]}
                />
              </div>
              {tab === 'overview' && (
                <OverviewSection
                  shop={shop}
                  onChanged={setData}
                  reload={reload}
                  onDeleted={() => router.replace('/sudoadmin/shops')}
                />
              )}
              {tab === 'team' && <TeamSection shop={shop} reload={reload} />}
              {tab === 'billing' && <BillingSection shop={shop} reload={reload} />}
            </>
          )}
        </>
      )}
    </>
  );
}
