'use client';

import Link from 'next/link';
import { useState } from 'react';
import { type SudoShopCreateRequest, type SudoShopCreated } from '@kagaz/shared';
import { Notice } from '@/components/ui';
import {
  Button,
  Card,
  ErrorNote,
  Input,
  PageHeader,
  Select,
  Toggle,
  useAction,
  useLoad,
} from '../../../admin/_components/kit';
import { sudoApi } from '../../_lib/api';
import { paiseToInput, parseRupees, price, slugify } from '../../_lib/format';
import { Hint, LinkButton, OneTimePassword } from '../../_components/parts';

/** One-step onboarding: shop, owner account and (optionally) the first subscription. */
export default function NewShopPage() {
  const plans = useLoad(() => sudoApi.plans(), []);
  const { busy, error, run, setError } = useAction();
  const [done, setDone] = useState<SudoShopCreated | null>(null);

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const [address, setAddress] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [isDemo, setIsDemo] = useState(false);

  const [withOwner, setWithOwner] = useState(true);
  const [ownerName, setOwnerName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerPhone, setOwnerPhone] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');

  const [planId, setPlanId] = useState('');
  const [priceText, setPriceText] = useState('');
  const [trialText, setTrialText] = useState('');

  const activePlans = (plans.data?.plans ?? []).filter((p) => p.active);
  const plan = activePlans.find((p) => p.id === planId);

  const pickPlan = (id: string) => {
    setPlanId(id);
    const p = activePlans.find((x) => x.id === id);
    setPriceText(p ? paiseToInput(p.pricePaise) : '');
    setTrialText(p ? String(p.trialDays) : '');
  };

  async function submit() {
    const body: SudoShopCreateRequest = {
      slug: slug.trim(),
      name: name.trim(),
      address: address.trim(),
      ...(contactPhone.trim() ? { contactPhone: contactPhone.trim() } : {}),
      isDemo,
    };
    if (withOwner) {
      body.owner = {
        name: ownerName.trim(),
        ...(ownerEmail.trim() ? { email: ownerEmail.trim() } : {}),
        ...(ownerPhone.trim() ? { phone: ownerPhone.trim() } : {}),
        ...(ownerPassword ? { password: ownerPassword } : {}),
      };
    }
    if (plan) {
      const pricePaise = parseRupees(priceText);
      const trialDays = Number(trialText || '0');
      if (pricePaise === null || !Number.isInteger(trialDays) || trialDays < 0) {
        setError(new Error('Check the price (₹, up to 2 decimals) and trial days.'));
        return;
      }
      body.subscription = { planId: plan.id, pricePaise, trialDays };
    }
    const created = await run(() => sudoApi.onboard(body));
    if (created) setDone(created);
  }

  if (done) {
    const owner = done.shop.owners[0];
    return (
      <>
        <PageHeader title="Shop created" subtitle={done.shop.name} />
        <Card>
          <div className="flex flex-col gap-3 text-[14px]">
            <p>
              <strong>{done.shop.name}</strong> is set up and <strong>closed</strong> until it has a
              paired shop PC, a printer and pricing.
            </p>
            {owner && done.ownerTemporaryPassword && (
              <OneTimePassword login={owner.login} password={done.ownerTemporaryPassword} />
            )}
            {owner && done.ownerExistingUser && (
              <Notice tone="accent">
                {owner.login} already had a Kagaz account; it was added as the owner and keeps its
                existing password.
              </Notice>
            )}
            <div>
              <div className="mb-1 font-medium">Next steps</div>
              <ol className="list-decimal space-y-1 pl-5 text-text-secondary">
                <li>Set pricing and opening hours in the operations dashboard.</li>
                <li>Create a pairing code and enrol the shop PC (Devices tab).</li>
                <li>Confirm the printer, then open the shop.</li>
              </ol>
            </div>
            <div className="flex flex-wrap gap-2">
              <LinkButton href={`/sudoadmin/shops/${done.shop.id}`}>Open in console</LinkButton>
              <Link href={`/admin/shops/${done.shop.id}`}>
                <span className="inline-flex rounded-full border border-separator bg-surface px-3.5 py-1.5 text-[13px] font-medium hover:bg-selection">
                  Pricing, hours & devices
                </span>
              </Link>
            </div>
          </div>
        </Card>
      </>
    );
  }

  const canSubmit =
    name.trim().length >= 2 &&
    slug.length >= 3 &&
    address.trim().length >= 2 &&
    (!withOwner || (ownerName.trim() && (ownerEmail.trim() || ownerPhone.trim())));

  return (
    <>
      <Link
        href="/sudoadmin/shops"
        className="mb-2 inline-block text-[13px] text-accent hover:underline"
      >
        ‹ Shops
      </Link>
      <PageHeader title="New shop" subtitle="Create the shop, its owner login and subscription." />
      <form
        className="flex max-w-2xl flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Card title="Shop">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Shop name"
              value={name}
              onChange={(v) => {
                setName(v);
                if (!slugEdited) setSlug(slugify(v));
              }}
              placeholder="Sri Ganesh Xerox"
            />
            <Input
              label="Slug (used in links and scripts)"
              value={slug}
              onChange={(v) => {
                setSlugEdited(true);
                setSlug(v.toLowerCase());
              }}
              placeholder="sri-ganesh-xerox"
            />
            <Input
              label="Address"
              value={address}
              onChange={setAddress}
              placeholder="VV Road, Mandya"
              className="sm:col-span-2"
            />
            <Input
              label="Shop phone (optional)"
              value={contactPhone}
              onChange={setContactPhone}
              placeholder="+919876543210"
            />
            <div className="flex items-end justify-between gap-3 pb-1">
              <div>
                <div className="text-[13px]">Demo shop</div>
                <Hint>Demo shops can be wiped with demo:reset.</Hint>
              </div>
              <Toggle checked={isDemo} onChange={setIsDemo} label="Demo shop" />
            </div>
          </div>
        </Card>

        <Card
          title="Owner account"
          actions={<Toggle checked={withOwner} onChange={setWithOwner} label="Create owner" />}
        >
          {withOwner ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Input label="Full name" value={ownerName} onChange={setOwnerName} />
              <Input
                label="Email"
                type="email"
                value={ownerEmail}
                onChange={setOwnerEmail}
                autoComplete="off"
              />
              <Input
                label="Phone (E.164)"
                value={ownerPhone}
                onChange={setOwnerPhone}
                placeholder="+919876543210"
              />
              <Input
                label="Password (optional)"
                type="password"
                value={ownerPassword}
                onChange={setOwnerPassword}
                autoComplete="new-password"
                placeholder="Leave empty to generate"
              />
              <div className="sm:col-span-2">
                <Hint>
                  The owner signs in to the dashboard and the shop app with this email or phone. If
                  the login already exists it is added as owner and keeps its password.
                </Hint>
              </div>
            </div>
          ) : (
            <Hint>You can add owners and operators later from the shop’s Team tab.</Hint>
          )}
        </Card>

        <Card title="Subscription">
          {plans.loading && !plans.data ? (
            <Hint>Loading plans…</Hint>
          ) : activePlans.length === 0 ? (
            <Hint>
              No plans yet.{' '}
              <Link href="/sudoadmin/plans" className="text-accent">
                Create a plan
              </Link>{' '}
              first, or add the subscription later.
            </Hint>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              <Select
                label="Plan"
                value={planId}
                onChange={pickPlan}
                className="sm:col-span-3"
                options={[
                  { value: '', label: 'No subscription for now' },
                  ...activePlans.map((p) => ({
                    value: p.id,
                    label: `${p.name} — ${price(p.pricePaise, p.interval)}`,
                  })),
                ]}
              />
              {plan && (
                <>
                  <Input
                    label={`Agreed price (₹ per ${plan.interval === 'MONTHLY' ? 'month' : 'year'})`}
                    value={priceText}
                    onChange={setPriceText}
                    inputMode="decimal"
                  />
                  <Input
                    label="Free trial (days)"
                    value={trialText}
                    onChange={setTrialText}
                    inputMode="numeric"
                  />
                  <div className="flex items-end pb-1">
                    <Hint>
                      {Number(trialText || 0) > 0
                        ? 'Starts on trial; record the first payment when it ends.'
                        : 'Starts active with the first payment due now.'}
                    </Hint>
                  </div>
                </>
              )}
            </div>
          )}
        </Card>

        <ErrorNote error={error} />
        <div className="flex justify-end gap-2">
          <Link href="/sudoadmin/shops">
            <span className="inline-flex rounded-full border border-separator bg-surface px-3.5 py-1.5 text-[13px] font-medium hover:bg-selection">
              Cancel
            </span>
          </Link>
          <Button type="submit" variant="primary" busy={busy} disabled={!canSubmit}>
            Create shop
          </Button>
        </div>
      </form>
    </>
  );
}
