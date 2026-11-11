'use client';

import { useState } from 'react';
import { type BillingInterval, type SudoPlan } from '@kagaz/shared';
import { Pill, SegmentedControl } from '@/components/ui';
import {
  Button,
  Card,
  Empty,
  ErrorNote,
  Input,
  Loading,
  PageHeader,
  Table,
  Td,
  Toggle,
  useAction,
  useLoad,
} from '../../admin/_components/kit';
import { sudoApi } from '../_lib/api';
import { paiseToInput, parseRupees, price, slugify } from '../_lib/format';
import { Hint, Sheet, SheetForm, TextArea } from '../_components/parts';

/** The subscription plan catalogue. Price changes never touch existing subscriptions. */
export default function PlansPage() {
  const { data, error, loading, reload } = useLoad(() => sudoApi.plans(), []);
  const [editing, setEditing] = useState<SudoPlan | 'new' | null>(null);
  const del = useAction();

  return (
    <>
      <PageHeader
        title="Plans"
        subtitle="What shops pay Kagaz. Each subscription keeps the price agreed when it started."
        actions={
          <Button variant="primary" onClick={() => setEditing('new')}>
            New plan
          </Button>
        }
      />
      <ErrorNote error={error} />
      <ErrorNote error={del.error} />
      {loading && !data ? (
        <Loading />
      ) : (
        data && (
          <Card flush>
            {data.plans.length === 0 ? (
              <Empty>No plans yet. Create one to start subscriptions.</Empty>
            ) : (
              <Table head={['Plan', 'Price', 'Trial', 'Limits', 'Shops', '']}>
                {data.plans.map((p) => (
                  <tr key={p.id} className={p.active ? '' : 'opacity-60'}>
                    <Td className="min-w-48">
                      <div className="font-medium">
                        {p.name}
                        {!p.active && (
                          <span className="ml-2">
                            <Pill tone="neutral">Inactive</Pill>
                          </span>
                        )}
                      </div>
                      <div className="font-mono text-[12px] text-text-secondary">{p.code}</div>
                      {p.description && (
                        <div className="text-[12px] text-text-secondary">{p.description}</div>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap tabular-nums">
                      {price(p.pricePaise, p.interval)}
                    </Td>
                    <Td>{p.trialDays ? `${p.trialDays} days` : '—'}</Td>
                    <Td className="text-[12px] text-text-secondary">
                      {p.maxPrinters ? `${p.maxPrinters} printers` : 'Any printers'}
                      <br />
                      {p.maxMonthlyOrders ? `${p.maxMonthlyOrders} orders / mo` : 'Any orders'}
                    </Td>
                    <Td className="tabular-nums">{p.subscriberCount}</Td>
                    <Td>
                      <div className="flex justify-end gap-2">
                        <Button onClick={() => setEditing(p)}>Edit</Button>
                        <Button
                          variant="danger"
                          disabled={del.busy}
                          onClick={() => {
                            if (window.confirm(`Delete plan “${p.name}”?`)) {
                              void del.run(async () => {
                                await sudoApi.deletePlan(p.id);
                                await reload();
                              });
                            }
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </Table>
            )}
          </Card>
        )
      )}
      <div className="mt-3">
        <Hint>
          Limits are informational for now (not enforced). A plan that shops have used can’t be
          deleted — switch it off instead.
        </Hint>
      </div>
      {editing && (
        <PlanSheet
          plan={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await reload();
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function PlanSheet({
  plan,
  onClose,
  onSaved,
}: {
  plan: SudoPlan | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { busy, error, run, setError } = useAction();
  const [name, setName] = useState(plan?.name ?? '');
  const [code, setCode] = useState(plan?.code ?? '');
  const [codeEdited, setCodeEdited] = useState(!!plan);
  const [description, setDescription] = useState(plan?.description ?? '');
  const [interval, setBillingInterval] = useState<BillingInterval>(plan?.interval ?? 'MONTHLY');
  const [priceText, setPriceText] = useState(plan ? paiseToInput(plan.pricePaise) : '');
  const [trialText, setTrialText] = useState(String(plan?.trialDays ?? 14));
  const [printersText, setPrintersText] = useState(plan?.maxPrinters?.toString() ?? '');
  const [ordersText, setOrdersText] = useState(plan?.maxMonthlyOrders?.toString() ?? '');
  const [active, setActive] = useState(plan?.active ?? true);

  const optInt = (s: string) => (s.trim() === '' ? null : Number(s));

  return (
    <Sheet title={plan ? `Edit ${plan.name}` : 'New plan'} onClose={onClose} wide>
      <SheetForm
        submitLabel={plan ? 'Save' : 'Create plan'}
        busy={busy}
        error={error}
        disabled={!name.trim() || (!plan && code.length < 3)}
        onCancel={onClose}
        onSubmit={async () => {
          const pricePaise = parseRupees(priceText);
          const trialDays = Number(trialText || '0');
          const maxPrinters = optInt(printersText);
          const maxMonthlyOrders = optInt(ordersText);
          const badInt = (n: number | null) => n !== null && (!Number.isInteger(n) || n < 1);
          if (
            pricePaise === null ||
            !Number.isInteger(trialDays) ||
            trialDays < 0 ||
            badInt(maxPrinters) ||
            badInt(maxMonthlyOrders)
          ) {
            setError(new Error('Check the price (₹, up to 2 decimals) and the number fields.'));
            return;
          }
          const common = {
            name: name.trim(),
            pricePaise,
            trialDays,
            maxPrinters,
            maxMonthlyOrders,
          };
          const ok = await run(() =>
            plan
              ? sudoApi.updatePlan(plan.id, {
                  ...common,
                  description: description.trim() || null,
                  active,
                })
              : sudoApi.createPlan({
                  ...common,
                  code,
                  interval,
                  ...(description.trim() ? { description: description.trim() } : {}),
                }),
          );
          if (ok) await onSaved();
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Name"
            value={name}
            onChange={(v) => {
              setName(v);
              if (!codeEdited) setCode(slugify(v));
            }}
            placeholder="Starter"
          />
          <Input
            label={plan ? 'Code (fixed)' : 'Code'}
            value={code}
            onChange={(v) => {
              setCodeEdited(true);
              setCode(v.toLowerCase());
            }}
            placeholder="starter-monthly"
            disabled={!!plan}
          />
        </div>
        <TextArea
          label="Description (optional)"
          value={description}
          onChange={setDescription}
          rows={2}
        />
        <div>
          <div className="mb-1 text-[12px] text-text-secondary">
            Billing {plan ? '(fixed)' : ''}
          </div>
          <SegmentedControl
            label="Billing interval"
            value={interval}
            onChange={setBillingInterval}
            disabled={!!plan}
            options={[
              { value: 'MONTHLY', label: 'Monthly' },
              { value: 'YEARLY', label: 'Yearly' },
            ]}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input
            label={`Price (₹ per ${interval === 'MONTHLY' ? 'month' : 'year'})`}
            value={priceText}
            onChange={setPriceText}
            inputMode="decimal"
            placeholder="499"
          />
          <Input label="Free trial (days)" value={trialText} onChange={setTrialText} />
          <Input
            label="Max printers (optional)"
            value={printersText}
            onChange={setPrintersText}
            inputMode="numeric"
          />
          <Input
            label="Max orders / month (optional)"
            value={ordersText}
            onChange={setOrdersText}
            inputMode="numeric"
          />
        </div>
        {plan && (
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[13px]">Offered to new shops</div>
              <Hint>Existing subscriptions stay on the plan either way.</Hint>
            </div>
            <Toggle checked={active} onChange={setActive} label="Plan active" />
          </div>
        )}
      </SheetForm>
    </Sheet>
  );
}
