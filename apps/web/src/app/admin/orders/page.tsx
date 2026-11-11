'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { OrderStatus, formatPickupCode } from '@kagaz/shared';
import { Pill } from '@/components/ui';
import { adminApi } from '../_lib/api';
import { fmtDateTime, humanize, orderTone, rupees } from '../_lib/format';
import {
  Button,
  Card,
  Empty,
  ErrorNote,
  Input,
  Loading,
  PageHeader,
  Select,
  Table,
  Td,
  useLoad,
} from '../_components/kit';

/** Order search by public ref / shop / status (P2.13, FR-ADMIN-07). */
export default function OrdersPage() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [shopId, setShopId] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  // Debounce typing in the ref box.
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(q.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const shops = useLoad(() => adminApi.shops(), []);
  const { data, error, loading } = useLoad(
    () =>
      adminApi.orders({ q: query, shopId: shopId || undefined, status: status || undefined, page }),
    [query, shopId, status, page],
  );
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <PageHeader title="Orders" subtitle="Search by reference, e.g. KGZ-7H3K2Q." />
      <div className="mb-4 grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
        <Input
          label="Reference"
          hideLabel
          value={q}
          onChange={setQ}
          placeholder="Search reference…"
        />
        <Select
          label="Shop"
          hideLabel
          value={shopId}
          onChange={(v) => {
            setShopId(v);
            setPage(1);
          }}
          options={[
            { value: '', label: 'All shops' },
            ...(shops.data?.shops ?? []).map((s) => ({ value: s.id, label: s.name })),
          ]}
        />
        <Select
          label="Status"
          hideLabel
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(1);
          }}
          options={[
            { value: '', label: 'Any status' },
            ...Object.values(OrderStatus).map((s) => ({ value: s, label: humanize(s) })),
          ]}
        />
      </div>
      <ErrorNote error={error} />
      <Card flush>
        {loading && !data ? (
          <Loading />
        ) : !data || data.items.length === 0 ? (
          <Empty>No orders match.</Empty>
        ) : (
          <Table
            head={['Reference', 'Pickup code', 'Shop', 'Status', 'Payment', 'Amount', 'Created']}
          >
            {data.items.map((o) => (
              <tr key={o.id} className="hover:bg-selection/40">
                <Td mono>
                  <Link href={`/admin/orders/${o.id}`} className="text-accent hover:underline">
                    {o.publicRef}
                  </Link>
                </Td>
                <Td className="whitespace-nowrap font-semibold tabular-nums">
                  {o.pickupNumber !== null && o.pickupDate
                    ? formatPickupCode(o.pickupNumber, o.pickupDate)
                    : '—'}
                </Td>
                <Td>{o.shopName}</Td>
                <Td>
                  <Pill tone={orderTone(o.status)}>{humanize(o.status)}</Pill>
                </Td>
                <Td>
                  {o.paymentStatus ? humanize(o.paymentStatus) : '—'}
                  {o.simulatedPayment && (
                    <span className="ml-1.5 text-[11px] text-notice-text">DEMO</span>
                  )}
                </Td>
                <Td className="tabular-nums">{rupees(o.amountPaise)}</Td>
                <Td className="whitespace-nowrap text-text-secondary">
                  {fmtDateTime(o.createdAt)}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {data && data.total > data.pageSize && (
        <div className="mt-3 flex items-center justify-end gap-2 text-[13px]">
          <span className="text-text-secondary">
            Page {page} of {pages} · {data.total} orders
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
