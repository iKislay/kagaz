'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  type SubscriptionPaymentMethod,
  type SudoPlan,
  type SudoShopDetail,
  type SudoSubscription,
} from '@kagaz/shared';
import { Notice, Pill, SegmentedControl } from '@/components/ui';
import { rupees } from '../../../admin/_lib/format';
import {
  Button,
  Card,
  Empty,
  ErrorNote,
  Facts,
  Input,
  Select,
  Table,
  Td,
  Toggle,
  useAction,
  useLoad,
} from '../../../admin/_components/kit';
import { sudoApi } from '../../_lib/api';
import {
  METHOD_LABEL,
  coverageText,
  fmtDate,
  fromDateInput,
  paiseToInput,
  parseRupees,
  price,
  subscriptionBadge,
  toDateInput,
} from '../../_lib/format';
import { Hint, Sheet, SheetForm, TextArea } from '../../_components/parts';

type Dialog = 'start' | 'pay' | 'change' | 'cancel' | 'delete' | null;

/** Subscription, its history, and payments Kagaz received from the shop (bookkeeping only). */
export function BillingSection({
  shop,
  reload,
}: {
  shop: SudoShopDetail;
  reload: () => Promise<void>;
}) {
  const plans = useLoad(() => sudoApi.plans(), []);
  const [dialog, setDialog] = useState<Dialog>(null);
  const undo = useAction();
  const removePayment = useAction();
  const sub = shop.subscription;
  const close = () => setDialog(null);
  const done = async () => {
    await reload();
    close();
  };
  const activePlans = (plans.data?.plans ?? []).filter((p) => p.active);
  const badge = subscriptionBadge(sub);

  return (
    <div className="flex flex-col gap-5">
      <Card
        title="Current subscription"
        actions={sub && <Pill tone={badge.tone}>{badge.label}</Pill>}
      >
        {!sub ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Hint>
              {shop.lifecycle === 'ARCHIVED'
                ? 'Archived shops have no subscription.'
                : 'This shop has no open subscription.'}
            </Hint>
            {shop.lifecycle !== 'ARCHIVED' && (
              <Button variant="primary" onClick={() => setDialog('start')}>
                Start subscription
              </Button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <Facts
              items={[
                ['Plan', sub.plan.name],
                ['Price', price(sub.pricePaise, sub.interval)],
                ['Coverage', coverageText(sub)],
                ['Started', fmtDate(sub.createdAt)],
                ...(sub.cancelAtPeriodEnd
                  ? [
                      ['Ends', `At period end, ${fmtDate(sub.currentPeriodEnd)}`] as [
                        string,
                        string,
                      ],
                    ]
                  : []),
                ...(sub.notes ? [['Notes', sub.notes] as [string, string]] : []),
              ]}
            />
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => setDialog('pay')}>
                Record payment
              </Button>
              <Button onClick={() => setDialog('change')}>Change…</Button>
              {sub.cancelAtPeriodEnd ? (
                <Button
                  busy={undo.busy}
                  onClick={() =>
                    void undo.run(async () => {
                      await sudoApi.updateSubscription(shop.id, sub.id, {
                        cancelAtPeriodEnd: false,
                      });
                      await reload();
                    })
                  }
                >
                  Keep subscription
                </Button>
              ) : (
                <Button variant="danger" onClick={() => setDialog('cancel')}>
                  Cancel…
                </Button>
              )}
              {sub.paymentCount === 0 && (
                <Button variant="danger" onClick={() => setDialog('delete')}>
                  Delete
                </Button>
              )}
            </div>
            <ErrorNote error={undo.error} />
          </div>
        )}
      </Card>

      <Card title="Payments received" flush>
        {shop.payments.length === 0 ? (
          <Empty>No payments recorded.</Empty>
        ) : (
          <Table head={['Paid', 'Amount', 'Method', 'Covers', 'Recorded by', '']}>
            {shop.payments.map((p) => (
              <tr key={p.id}>
                <Td className="whitespace-nowrap">{fmtDate(p.paidAt)}</Td>
                <Td className="tabular-nums">{rupees(p.amountPaise)}</Td>
                <Td>
                  {METHOD_LABEL[p.method]}
                  {p.reference && (
                    <div className="font-mono text-[12px] text-text-secondary">{p.reference}</div>
                  )}
                </Td>
                <Td className="whitespace-nowrap text-text-secondary">
                  {fmtDate(p.periodStart)} – {fmtDate(p.periodEnd)}
                </Td>
                <Td className="text-text-secondary">{p.recordedBy?.name ?? '—'}</Td>
                <Td>
                  <Button
                    variant="danger"
                    disabled={removePayment.busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Delete the ${rupees(p.amountPaise)} payment from ${fmtDate(p.paidAt)}? The subscription period is not changed.`,
                        )
                      ) {
                        void removePayment.run(async () => {
                          await sudoApi.deletePayment(shop.id, p.id);
                          await reload();
                        });
                      }
                    }}
                  >
                    Delete
                  </Button>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <ErrorNote error={removePayment.error} />

      {shop.subscriptionHistory.length > 0 && (
        <Card title="Subscription history" flush>
          <Table head={['Plan', 'Price', 'Status', 'Started', 'Covered until', 'Payments']}>
            {shop.subscriptionHistory.map((h) => {
              const b = subscriptionBadge(h);
              return (
                <tr key={h.id}>
                  <Td className="font-medium">{h.plan.name}</Td>
                  <Td className="whitespace-nowrap">{price(h.pricePaise, h.interval)}</Td>
                  <Td>
                    <Pill tone={b.tone}>{b.label}</Pill>
                  </Td>
                  <Td className="whitespace-nowrap">{fmtDate(h.createdAt)}</Td>
                  <Td className="whitespace-nowrap">{fmtDate(h.currentPeriodEnd)}</Td>
                  <Td className="tabular-nums">{h.paymentCount}</Td>
                </tr>
              );
            })}
          </Table>
        </Card>
      )}
      <Hint>
        These are payments Kagaz received from the shop for the platform (cash, UPI or bank
        transfer), recorded by hand. They are separate from customer order payments.
      </Hint>

      {dialog === 'start' && (
        <StartSheet shopId={shop.id} plans={activePlans} onClose={close} onDone={done} />
      )}
      {dialog === 'pay' && sub && (
        <PaySheet shopId={shop.id} sub={sub} onClose={close} onDone={done} />
      )}
      {dialog === 'change' && sub && (
        <ChangeSheet shopId={shop.id} sub={sub} plans={activePlans} onClose={close} onDone={done} />
      )}
      {dialog === 'cancel' && sub && (
        <CancelSheet shopId={shop.id} sub={sub} onClose={close} onDone={done} />
      )}
      {dialog === 'delete' && sub && (
        <Sheet
          title="Delete this subscription?"
          subtitle="Use this for a subscription created by mistake. It has no payments, so nothing is lost."
          onClose={close}
        >
          <DeleteSubscription shopId={shop.id} subId={sub.id} onClose={close} onDone={done} />
        </Sheet>
      )}
    </div>
  );
}

function DeleteSubscription({
  shopId,
  subId,
  onClose,
  onDone,
}: {
  shopId: string;
  subId: string;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { busy, error, run } = useAction();
  return (
    <SheetForm
      submitLabel="Delete"
      danger
      busy={busy}
      error={error}
      onCancel={onClose}
      onSubmit={async () => {
        const ok = await run(() => sudoApi.deleteSubscription(shopId, subId));
        if (ok) await onDone();
      }}
    />
  );
}

function StartSheet({
  shopId,
  plans,
  onClose,
  onDone,
}: {
  shopId: string;
  plans: SudoPlan[];
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { busy, error, run, setError } = useAction();
  const [planId, setPlanId] = useState(plans[0]?.id ?? '');
  const plan = plans.find((p) => p.id === planId);
  const [priceText, setPriceText] = useState(plan ? paiseToInput(plan.pricePaise) : '');
  const [trialText, setTrialText] = useState(plan ? String(plan.trialDays) : '0');
  const [startsOn, setStartsOn] = useState(toDateInput(new Date().toISOString()));
  const [notes, setNotes] = useState('');

  if (plans.length === 0) {
    return (
      <Sheet title="Start subscription" onClose={onClose}>
        <Hint>
          There are no active plans.{' '}
          <Link href="/sudoadmin/plans" className="text-accent">
            Create a plan
          </Link>{' '}
          first.
        </Hint>
      </Sheet>
    );
  }
  return (
    <Sheet title="Start subscription" onClose={onClose}>
      <SheetForm
        submitLabel="Start"
        busy={busy}
        error={error}
        disabled={!plan}
        onCancel={onClose}
        onSubmit={async () => {
          const pricePaise = parseRupees(priceText);
          const trialDays = Number(trialText || '0');
          if (!plan || pricePaise === null || !Number.isInteger(trialDays) || trialDays < 0) {
            setError(new Error('Check the price (₹, up to 2 decimals) and trial days.'));
            return;
          }
          const ok = await run(() =>
            sudoApi.createSubscription(shopId, {
              planId: plan.id,
              pricePaise,
              trialDays,
              startsAt: fromDateInput(startsOn),
              ...(notes.trim() ? { notes: notes.trim() } : {}),
            }),
          );
          if (ok) await onDone();
        }}
      >
        <Select
          label="Plan"
          value={planId}
          onChange={(id) => {
            setPlanId(id);
            const p = plans.find((x) => x.id === id);
            if (p) {
              setPriceText(paiseToInput(p.pricePaise));
              setTrialText(String(p.trialDays));
            }
          }}
          options={plans.map((p) => ({
            value: p.id,
            label: `${p.name} — ${price(p.pricePaise, p.interval)}`,
          }))}
        />
        <div className="grid grid-cols-3 gap-3">
          <Input label="Agreed price (₹)" value={priceText} onChange={setPriceText} />
          <Input label="Trial (days)" value={trialText} onChange={setTrialText} />
          <Input label="Starts" type="date" value={startsOn} onChange={setStartsOn} />
        </div>
        <TextArea label="Notes (optional)" value={notes} onChange={setNotes} rows={2} />
        <Hint>
          {Number(trialText || 0) > 0
            ? 'Starts on trial. Record the first payment when the trial ends.'
            : 'Starts active with the first payment due now — record it to cover the first period.'}
        </Hint>
      </SheetForm>
    </Sheet>
  );
}

const METHODS: SubscriptionPaymentMethod[] = ['UPI', 'CASH', 'BANK_TRANSFER', 'OTHER'];

function PaySheet({
  shopId,
  sub,
  onClose,
  onDone,
}: {
  shopId: string;
  sub: SudoSubscription;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { busy, error, run, setError } = useAction();
  const [amountText, setAmountText] = useState(paiseToInput(sub.pricePaise));
  const [method, setMethod] = useState<SubscriptionPaymentMethod>('UPI');
  const [reference, setReference] = useState('');
  const [paidOn, setPaidOn] = useState(toDateInput(new Date().toISOString()));
  const [extend, setExtend] = useState(true);
  const [note, setNote] = useState('');
  return (
    <Sheet
      title="Record payment"
      subtitle={`${sub.plan.name} · ${price(sub.pricePaise, sub.interval)} · ${coverageText(sub)}`}
      onClose={onClose}
    >
      <SheetForm
        submitLabel="Record"
        busy={busy}
        error={error}
        onCancel={onClose}
        onSubmit={async () => {
          const amountPaise = parseRupees(amountText);
          if (!amountPaise) {
            setError(new Error('Enter the amount in ₹ (up to 2 decimals).'));
            return;
          }
          const ok = await run(() =>
            sudoApi.recordPayment(shopId, sub.id, {
              amountPaise,
              method,
              paidAt: fromDateInput(paidOn),
              extendPeriod: extend,
              ...(reference.trim() ? { reference: reference.trim() } : {}),
              ...(note.trim() ? { note: note.trim() } : {}),
            }),
          );
          if (ok) await onDone();
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <Input label="Amount (₹)" value={amountText} onChange={setAmountText} />
          <Input label="Paid on" type="date" value={paidOn} onChange={setPaidOn} />
        </div>
        <SegmentedControl
          label="Method"
          value={method}
          onChange={setMethod}
          options={METHODS.map((m) => ({ value: m, label: METHOD_LABEL[m] }))}
        />
        <Input
          label="Reference (UTR, receipt no.)"
          value={reference}
          onChange={setReference}
          autoComplete="off"
        />
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[13px]">
              Covers the next {sub.interval === 'MONTHLY' ? 'month' : 'year'}
            </div>
            <Hint>Marks the subscription active and moves “paid through” forward.</Hint>
          </div>
          <Toggle checked={extend} onChange={setExtend} label="Extend period" />
        </div>
        <TextArea label="Note (optional)" value={note} onChange={setNote} rows={2} />
      </SheetForm>
    </Sheet>
  );
}

function ChangeSheet({
  shopId,
  sub,
  plans,
  onClose,
  onDone,
}: {
  shopId: string;
  sub: SudoSubscription;
  plans: SudoPlan[];
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { busy, error, run, setError } = useAction();
  const options = [
    ...(plans.some((p) => p.id === sub.plan.id)
      ? []
      : [{ value: sub.plan.id, label: `${sub.plan.name} (current, no longer offered)` }]),
    ...plans.map((p) => ({ value: p.id, label: `${p.name} — ${price(p.pricePaise, p.interval)}` })),
  ];
  const [planId, setPlanId] = useState(sub.plan.id);
  const [priceText, setPriceText] = useState(paiseToInput(sub.pricePaise));
  const [status, setStatus] = useState<'TRIALING' | 'ACTIVE' | 'PAST_DUE'>(
    sub.status === 'CANCELLED' ? 'ACTIVE' : sub.status,
  );
  const [endOn, setEndOn] = useState(toDateInput(sub.currentPeriodEnd));
  const [notes, setNotes] = useState(sub.notes ?? '');

  return (
    <Sheet title="Change subscription" onClose={onClose} wide>
      <SheetForm
        submitLabel="Save"
        busy={busy}
        error={error}
        onCancel={onClose}
        onSubmit={async () => {
          const pricePaise = parseRupees(priceText);
          if (pricePaise === null) {
            setError(new Error('Enter the price in ₹ (up to 2 decimals).'));
            return;
          }
          const ok = await run(() =>
            sudoApi.updateSubscription(shopId, sub.id, {
              ...(planId !== sub.plan.id ? { planId } : {}),
              pricePaise,
              status,
              ...(endOn !== toDateInput(sub.currentPeriodEnd)
                ? { currentPeriodEnd: fromDateInput(endOn) }
                : {}),
              notes: notes.trim() || null,
            }),
          );
          if (ok) await onDone();
        }}
      >
        <Select
          label="Plan"
          value={planId}
          onChange={(id) => {
            setPlanId(id);
            const p = plans.find((x) => x.id === id);
            if (p && id !== sub.plan.id) setPriceText(paiseToInput(p.pricePaise));
          }}
          options={options}
        />
        <div className="grid grid-cols-2 gap-3">
          <Input label="Agreed price (₹)" value={priceText} onChange={setPriceText} />
          <Input label="Paid / trial through" type="date" value={endOn} onChange={setEndOn} />
        </div>
        <div>
          <div className="mb-1 text-[12px] text-text-secondary">Status</div>
          <SegmentedControl
            label="Status"
            value={status}
            onChange={setStatus}
            options={[
              { value: 'TRIALING', label: 'Trial' },
              { value: 'ACTIVE', label: 'Active' },
              { value: 'PAST_DUE', label: 'Past due' },
            ]}
          />
        </div>
        <TextArea label="Notes" value={notes} onChange={setNotes} rows={2} />
        <Hint>
          Switching plan uses the new plan’s billing interval. Extending “paid through” without a
          payment gives the shop free time — it is recorded in the audit log.
        </Hint>
      </SheetForm>
    </Sheet>
  );
}

function CancelSheet({
  shopId,
  sub,
  onClose,
  onDone,
}: {
  shopId: string;
  sub: SudoSubscription;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { busy, error, run } = useAction();
  const [when, setWhen] = useState<'end' | 'now'>('end');
  const [reason, setReason] = useState('');
  return (
    <Sheet title="Cancel subscription" onClose={onClose}>
      <SheetForm
        submitLabel="Cancel subscription"
        danger
        busy={busy}
        error={error}
        onCancel={onClose}
        onSubmit={async () => {
          const ok = await run(() =>
            sudoApi.cancelSubscription(shopId, sub.id, {
              atPeriodEnd: when === 'end',
              ...(reason.trim() ? { reason: reason.trim() } : {}),
            }),
          );
          if (ok) await onDone();
        }}
      >
        <SegmentedControl
          label="When"
          value={when}
          onChange={setWhen}
          options={[
            { value: 'end', label: `At period end (${fmtDate(sub.currentPeriodEnd)})` },
            { value: 'now', label: 'Immediately' },
          ]}
        />
        <TextArea label="Reason (optional)" value={reason} onChange={setReason} rows={2} />
        <Notice tone="accent">
          Cancelling doesn’t stop the shop from taking orders. Suspend the shop from the Overview
          tab if it should stop.
        </Notice>
      </SheetForm>
    </Sheet>
  );
}
