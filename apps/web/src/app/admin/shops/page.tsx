'use client';

import Link from 'next/link';
import { Chevron, Dot, Pill } from '@/components/ui';
import { adminApi } from '../_lib/api';
import { humanize, rupees, shopStatusTone } from '../_lib/format';
import {
  Card,
  Empty,
  ErrorNote,
  Loading,
  PageHeader,
  Table,
  Td,
  useLoad,
} from '../_components/kit';

const QUEUE_STATES = ['PENDING_REVIEW', 'QUEUED', 'PRINTING', 'NEEDS_OPERATOR_CHECK'];

/** Shop list (P2.13, FR-ADMIN-02): status, mode, device online, queue depth, today. */
export default function ShopsPage() {
  const { data, error, loading } = useLoad(() => adminApi.shops(), []);

  return (
    <>
      <PageHeader title="Shops" subtitle="Status, approval mode, devices and today’s orders." />
      <ErrorNote error={error} />
      {loading && !data ? (
        <Loading />
      ) : (
        data && (
          <Card flush>
            {data.shops.length === 0 ? (
              <Empty>No shops.</Empty>
            ) : (
              <Table head={['Shop', 'Status', 'Mode', 'Shop PC', 'Printers', 'Queue', 'Today', '']}>
                {data.shops.map((s) => {
                  const online = s.devices.some((d) => d.online);
                  const queue = QUEUE_STATES.reduce((n, st) => n + (s.orderCounts[st] ?? 0), 0);
                  const needsCheck = s.orderCounts.NEEDS_OPERATOR_CHECK ?? 0;
                  return (
                    <tr key={s.id} className="hover:bg-selection/40">
                      <Td className="min-w-56">
                        <Link
                          href={`/admin/shops/${s.id}`}
                          className="font-medium hover:text-accent"
                        >
                          {s.name}
                        </Link>
                        <div className="text-[12px] text-text-secondary">{s.address}</div>
                      </Td>
                      <Td>
                        <Pill tone={shopStatusTone(s.status)}>{humanize(s.status)}</Pill>
                      </Td>
                      <Td>
                        {s.approvalMode === 'AUTO'
                          ? s.autoPaused
                            ? 'Auto (paused)'
                            : 'Auto'
                          : 'Manual'}
                      </Td>
                      <Td>
                        <span className="inline-flex items-center gap-1.5">
                          <Dot tone={online ? 'green' : s.devices.length ? 'red' : 'neutral'} />
                          {s.devices.length === 0 ? 'Not paired' : online ? 'Online' : 'Offline'}
                        </span>
                      </Td>
                      <Td>
                        {s.printers.length === 0 ? (
                          <span className="text-text-secondary">None</span>
                        ) : (
                          s.printers.map((p) => (
                            <div key={p.id} className="flex items-center gap-1.5 whitespace-nowrap">
                              <Dot
                                tone={
                                  p.status === 'READY'
                                    ? 'green'
                                    : p.status === 'UNKNOWN'
                                      ? 'neutral'
                                      : 'orange'
                                }
                              />
                              {p.displayName}
                              {!p.enabled && <span className="text-text-secondary">(off)</span>}
                            </div>
                          ))
                        )}
                      </Td>
                      <Td className="tabular-nums">
                        {queue}
                        {needsCheck > 0 && (
                          <span className="ml-1.5">
                            <Pill tone="orange">{needsCheck} check</Pill>
                          </span>
                        )}
                      </Td>
                      <Td className="tabular-nums">
                        {s.todayOrders}
                        <div className="text-[12px] text-text-secondary">
                          {rupees(s.todayRevenuePaise)}
                          {s.todaySimulatedRevenuePaise > 0 && ' demo'}
                        </div>
                      </Td>
                      <Td>
                        <Link href={`/admin/shops/${s.id}`} aria-label={`Open ${s.name}`}>
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
