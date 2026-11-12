'use client';

import Link from 'next/link';
import { useState } from 'react';
import { type MismatchType } from '@kagaz/shared';
import { Notice, Pill } from '@/components/ui';
import { adminApi } from '../_lib/api';
import { fmtDateTime, fmtDay, humanize, rupees } from '../_lib/format';
import {
  Card,
  Empty,
  ErrorNote,
  Input,
  Loading,
  PageHeader,
  Select,
  StatTile,
  Table,
  Td,
  useLoad,
} from '../_components/kit';

const MISMATCH_LABEL: Record<MismatchType, string> = {
  PAID_NO_PROGRESS: 'Paid, no progress',
  REJECTED_WITHOUT_REFUND: 'Rejected without refund',
  REFUND_WITHOUT_REJECTION: 'Refund without rejection',
  REFUND_STATUS_MISMATCH: 'Refund status mismatch',
  WEBHOOK_UNPROCESSED: 'Webhook unprocessed',
};

/** Payments vs. orders vs. refunds (P3.7, FR-ADMIN-10). */
export default function ReconciliationPage() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [shopId, setShopId] = useState('');
  const [stuck, setStuck] = useState('2');
  const shops = useLoad(() => adminApi.shops(), []);
  const { data, error, loading } = useLoad(
    () =>
      adminApi.reconciliation({
        from: from || undefined,
        to: to || undefined,
        shopId: shopId || undefined,
        stuckHours: Number(stuck),
      }),
    [from, to, shopId, stuck],
  );

  return (
    <>
      <PageHeader
        title="Reconciliation"
        subtitle={data ? `${fmtDay(data.from)} – ${fmtDay(data.to)} · Asia/Kolkata days` : ' '}
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Input label="From" type="date" value={from} onChange={setFrom} />
        <Input label="To" type="date" value={to} onChange={setTo} />
        <Select
          label="Shop"
          value={shopId}
          onChange={setShopId}
          options={[
            { value: '', label: 'All shops' },
            ...(shops.data?.shops ?? []).map((s) => ({ value: s.id, label: s.name })),
          ]}
        />
        <Select
          label="Flag paid orders stuck for"
          value={stuck}
          onChange={setStuck}
          options={['1', '2', '4', '8', '24'].map((h) => ({ value: h, label: `${h} h` }))}
        />
      </div>
      <ErrorNote error={error} />
      {loading && !data ? (
        <Loading />
      ) : (
        data && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatTile label="Paid" value={rupees(data.totals.paidPaise)} />
              <StatTile label="Refunded" value={rupees(data.totals.refundedPaise)} />
              <StatTile label="Net" value={rupees(data.totals.netPaise)} />
              <StatTile
                label="Mismatches"
                value={
                  <span className={data.totals.mismatches ? 'text-red' : 'text-green'}>
                    {data.totals.mismatches}
                  </span>
                }
              />
            </div>

            <Card title="Mismatches" flush>
              {data.mismatches.length === 0 ? (
                <div className="px-4 py-3">
                  <Notice tone="green">No mismatches — payments, orders and refunds agree.</Notice>
                </div>
              ) : (
                <Table head={['Flag', 'Order', 'Shop', 'Detail', 'Since']}>
                  {data.mismatches.map((m, i) => (
                    <tr key={`${m.type}-${m.orderId ?? i}`}>
                      <Td>
                        <Pill tone={m.type === 'PAID_NO_PROGRESS' ? 'orange' : 'red'}>
                          {MISMATCH_LABEL[m.type]}
                        </Pill>
                      </Td>
                      <Td mono>
                        {m.orderId ? (
                          <Link
                            href={`/superadmin/orders/${m.orderId}`}
                            className="text-accent hover:underline"
                          >
                            {m.publicRef}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </Td>
                      <Td>{m.shopName ?? '—'}</Td>
                      <Td className="text-text-secondary">{m.detail}</Td>
                      <Td className="whitespace-nowrap text-text-secondary">{fmtDateTime(m.at)}</Td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>

            <Card title="By day and shop" flush>
              {data.rows.length === 0 ? (
                <Empty>No activity in this range.</Empty>
              ) : (
                <Table head={['Day', 'Shop', 'Paid', 'Refunded', 'Orders by current state']}>
                  {data.rows.map((r) => (
                    <tr key={`${r.date}-${r.shopId}`} className="align-top">
                      <Td className="whitespace-nowrap">{fmtDay(r.date)}</Td>
                      <Td>{r.shopName}</Td>
                      <Td className="tabular-nums">
                        {rupees(r.paidPaise)}
                        <div className="text-[12px] text-text-secondary">
                          {r.paidCount} payment{r.paidCount === 1 ? '' : 's'}
                          {r.simulatedPaidPaise > 0 && ' · demo'}
                        </div>
                      </Td>
                      <Td className="tabular-nums">
                        {rupees(r.refundedPaise)}
                        <div className="text-[12px] text-text-secondary">
                          {r.refundCount} refunds
                        </div>
                      </Td>
                      <Td>
                        <div className="flex flex-wrap gap-1.5">
                          {Object.entries(r.ordersByStatus).map(([s, n]) => (
                            <span
                              key={s}
                              className="rounded-full bg-selection px-2 py-0.5 text-[12px]"
                            >
                              {humanize(s)} {n}
                            </span>
                          ))}
                        </div>
                      </Td>
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
