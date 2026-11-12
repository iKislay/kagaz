'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { type AdminOrderDetail, DEMO_REFUND_NOTICE, formatPickupCode } from '@kagaz/shared';
import { Pill } from '@/components/ui';
import { adminApi } from '../../_lib/api';
import { fmtDateTime, humanize, orderTone, rupees } from '../../_lib/format';
import {
  Card,
  Empty,
  ErrorNote,
  Facts,
  Loading,
  PageHeader,
  Table,
  Td,
  useLoad,
} from '../../_components/kit';
import { AuditRows } from '../../audit/AuditRows';

/** Full order history (P2.13, FR-ADMIN-07): events, payments/refunds, print jobs, audit. */
export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, loading } = useLoad(() => adminApi.order(id), [id]);

  return (
    <>
      <Link
        href="/superadmin/orders"
        className="mb-2 inline-block text-[13px] text-accent hover:underline"
      >
        ‹ Orders
      </Link>
      <ErrorNote error={error} />
      {loading && !data ? <Loading /> : data && <Detail o={data} />}
    </>
  );
}

function actor(e: { actorType: string; actorName?: string | null; actorId: string | null }) {
  const who = e.actorName ?? (e.actorId ? `${e.actorId.slice(0, 8)}…` : null);
  return (
    <span>
      <span className="text-text-secondary">{humanize(e.actorType)}</span>
      {who && <span> · {who}</span>}
    </span>
  );
}

function Detail({ o }: { o: AdminOrderDetail }) {
  const opts = o.options;
  return (
    <>
      <PageHeader
        title={o.publicRef}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Pill tone={orderTone(o.events.at(-1)?.toStatus ?? 'DRAFT')}>
              {humanize(o.events.at(-1)?.toStatus ?? 'DRAFT')}
            </Pill>
            <Link href={`/superadmin/shops/${o.shop.id}`} className="hover:text-accent">
              {o.shop.name}
            </Link>
          </span>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[3fr_2fr]">
        <Card title="Event history">
          <ol className="relative ml-1.5 border-l border-separator">
            {o.events.map((e) => (
              <li key={e.id} className="mb-3 ml-4 last:mb-0">
                <span className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full border-2 border-surface bg-accent" />
                <div className="flex flex-wrap items-center gap-2 text-[13px]">
                  <Pill tone={orderTone(e.toStatus)}>{humanize(e.toStatus)}</Pill>
                  <span className="text-text-secondary">{fmtDateTime(e.createdAt)}</span>
                </div>
                <div className="mt-0.5 text-[12px]">
                  {actor(e)}
                  {e.reason && <span className="text-text-secondary"> — {e.reason}</span>}
                </div>
              </li>
            ))}
          </ol>
        </Card>

        <Card title="Order">
          <Facts
            items={[
              [
                'Pickup code',
                o.pickupNumber !== null && o.pickupDate
                  ? formatPickupCode(o.pickupNumber, o.pickupDate)
                  : '—',
              ],
              ['Amount', rupees(o.amountPaise)],
              [
                'Options',
                `${opts.copies} × ${opts.colour ? 'Colour' : 'B/W'}, ${opts.duplex ? 'double-sided' : 'single-sided'}, ${opts.paperSize}${opts.pageRange ? `, pages ${opts.pageRange}` : ''}`,
              ],
              ['Customer', o.customerPhoneMasked ?? '—'],
              ['Created', fmtDateTime(o.createdAt)],
              ['Updated', fmtDateTime(o.updatedAt)],
              [
                'Files',
                o.files.length === 0
                  ? '—'
                  : o.files.map((f) => (
                      <div key={f.id}>
                        {humanize(f.kind)} · {humanize(f.status)}
                        {f.pageCount !== null && ` · ${f.pageCount} pages`}
                      </div>
                    )),
              ],
            ]}
          />
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card title="Payments & refunds" flush>
          {o.payments.length === 0 ? (
            <Empty>No payment yet.</Empty>
          ) : (
            <Table head={['', 'Status', 'Amount', 'When']}>
              {o.payments.map((p) => (
                <tr key={p.id}>
                  <Td>
                    Payment · {p.provider}
                    {p.isSimulated && (
                      <span className="ml-1.5 text-[11px] text-notice-text">DEMO</span>
                    )}
                  </Td>
                  <Td>{humanize(p.status)}</Td>
                  <Td className="tabular-nums">{rupees(p.amountPaise)}</Td>
                  <Td className="text-text-secondary">
                    {fmtDateTime(p.verifiedAt ?? p.createdAt)}
                  </Td>
                </tr>
              ))}
              {o.refunds.map((r) => (
                <tr key={r.id}>
                  <Td>
                    Refund
                    {r.isSimulated && (
                      <div className="text-[11px] text-notice-text">{DEMO_REFUND_NOTICE}</div>
                    )}
                  </Td>
                  <Td>{humanize(r.status)}</Td>
                  <Td className="tabular-nums">{rupees(r.amountPaise)}</Td>
                  <Td className="text-text-secondary">
                    {fmtDateTime(r.completedAt ?? r.createdAt)}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card title="Print jobs" flush>
          {o.printJobs.length === 0 ? (
            <Empty>Not printed yet.</Empty>
          ) : (
            <Table head={['Attempt', 'Status', 'Printer', 'Spooler', 'Created']}>
              {o.printJobs.map((j) => (
                <tr key={j.id}>
                  <Td>#{j.attempt}</Td>
                  <Td>
                    {humanize(j.status)}
                    {j.error && <div className="text-[12px] text-red">{j.error}</div>}
                  </Td>
                  <Td>{j.printerName}</Td>
                  <Td mono>{j.spoolerJobId ?? '—'}</Td>
                  <Td className="text-text-secondary">{fmtDateTime(j.createdAt)}</Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>

      <Card title="Audit" flush className="mt-5">
        {o.audit.length === 0 ? (
          <Empty>No audit entries.</Empty>
        ) : (
          <AuditRows items={o.audit} hideOrder />
        )}
      </Card>
    </>
  );
}
