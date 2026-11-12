'use client';

import { useEffect } from 'react';
import { Dot, Notice, Pill } from '@/components/ui';
import { adminApi } from '../_lib/api';
import {
  fmtAgo,
  fmtDuration,
  healthTone,
  humanize,
  printerTone,
  shopStatusTone,
} from '../_lib/format';
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

/** Device + printer health (P4.4). Polls every 15 s (REST is the source of truth). */
export default function HealthPage() {
  const { data, error, loading, reload } = useLoad(() => adminApi.health(), []);
  useEffect(() => {
    const t = setInterval(() => void reload(), 15_000);
    return () => clearInterval(t);
  }, [reload]);

  const drift = data?.shops.flatMap((s) => s.devices.filter((d) => d.versionDrift)) ?? [];

  return (
    <>
      <PageHeader
        title="Health"
        subtitle={
          data
            ? `Online ≤ ${data.onlineThresholdSeconds} s · stale ≤ ${Math.round(data.staleThresholdSeconds / 60)} min · refreshed ${fmtAgo(data.generatedAt)}`
            : ' '
        }
      />
      <ErrorNote error={error} />
      {drift.length > 0 && data?.minAgentVersion && (
        <Notice tone="orange">
          {drift.length} shop PC{drift.length === 1 ? '' : 's'} below the minimum app version{' '}
          {data.minAgentVersion}: {drift.map((d) => d.name).join(', ')}.
        </Notice>
      )}
      {loading && !data ? (
        <Loading />
      ) : (
        <div className="mt-4 space-y-5">
          {data?.shops.map((shop) => (
            <Card
              key={shop.shopId}
              title={
                <span className="inline-flex items-center gap-2">
                  <Dot tone={shop.online ? 'green' : 'red'} />
                  {shop.shopName}
                </span>
              }
              actions={
                <span className="inline-flex items-center gap-2 text-[12px] text-text-secondary">
                  <Pill tone={shopStatusTone(shop.status)}>{humanize(shop.status)}</Pill>
                  {shop.approvalMode === 'AUTO'
                    ? shop.autoPaused
                      ? 'Auto · paused'
                      : 'Auto'
                    : 'Manual'}
                </span>
              }
              flush
            >
              {shop.devices.length === 0 ? (
                <Empty>No paired shop PC.</Empty>
              ) : (
                <Table
                  head={[
                    'Shop PC',
                    'State',
                    'Last heartbeat',
                    'App',
                    'OS',
                    'Uptime',
                    'Local queue',
                  ]}
                >
                  {shop.devices.map((d) => (
                    <tr key={d.id}>
                      <Td className="font-medium">{d.name}</Td>
                      <Td>
                        <Pill tone={healthTone(d.health)}>{humanize(d.health)}</Pill>
                      </Td>
                      <Td>{fmtAgo(d.lastHeartbeatAt)}</Td>
                      <Td mono>
                        {d.appVersion ?? '—'}
                        {d.versionDrift && (
                          <span className="ml-1.5">
                            <Pill tone="orange">Update</Pill>
                          </span>
                        )}
                      </Td>
                      <Td className="text-text-secondary">{d.os ?? '—'}</Td>
                      <Td>{fmtDuration(d.uptimeSeconds)}</Td>
                      <Td className="tabular-nums">{d.queueDepth ?? '—'}</Td>
                    </tr>
                  ))}
                </Table>
              )}
              {shop.printers.length > 0 && (
                <div className="border-t border-separator">
                  <Table head={['Printer', 'Status', 'Last report', 'Queue', '']}>
                    {shop.printers.map((p) => (
                      <tr key={p.id} className={p.enabled ? '' : 'opacity-60'}>
                        <Td>
                          <div className="font-medium">{p.displayName}</div>
                          <div className="text-[12px] text-text-secondary">{p.printerName}</div>
                        </Td>
                        <Td>
                          <span className="inline-flex items-center gap-1.5">
                            <Dot tone={printerTone(p.status)} />
                            {humanize(p.status)}
                          </span>
                          {p.lastError && <div className="text-[12px] text-red">{p.lastError}</div>}
                        </Td>
                        <Td>{fmtAgo(p.lastStatusAt)}</Td>
                        <Td className="tabular-nums">{p.queueDepth}</Td>
                        <Td className="text-[12px] text-text-secondary">
                          {[p.isDefault && 'Default', !p.enabled && 'Disabled']
                            .filter(Boolean)
                            .join(' · ')}
                        </Td>
                      </tr>
                    ))}
                  </Table>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
