'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Pill, SegmentedControl } from '@/components/ui';
import { adminApi } from '../../_lib/api';
import { humanize, shopStatusTone } from '../../_lib/format';
import { ErrorNote, Loading, PageHeader, useLoad } from '../../_components/kit';
import { useAdminSession } from '../../_components/session';
import {
  DevicesSection,
  HoursSection,
  PricingSection,
  PrintersSection,
  SettingsSection,
} from './sections';

type Tab = 'settings' | 'hours' | 'pricing' | 'printers' | 'devices';

/** Shop management (P4.3): settings, hours, pricing, printers, devices + enrollment codes. */
export default function ShopDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { me } = useAdminSession();
  const admin = me.role === 'ADMIN';
  const [tab, setTab] = useState<Tab>('settings');
  const { data: shop, error, loading, setData } = useLoad(() => adminApi.shop(id), [id]);

  const tabs: { value: Tab; label: string }[] = [
    { value: 'settings', label: 'Settings' },
    { value: 'hours', label: 'Hours' },
    { value: 'pricing', label: 'Pricing' },
    ...(admin
      ? [
          { value: 'printers' as const, label: 'Printers' },
          { value: 'devices' as const, label: 'Devices' },
        ]
      : []),
  ];

  return (
    <>
      <Link
        href="/admin/shops"
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
                    <Pill tone={shopStatusTone(shop.status)}>{humanize(shop.status)}</Pill>
                    <span>{shop.address}</span>
                    {shop.isDemo && <Pill tone="orange">Demo shop</Pill>}
                  </span>
                }
              />
              <div className="mb-5">
                <SegmentedControl
                  label="Shop section"
                  value={tab}
                  onChange={setTab}
                  options={tabs}
                />
              </div>
              {tab === 'settings' && (
                <SettingsSection shop={shop} admin={admin} onSaved={setData} />
              )}
              {tab === 'hours' && <HoursSection shop={shop} onSaved={setData} />}
              {tab === 'pricing' && <PricingSection shopId={shop.id} />}
              {tab === 'printers' && admin && <PrintersSection shopId={shop.id} />}
              {tab === 'devices' && admin && <DevicesSection shopId={shop.id} />}
            </>
          )}
        </>
      )}
    </>
  );
}
