'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { normalizePhone } from '@kagaz/shared';
import { adminApi } from '../_lib/api';
import { Button, Card, ErrorNote, Input, useAction } from '../_components/kit';

/** "Raju Xerox & Prints" → "raju-xerox-prints-k3f9" (unique enough; the API rejects clashes). */
function slugFor(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${base || 'shop'}-${suffix}`;
}

/**
 * Kaggaz staff set up a shop for a shopkeeper: the shop (Closed until activated) and its owner
 * login (mobile + password). The owner then signs in to the Kaggaz Shop app with that number.
 */
export function AddShop({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const action = useAction();
  const [f, setF] = useState({ name: '', owner: '', phone: '', password: '' });
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  async function save() {
    const shop = await action.run(() =>
      adminApi.createShop({
        slug: slugFor(f.name),
        name: f.name.trim(),
        contactPhone: normalizePhone(f.phone),
      }),
    );
    if (!shop) return;
    const withOwner = await action.run(() =>
      adminApi.addMember(shop.id, {
        phone: f.phone,
        name: f.owner,
        role: 'SHOP_OWNER',
        password: f.password,
      }),
    );
    // The shop exists even if the owner login failed: open it so the login can be fixed there.
    router.push(`/superadmin/shops/${shop.id}${withOwner ? '' : '?tab=members'}`);
  }

  return (
    <Card
      title="Add shop"
      actions={
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      }
    >
      <ErrorNote error={action.error} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Shop name" value={f.name} onChange={set('name')} placeholder="Raju Xerox" />
        <Input label="Owner name" value={f.owner} onChange={set('owner')} placeholder="Raju" />
        <Input
          label="Owner mobile number"
          value={f.phone}
          onChange={set('phone')}
          placeholder="98765 43210"
          inputMode="numeric"
          autoComplete="off"
        />
        <Input
          label="Owner password (min 8 characters)"
          value={f.password}
          onChange={set('password')}
          type="password"
          autoComplete="new-password"
        />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="primary" busy={action.busy} onClick={() => void save()}>
          Create shop
        </Button>
        <span className="text-[12px] text-text-secondary">
          The shop starts Closed. The owner signs in to the Kaggaz Shop app with this mobile number
          and password, then sets the shop’s location and address there. Add a subscription and open
          the shop when they’ve paid.
        </span>
      </div>
    </Card>
  );
}
