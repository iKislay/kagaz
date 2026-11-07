'use client';

import Link from 'next/link';
import { useState } from 'react';
import { type AdminAuditEntry } from '@kagaz/shared';
import { fmtDateTime, humanize } from '../_lib/format';
import { Table, Td } from '../_components/kit';

/** Audit entries table; metadata expands inline. */
export function AuditRows({
  items,
  hideOrder,
  shopNames,
}: {
  items: AdminAuditEntry[];
  hideOrder?: boolean;
  shopNames?: Map<string, string>;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const head = [
    'When',
    'Action',
    'Actor',
    ...(shopNames ? ['Shop'] : []),
    ...(hideOrder ? [] : ['Order']),
    'Details',
  ];
  return (
    <Table head={head}>
      {items.map((a) => (
        <tr key={a.id} className="align-top">
          <Td className="whitespace-nowrap text-text-secondary">{fmtDateTime(a.createdAt)}</Td>
          <Td mono>{a.action}</Td>
          <Td>
            <div>{a.actorName ?? (a.actorId ? `${a.actorId.slice(0, 8)}…` : '—')}</div>
            <div className="text-[11px] text-text-secondary">{humanize(a.actorType)}</div>
          </Td>
          {shopNames && <Td>{a.shopId ? (shopNames.get(a.shopId) ?? '—') : '—'}</Td>}
          {!hideOrder && (
            <Td>
              {a.orderId ? (
                <Link href={`/admin/orders/${a.orderId}`} className="text-accent hover:underline">
                  Open
                </Link>
              ) : (
                '—'
              )}
            </Td>
          )}
          <Td>
            {a.metadata ? (
              <button
                type="button"
                className="text-[12px] text-accent hover:underline"
                onClick={() => setOpen(open === a.id ? null : a.id)}
                aria-expanded={open === a.id}
              >
                {open === a.id ? 'Hide' : 'Show'}
              </button>
            ) : (
              '—'
            )}
            {open === a.id && (
              <pre className="mt-1.5 max-w-md overflow-x-auto rounded-lg bg-selection p-2 font-mono text-[11px] whitespace-pre-wrap">
                {JSON.stringify(a.metadata, null, 2)}
              </pre>
            )}
          </Td>
        </tr>
      ))}
    </Table>
  );
}
