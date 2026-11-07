'use client';

import { useEffect, useMemo, useState } from 'react';
import { adminApi } from '../_lib/api';
import {
  Button,
  Card,
  Empty,
  ErrorNote,
  Input,
  Loading,
  PageHeader,
  Select,
  useLoad,
} from '../_components/kit';
import { AuditRows } from './AuditRows';

const ACTOR_TYPES = ['', 'STAFF', 'ADMIN', 'DEVICE', 'CUSTOMER', 'SYSTEM'] as const;

/** Audit log viewer with filters (P2.13, FR-ADMIN-08). */
export default function AuditPage() {
  const [action, setAction] = useState('');
  const [actionQ, setActionQ] = useState('');
  const [shopId, setShopId] = useState('');
  const [actorType, setActorType] = useState<(typeof ACTOR_TYPES)[number]>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const t = setTimeout(() => {
      setActionQ(action.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [action]);

  const shops = useLoad(() => adminApi.shops(), []);
  const shopNames = useMemo(
    () => new Map((shops.data?.shops ?? []).map((s) => [s.id, s.name])),
    [shops.data],
  );
  const { data, error, loading } = useLoad(
    () =>
      adminApi.audit({
        action: actionQ || undefined,
        shopId: shopId || undefined,
        actorType: actorType || undefined,
        from: from || undefined,
        to: to || undefined,
        page,
      }),
    [actionQ, shopId, actorType, from, to, page],
  );
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const resetPage =
    <T,>(set: (v: T) => void) =>
    (v: T) => {
      set(v);
      setPage(1);
    };

  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle="Every human action, setting change and device event."
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Input
          label="Action contains"
          value={action}
          onChange={setAction}
          placeholder="e.g. order.accepted"
        />
        <Select
          label="Shop"
          value={shopId}
          onChange={resetPage(setShopId)}
          options={[
            { value: '', label: 'All shops' },
            ...[...shopNames].map(([value, label]) => ({ value, label })),
          ]}
        />
        <Select
          label="Actor"
          value={actorType}
          onChange={resetPage(setActorType)}
          options={ACTOR_TYPES.map((t) => ({
            value: t,
            label: t ? t.charAt(0) + t.slice(1).toLowerCase() : 'Anyone',
          }))}
        />
        <Input label="From" type="date" value={from} onChange={resetPage(setFrom)} />
        <Input label="To" type="date" value={to} onChange={resetPage(setTo)} />
      </div>
      <ErrorNote error={error} />
      <Card flush>
        {loading && !data ? (
          <Loading />
        ) : !data || data.items.length === 0 ? (
          <Empty>No entries match.</Empty>
        ) : (
          <AuditRows items={data.items} shopNames={shopNames} />
        )}
      </Card>
      {data && data.total > data.pageSize && (
        <div className="mt-3 flex items-center justify-end gap-2 text-[13px]">
          <span className="text-text-secondary">
            Page {page} of {pages} · {data.total} entries
          </span>
          <Button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <Button disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      )}
    </>
  );
}
