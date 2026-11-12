'use client';

import { useState } from 'react';
import {
  type AdminShopBilling,
  type AdminSubscription,
  MANUAL_PAYMENT_METHODS,
  type SubscriptionSummary,
  istDay,
  istMidnight,
  periodTotal,
} from '@kagaz/shared';
import { Notice, Pill } from '@/components/ui';
import { billingApi } from '../../_lib/billing-api';
import { humanize, rupees } from '../../_lib/format';
import {
  Button,
  Card,
  Empty,
  ErrorNote,
  Facts,
  Input,
  Loading,
  Select,
  StatTile,
  Table,
  Td,
  useAction,
  useLoad,
} from '../../_components/kit';
import { toPaise } from './sections';

type Method = (typeof MANUAL_PAYMENT_METHODS)[number];
const METHOD_LABEL: Record<Method, string> = {
  CASH: 'Cash',
  UPI: 'UPI',
  BANK_TRANSFER: 'Bank transfer',
  CHEQUE: 'Cheque',
  OTHER: 'Other',
};

/** What an admin wants to do; the Billing list opens the panel on one of these. */
export type BillingAction = 'renew' | 'pay' | 'change' | 'extend' | 'cancel';

const today = () => istDay(new Date());
const fromPaise = (p: number) => `${Math.floor(p / 100)}.${String(p % 100).padStart(2, '0')}`;
const validDay = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);

/** "12 Nov 2026" in Asia/Kolkata. */
export const fmtDate = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }).format(new Date(iso))
    : '—';
/** Periods end at the start of their end day; show the last covered day. */
const lastDay = (endIso: string) => fmtDate(new Date(new Date(endIso).getTime() - 1).toISOString());

export const summaryTone = (s: SubscriptionSummary['status'] | 'EXPIRING') =>
  s === 'ACTIVE' ? 'green' : s === 'EXPIRING' ? 'orange' : s === 'EXPIRED' ? 'red' : 'neutral';

/** Shop → Subscription tab. */
export function SubscriptionSection({ shopId }: { shopId: string }) {
  return <ShopBillingPanel shopId={shopId} />;
}

/**
 * A shop's subscription (ADR-004): plan per connected printer, payment ledger, balance and the
 * revision history, with every admin action. Payments are append-only (fix with a correction);
 * plan and end-date changes keep a revision with who, when and why.
 */
export function ShopBillingPanel({
  shopId,
  action,
  onChanged,
}: {
  shopId: string;
  /** Open this action on the shop's current subscription (Billing list row buttons). */
  action?: BillingAction;
  onChanged?: () => void;
}) {
  const { data, error, loading, setData } = useLoad(() => billingApi.shop(shopId), [shopId]);
  if (loading && !data) return <Loading />;
  if (!data) return <ErrorNote error={error} />;

  const saved = (b: AdminShopBilling) => {
    setData(b);
    onChanged?.();
  };
  const { summary } = data;
  const active = data.subscriptions.filter((s) => s.status === 'ACTIVE');
  const current = active.find((s) => s.phase === 'CURRENT') ?? active[0];
  const latestEnd = active.reduce<string | null>(
    (max, s) => (!max || s.periodEnd > max ? s.periodEnd : max),
    null,
  );

  return (
    <div className="space-y-5">
      {!data.enforced && (
        <Notice tone="orange">
          Billing isn’t enforced yet (BILLING_ENFORCED is off): shops without a plan can still take
          orders.
        </Notice>
      )}
      <div className="grid gap-3 sm:grid-cols-4">
        <StatTile
          label="Plan"
          value={<Pill tone={summaryTone(summary.status)}>{humanize(summary.status)}</Pill>}
          hint={
            summary.periodEnd
              ? `${summary.status === 'ACTIVE' ? 'Until' : 'Ended'} ${lastDay(summary.periodEnd)}`
              : 'No subscription yet'
          }
        />
        <StatTile
          label="Printer seats"
          value={summary.printerSeats}
          hint={`${data.connectedPrinters} printer${data.connectedPrinters === 1 ? '' : 's'} connected`}
        />
        <StatTile label="Days left" value={summary.daysLeft ?? '—'} />
        <StatTile
          label={data.balancePaise < 0 ? 'Credit' : 'Balance due'}
          value={rupees(Math.abs(data.balancePaise))}
          hint="across all plans"
        />
      </div>

      <NewSubscription
        key={latestEnd ?? 'none'}
        shopId={shopId}
        highlight={action === 'renew'}
        defaultStart={
          latestEnd && latestEnd > new Date().toISOString() ? istDay(new Date(latestEnd)) : today()
        }
        defaultSeats={Math.max(1, current?.printerSeats ?? 0, data.connectedPrinters)}
        defaultPrice={current ? fromPaise(current.pricePerPrinterPaise) : ''}
        onSaved={saved}
      />

      <Card title="Subscriptions, payments and changes" flush>
        {data.subscriptions.length === 0 ? (
          <Empty>No subscriptions yet.</Empty>
        ) : (
          <div className="divide-y divide-separator">
            {data.subscriptions.map((s) => (
              <SubscriptionRow
                key={s.id}
                shopId={shopId}
                sub={s}
                shopBalance={data.balancePaise}
                initial={action && action !== 'renew' && s.id === current?.id ? action : undefined}
                onSaved={saved}
              />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function NewSubscription({
  shopId,
  defaultStart,
  defaultSeats,
  defaultPrice,
  highlight,
  onSaved,
}: {
  shopId: string;
  defaultStart: string;
  defaultSeats: number;
  defaultPrice: string;
  highlight: boolean;
  onSaved: (b: AdminShopBilling) => void;
}) {
  const [seats, setSeats] = useState(String(defaultSeats));
  const [price, setPrice] = useState(defaultPrice);
  const [start, setStart] = useState(defaultStart);
  const [months, setMonths] = useState('1');
  const [notes, setNotes] = useState('');
  const action = useAction();

  const seatsN = Number.parseInt(seats, 10);
  const monthsN = Number.parseInt(months, 10);
  const pricePaise = toPaise(price);
  const valid =
    seatsN >= 1 &&
    seatsN <= 100 &&
    monthsN >= 1 &&
    monthsN <= 36 &&
    pricePaise !== null &&
    validDay(start);
  const total = valid ? seatsN * pricePaise * monthsN : null;

  async function save() {
    if (!valid || pricePaise === null) return;
    const res = await action.run(() =>
      billingApi.create(shopId, {
        printerSeats: seatsN,
        pricePerPrinterPaise: pricePaise,
        startDate: start,
        months: monthsN,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      }),
    );
    if (res) {
      onSaved(res);
      setNotes('');
    }
  }

  return (
    <Card
      title="New subscription or renewal"
      className={highlight ? 'ring-2 ring-accent' : undefined}
    >
      <ErrorNote error={action.error} />
      <div className="grid gap-3 sm:grid-cols-4">
        <Input label="Printers (seats)" value={seats} onChange={setSeats} inputMode="numeric" />
        <Input
          label="Price per printer / month (₹)"
          value={price}
          onChange={setPrice}
          inputMode="decimal"
          placeholder="499"
        />
        <Input label="Starts on" value={start} onChange={setStart} type="date" />
        <Input label="Months" value={months} onChange={setMonths} inputMode="numeric" />
      </div>
      <Input
        className="mt-3"
        label="Notes (optional)"
        value={notes}
        onChange={setNotes}
        placeholder="e.g. Diwali offer"
      />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="primary" busy={action.busy} disabled={!valid} onClick={() => void save()}>
          Create subscription
        </Button>
        <span className="text-[13px] text-text-secondary">
          {total !== null && pricePaise !== null
            ? `${seatsN} × ${rupees(pricePaise)} × ${monthsN} month${monthsN === 1 ? '' : 's'} = ${rupees(total)}`
            : 'Enter seats, price and months to see the total.'}
        </span>
      </div>
    </Card>
  );
}

function SubscriptionRow({
  shopId,
  sub,
  shopBalance,
  initial,
  onSaved,
}: {
  shopId: string;
  sub: AdminSubscription;
  shopBalance: number;
  initial?: Exclude<BillingAction, 'renew'>;
  onSaved: (b: AdminShopBilling) => void;
}) {
  const [mode, setMode] = useState<'idle' | Exclude<BillingAction, 'renew'>>(initial ?? 'idle');
  const isActive = sub.status === 'ACTIVE';
  const tone =
    sub.phase === 'CURRENT'
      ? 'green'
      : sub.phase === 'UPCOMING'
        ? 'accent'
        : sub.phase === 'CANCELLED'
          ? 'red'
          : 'neutral';
  const done = (b: AdminShopBilling) => {
    onSaved(b);
    setMode('idle');
  };

  return (
    <div className="px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Pill tone={tone}>{humanize(sub.phase)}</Pill>
            <span className="text-[15px] font-semibold">
              {fmtDate(sub.periodStart)} – {lastDay(sub.periodEnd)}
            </span>
          </div>
          <div className="mt-1 text-[13px] text-text-secondary">
            {sub.printerSeats} printer{sub.printerSeats === 1 ? '' : 's'} ×{' '}
            {rupees(sub.pricePerPrinterPaise)} / month
            {sub.notes && ` · ${sub.notes}`}
            {sub.createdBy && ` · by ${sub.createdBy}`}
          </div>
          {sub.cancelReason && (
            <div className="mt-1 text-[13px] text-red">
              Cancelled {fmtDate(sub.cancelledAt)}: {sub.cancelReason}
            </div>
          )}
        </div>
        <Facts
          items={[
            ['Total', rupees(sub.totalPaise)],
            ['Paid', rupees(sub.paidPaise)],
            [
              'Balance',
              <span key="b" className={sub.balancePaise > 0 ? 'font-semibold text-orange' : ''}>
                {rupees(sub.balancePaise)}
              </span>,
            ],
          ]}
        />
      </div>

      {sub.payments.length > 0 && (
        <div className="mt-3 overflow-hidden rounded-lg border border-separator">
          <Table head={['Received', 'Amount', 'Method', 'Reference', 'Note', 'Recorded by']}>
            {sub.payments.map((p) => (
              <tr key={p.id}>
                <Td>{fmtDate(p.receivedAt)}</Td>
                <Td mono>
                  <span className={p.amountPaise < 0 ? 'text-red' : ''}>
                    {rupees(p.amountPaise)}
                  </span>
                </Td>
                <Td>{humanize(p.method)}</Td>
                <Td mono>{p.reference ?? '—'}</Td>
                <Td>{p.note ?? '—'}</Td>
                <Td>{p.recordedBy ?? '—'}</Td>
              </tr>
            ))}
          </Table>
        </div>
      )}

      {sub.changes.length > 0 && (
        <ul className="mt-3 space-y-1 text-[12px] text-text-secondary">
          {sub.changes.map((c) => (
            <li key={c.id}>
              <span className="font-medium text-text">{humanize(c.kind)}</span> ·{' '}
              {fmtDate(c.createdAt)}
              {c.changedBy && ` by ${c.changedBy}`}: {describeChange(c.before, c.after)} — “
              {c.reason}”
            </li>
          ))}
        </ul>
      )}

      {mode === 'pay' && (
        <RecordPayment shopId={shopId} sub={sub} onClose={() => setMode('idle')} onSaved={done} />
      )}
      {mode === 'change' && (
        <ChangePlan
          shopId={shopId}
          sub={sub}
          shopBalance={shopBalance}
          onClose={() => setMode('idle')}
          onSaved={done}
        />
      )}
      {mode === 'extend' && (
        <ChangeEndDate
          shopId={shopId}
          sub={sub}
          shopBalance={shopBalance}
          onClose={() => setMode('idle')}
          onSaved={done}
        />
      )}
      {mode === 'cancel' && (
        <CancelForm shopId={shopId} sub={sub} onClose={() => setMode('idle')} onSaved={done} />
      )}
      {mode === 'idle' && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={() => setMode('pay')}>Record payment</Button>
          {isActive && sub.phase === 'CURRENT' && (
            <Button onClick={() => setMode('change')}>Change plan</Button>
          )}
          {isActive && <Button onClick={() => setMode('extend')}>Change end date</Button>}
          {isActive && sub.phase !== 'ENDED' && (
            <Button variant="danger" onClick={() => setMode('cancel')}>
              Cancel subscription
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

type Snap = AdminSubscription['changes'][number]['before'];
function describeChange(b: Snap, a: Snap): string {
  const parts: string[] = [];
  if (b.printerSeats !== a.printerSeats) parts.push(`seats ${b.printerSeats} → ${a.printerSeats}`);
  if (b.pricePerPrinterPaise !== a.pricePerPrinterPaise)
    parts.push(`price ${rupees(b.pricePerPrinterPaise)} → ${rupees(a.pricePerPrinterPaise)}`);
  if (b.periodEnd !== a.periodEnd)
    parts.push(`ends ${lastDay(b.periodEnd)} → ${lastDay(a.periodEnd)}`);
  if (b.totalPaise !== a.totalPaise)
    parts.push(`total ${rupees(b.totalPaise)} → ${rupees(a.totalPaise)}`);
  if (b.status !== a.status) parts.push(humanize(a.status).toLowerCase());
  if (a.successorId) parts.push('new plan from that day');
  return parts.join(', ') || 'no change';
}

function FormBox({ children, danger }: { children: React.ReactNode; danger?: boolean }) {
  return (
    <div className={`mt-3 rounded-lg border p-3 ${danger ? 'border-red/40' : 'border-separator'}`}>
      {children}
    </div>
  );
}

function ChangePlan({
  shopId,
  sub,
  shopBalance,
  onClose,
  onSaved,
}: {
  shopId: string;
  sub: AdminSubscription;
  shopBalance: number;
  onClose: () => void;
  onSaved: (b: AdminShopBilling) => void;
}) {
  const [seats, setSeats] = useState(String(sub.printerSeats));
  const [price, setPrice] = useState(fromPaise(sub.pricePerPrinterPaise));
  const [date, setDate] = useState(today());
  const [reason, setReason] = useState('');
  const action = useAction();

  const seatsN = Number.parseInt(seats, 10);
  const pricePaise = toPaise(price);
  const start = new Date(sub.periodStart);
  const end = new Date(sub.periodEnd);
  const effective = validDay(date) ? istMidnight(date) : null;
  const inPeriod = !!effective && start < effective && effective < end;
  const valid =
    seatsN >= 1 && seatsN <= 100 && pricePaise !== null && inPeriod && reason.trim().length >= 3;
  const preview =
    inPeriod && effective && pricePaise !== null && seatsN >= 1
      ? (() => {
          const oldTotal = periodTotal(
            sub.printerSeats,
            sub.pricePerPrinterPaise,
            start,
            effective,
          );
          const newTotal = periodTotal(seatsN, pricePaise, effective, end);
          return {
            oldTotal,
            newTotal,
            balance: shopBalance - sub.totalPaise + oldTotal + newTotal,
          };
        })()
      : null;

  async function save() {
    if (!valid || pricePaise === null) return;
    const res = await action.run(() =>
      billingApi.changePlan(shopId, sub.id, {
        printerSeats: seatsN,
        pricePerPrinterPaise: pricePaise,
        effectiveDate: date,
        reason: reason.trim(),
      }),
    );
    if (res) onSaved(res);
  }

  return (
    <FormBox>
      <ErrorNote error={action.error} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Input label="Printers (seats)" value={seats} onChange={setSeats} inputMode="numeric" />
        <Input
          label="Price per printer / month (₹)"
          value={price}
          onChange={setPrice}
          inputMode="decimal"
        />
        <Input label="Effective from" value={date} onChange={setDate} type="date" />
      </div>
      <Input
        className="mt-3"
        label="Reason"
        value={reason}
        onChange={setReason}
        placeholder="e.g. Added a second printer"
      />
      <p className="mt-3 text-[13px] text-text-secondary">
        {preview
          ? `This plan ends ${fmtDate(effective!.toISOString())} and its total becomes ${rupees(preview.oldTotal)} (was ${rupees(sub.totalPaise)}). The new plan runs to ${lastDay(sub.periodEnd)} for ${rupees(preview.newTotal)}. Shop ${preview.balance < 0 ? 'credit' : 'balance due'} after: ${rupees(Math.abs(preview.balance))}.`
          : `Pick a date after ${fmtDate(sub.periodStart)} and before ${lastDay(sub.periodEnd)}.`}
      </p>
      <div className="mt-3 flex gap-2">
        <Button variant="primary" busy={action.busy} disabled={!valid} onClick={() => void save()}>
          Change plan
        </Button>
        <Button onClick={onClose}>Close</Button>
      </div>
    </FormBox>
  );
}

function ChangeEndDate({
  shopId,
  sub,
  shopBalance,
  onClose,
  onSaved,
}: {
  shopId: string;
  sub: AdminSubscription;
  shopBalance: number;
  onClose: () => void;
  onSaved: (b: AdminShopBilling) => void;
}) {
  const [date, setDate] = useState(istDay(new Date(sub.periodEnd)));
  const [reason, setReason] = useState('');
  const action = useAction();
  const start = new Date(sub.periodStart);
  const end = validDay(date) ? istMidnight(date) : null;
  const ok = !!end && end > start && end.toISOString() !== sub.periodEnd;
  const newTotal =
    ok && end ? periodTotal(sub.printerSeats, sub.pricePerPrinterPaise, start, end) : null;
  const valid = ok && reason.trim().length >= 3;

  async function save() {
    if (!valid) return;
    const res = await action.run(() =>
      billingApi.changeEndDate(shopId, sub.id, { endDate: date, reason: reason.trim() }),
    );
    if (res) onSaved(res);
  }

  return (
    <FormBox>
      <ErrorNote error={action.error} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Input
          label="New end date (plan stops at the start of this day)"
          value={date}
          onChange={setDate}
          type="date"
        />
        <Input
          className="sm:col-span-2"
          label="Reason"
          value={reason}
          onChange={setReason}
          placeholder="e.g. Paid one more month in cash"
        />
      </div>
      <p className="mt-3 text-[13px] text-text-secondary">
        {newTotal !== null
          ? `Total ${rupees(sub.totalPaise)} → ${rupees(newTotal)}. Shop ${shopBalance - sub.totalPaise + newTotal < 0 ? 'credit' : 'balance due'} after: ${rupees(Math.abs(shopBalance - sub.totalPaise + newTotal))}.`
          : 'Pick a different end date after the start of the plan.'}
      </p>
      <div className="mt-3 flex gap-2">
        <Button variant="primary" busy={action.busy} disabled={!valid} onClick={() => void save()}>
          Save end date
        </Button>
        <Button onClick={onClose}>Close</Button>
      </div>
    </FormBox>
  );
}

function RecordPayment({
  shopId,
  sub,
  onClose,
  onSaved,
}: {
  shopId: string;
  sub: AdminSubscription;
  onClose: () => void;
  onSaved: (b: AdminShopBilling) => void;
}) {
  const [amount, setAmount] = useState(sub.balancePaise > 0 ? fromPaise(sub.balancePaise) : '');
  const [correction, setCorrection] = useState(false);
  const [method, setMethod] = useState<Method>('UPI');
  const [reference, setReference] = useState('');
  const [date, setDate] = useState(today());
  const [note, setNote] = useState('');
  const action = useAction();
  const paise = toPaise(amount);

  async function save() {
    if (!paise) return;
    const res = await action.run(() =>
      billingApi.pay(shopId, sub.id, {
        amountPaise: correction ? -paise : paise,
        method,
        receivedDate: date,
        ...(reference.trim() ? { reference: reference.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    );
    if (res) onSaved(res);
  }

  return (
    <FormBox>
      <ErrorNote error={action.error} />
      <div className="grid gap-3 sm:grid-cols-4">
        <Input label="Amount (₹)" value={amount} onChange={setAmount} inputMode="decimal" />
        <Select
          label="Method"
          value={method}
          onChange={setMethod}
          options={MANUAL_PAYMENT_METHODS.map((m) => ({ value: m, label: METHOD_LABEL[m] }))}
        />
        <Input label="UTR / receipt no." value={reference} onChange={setReference} />
        <Input label="Received on" value={date} onChange={setDate} type="date" />
      </div>
      <Input className="mt-3" label="Note (optional)" value={note} onChange={setNote} />
      <label className="mt-3 flex items-center gap-2 text-[13px] text-text-secondary">
        <input
          type="checkbox"
          checked={correction}
          onChange={(e) => setCorrection(e.target.checked)}
        />
        This is a refund or correction (subtracts the amount)
      </label>
      <div className="mt-3 flex gap-2">
        <Button
          variant="primary"
          busy={action.busy}
          disabled={!paise || !validDay(date)}
          onClick={() => void save()}
        >
          Save payment
        </Button>
        <Button onClick={onClose}>Close</Button>
      </div>
      <p className="mt-2 text-[12px] text-text-secondary">
        Payments can’t be edited or deleted. To fix a mistake, record a correction.
      </p>
    </FormBox>
  );
}

function CancelForm({
  shopId,
  sub,
  onClose,
  onSaved,
}: {
  shopId: string;
  sub: AdminSubscription;
  onClose: () => void;
  onSaved: (b: AdminShopBilling) => void;
}) {
  const [reason, setReason] = useState('');
  const action = useAction();
  async function save() {
    const res = await action.run(() =>
      billingApi.cancel(shopId, sub.id, { reason: reason.trim() }),
    );
    if (res) onSaved(res);
  }
  return (
    <FormBox danger>
      <ErrorNote error={action.error} />
      <Input
        label="Reason"
        value={reason}
        onChange={setReason}
        placeholder="e.g. Shop stopped using Kaggaz"
      />
      <p className="mt-2 text-[12px] text-text-secondary">
        The shop loses its printer seats right away. Payments stay in the ledger.
      </p>
      <div className="mt-3 flex gap-2">
        <Button
          variant="danger"
          busy={action.busy}
          disabled={reason.trim().length < 3}
          onClick={() => void save()}
        >
          Cancel subscription
        </Button>
        <Button onClick={onClose}>Keep it</Button>
      </div>
    </FormBox>
  );
}
