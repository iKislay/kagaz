'use client';

import Link from 'next/link';
import { useState } from 'react';
import { type SudoShopDetail } from '@kagaz/shared';
import { Notice } from '@/components/ui';
import { adminApi } from '../../../admin/_lib/api';
import { fmtDateTime, rupees } from '../../../admin/_lib/format';
import {
  Button,
  Card,
  ErrorNote,
  Facts,
  Input,
  Toggle,
  useAction,
} from '../../../admin/_components/kit';
import { sudoApi } from '../../_lib/api';
import { coverageText, price } from '../../_lib/format';
import { Hint, Sheet, SheetForm, TextArea } from '../../_components/parts';

type Dialog = 'edit' | 'suspend' | 'archive' | 'delete' | null;

export function OverviewSection({
  shop,
  onChanged,
  reload,
  onDeleted,
}: {
  shop: SudoShopDetail;
  onChanged: (s: SudoShopDetail) => void;
  reload: () => Promise<void>;
  onDeleted: () => void;
}) {
  const [dialog, setDialog] = useState<Dialog>(null);
  const quick = useAction();
  const close = () => setDialog(null);

  return (
    <div className="flex flex-col gap-5">
      {shop.lifecycle === 'SUSPENDED' && (
        <Notice tone="orange">
          Suspended {fmtDateTime(shop.suspendedAt)} — {shop.suspendedReason}. Customers can’t see
          the shop or place new orders; paid orders still print and can be collected.
        </Notice>
      )}
      {shop.lifecycle === 'ARCHIVED' && (
        <Notice tone="accent">
          Archived {fmtDateTime(shop.archivedAt)} — {shop.suspendedReason}. Devices were revoked and
          the team can’t sign in. Restoring brings it back as suspended; the shop PC must be paired
          again.
        </Notice>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card
          title="Details"
          actions={
            shop.lifecycle !== 'ARCHIVED' && <Button onClick={() => setDialog('edit')}>Edit</Button>
          }
        >
          <Facts
            items={[
              ['Name', shop.name],
              ['Slug', <span className="font-mono">{shop.slug}</span>],
              ['Address', shop.address],
              ['Shop phone', shop.contactPhone ?? '—'],
              ['Owner', shop.owners.map((o) => o.name ?? o.login).join(', ') || 'None'],
              ['Created', fmtDateTime(shop.createdAt)],
            ]}
          />
        </Card>
        <Card title="Activity">
          <Facts
            items={[
              [
                'Subscription',
                shop.subscription
                  ? `${shop.subscription.plan.name} · ${price(shop.subscription.pricePaise, shop.subscription.interval)} · ${coverageText(shop.subscription)}`
                  : 'None',
              ],
              ['Shop PCs', `${shop.devicesOnline} online of ${shop.devicesTotal}`],
              ['Printers', shop.printers],
              ['Paid orders · 30 d', `${shop.orders30d} (${rupees(shop.gmv30dPaise)})`],
              ['Orders, all time', shop.ordersTotal],
            ]}
          />
          <div className="mt-4">
            <Link href={`/admin/shops/${shop.id}`} className="text-[13px] text-accent">
              Pricing, hours, printers & devices in the operations dashboard ›
            </Link>
          </div>
        </Card>
      </div>

      <Card title="Lifecycle">
        <div className="flex flex-col gap-3">
          <Quick
            title={shop.lifecycle === 'SUSPENDED' ? 'Reactivate shop' : 'Suspend shop'}
            hint={
              shop.lifecycle === 'SUSPENDED'
                ? 'Customers see the shop again and can place orders (if it is open).'
                : 'Hide from customers and stop new orders, e.g. for unpaid subscription. Paid orders still print.'
            }
          >
            {shop.lifecycle === 'LIVE' && (
              <Button onClick={() => setDialog('suspend')}>Suspend…</Button>
            )}
            {shop.lifecycle === 'SUSPENDED' && (
              <Button
                variant="primary"
                busy={quick.busy}
                onClick={() =>
                  void quick.run(async () => onChanged(await sudoApi.reactivate(shop.id)))
                }
              >
                Reactivate
              </Button>
            )}
          </Quick>
          <Quick
            title={shop.lifecycle === 'ARCHIVED' ? 'Restore shop' : 'Archive shop'}
            hint={
              shop.lifecycle === 'ARCHIVED'
                ? 'Brings the shop back as suspended. Order history was kept.'
                : 'Offboard: revokes shop PCs, cancels the subscription and ends team access. Keeps all history.'
            }
          >
            {shop.lifecycle === 'ARCHIVED' ? (
              <Button
                busy={quick.busy}
                onClick={() =>
                  void quick.run(async () => onChanged(await sudoApi.restore(shop.id)))
                }
              >
                Restore
              </Button>
            ) : (
              <Button variant="danger" onClick={() => setDialog('archive')}>
                Archive…
              </Button>
            )}
          </Quick>
          <Quick
            title="Delete shop"
            hint={
              shop.canDelete
                ? 'Permanently removes a shop that never had an order (e.g. created by mistake).'
                : `Has ${shop.ordersTotal} order(s), so it can’t be deleted — archive it instead.`
            }
          >
            <Button variant="danger" disabled={!shop.canDelete} onClick={() => setDialog('delete')}>
              Delete…
            </Button>
          </Quick>
          <ErrorNote error={quick.error} />
        </div>
      </Card>

      {dialog === 'edit' && <EditSheet shop={shop} onClose={close} reload={reload} />}
      {dialog === 'suspend' && (
        <ReasonSheet
          title="Suspend shop"
          subtitle="The shop disappears for customers and new orders are refused."
          submitLabel="Suspend"
          onClose={close}
          action={async (reason) => onChanged(await sudoApi.suspend(shop.id, reason))}
        />
      )}
      {dialog === 'archive' && (
        <ReasonSheet
          title="Archive shop"
          subtitle="Shop PCs are revoked, the subscription is cancelled and the team loses access. Not possible while paid orders are still in progress."
          submitLabel="Archive"
          danger
          onClose={close}
          action={async (reason) => onChanged(await sudoApi.archive(shop.id, reason))}
        />
      )}
      {dialog === 'delete' && <DeleteSheet shop={shop} onClose={close} onDeleted={onDeleted} />}
    </div>
  );
}

function Quick({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-separator pb-3 last:border-b-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-medium">{title}</div>
        <Hint>{hint}</Hint>
      </div>
      {children}
    </div>
  );
}

function EditSheet({
  shop,
  onClose,
  reload,
}: {
  shop: SudoShopDetail;
  onClose: () => void;
  reload: () => Promise<void>;
}) {
  const { busy, error, run } = useAction();
  const [name, setName] = useState(shop.name);
  const [address, setAddress] = useState(shop.address);
  const [phone, setPhone] = useState(shop.contactPhone ?? '');
  const [isDemo, setIsDemo] = useState(shop.isDemo);
  return (
    <Sheet title="Edit shop details" onClose={onClose}>
      <SheetForm
        submitLabel="Save"
        busy={busy}
        error={error}
        onCancel={onClose}
        onSubmit={async () => {
          const ok = await run(() =>
            adminApi.updateShop(shop.id, {
              name: name.trim(),
              address: address.trim(),
              contactPhone: phone.trim() || null,
              isDemo,
            }),
          );
          if (ok) {
            await reload();
            onClose();
          }
        }}
      >
        <Input label="Shop name" value={name} onChange={setName} />
        <Input label="Address" value={address} onChange={setAddress} />
        <Input label="Shop phone" value={phone} onChange={setPhone} placeholder="+919876543210" />
        <div className="flex items-center justify-between">
          <span className="text-[13px]">Demo shop</span>
          <Toggle checked={isDemo} onChange={setIsDemo} label="Demo shop" />
        </div>
        <Hint>The slug can’t be changed: shop scripts and links use it.</Hint>
      </SheetForm>
    </Sheet>
  );
}

function ReasonSheet({
  title,
  subtitle,
  submitLabel,
  danger,
  onClose,
  action,
}: {
  title: string;
  subtitle: string;
  submitLabel: string;
  danger?: boolean;
  onClose: () => void;
  action: (reason: string) => Promise<void>;
}) {
  const { busy, error, run } = useAction();
  const [reason, setReason] = useState('');
  return (
    <Sheet title={title} subtitle={subtitle} onClose={onClose}>
      <SheetForm
        submitLabel={submitLabel}
        danger={danger}
        busy={busy}
        error={error}
        disabled={reason.trim().length < 3}
        onCancel={onClose}
        onSubmit={async () => {
          const done = await run(async () => {
            await action(reason.trim());
            return true;
          });
          if (done) onClose();
        }}
      >
        <TextArea
          label="Reason (kept in the audit log)"
          value={reason}
          onChange={setReason}
          placeholder="e.g. Subscription unpaid since October"
        />
      </SheetForm>
    </Sheet>
  );
}

function DeleteSheet({
  shop,
  onClose,
  onDeleted,
}: {
  shop: SudoShopDetail;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { busy, error, run } = useAction();
  const [confirm, setConfirm] = useState('');
  return (
    <Sheet
      title={`Delete ${shop.name}?`}
      subtitle="This permanently removes the shop, its team memberships, devices, printers, pricing and subscriptions. It can’t be undone."
      onClose={onClose}
    >
      <SheetForm
        submitLabel="Delete shop"
        danger
        busy={busy}
        error={error}
        disabled={confirm !== shop.slug}
        onCancel={onClose}
        onSubmit={async () => {
          const ok = await run(() => sudoApi.deleteShop(shop.id, confirm));
          if (ok) onDeleted();
        }}
      >
        <Input
          label={`Type ${shop.slug} to confirm`}
          value={confirm}
          onChange={setConfirm}
          autoComplete="off"
        />
      </SheetForm>
    </Sheet>
  );
}
