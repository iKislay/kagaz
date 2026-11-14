'use client';

import { useState } from 'react';
import {
  type AdminEnrollmentCodeCreated,
  type AdminShopDetail,
  type AdminShopUpdateRequest,
  type AutoLimits,
  OPENING_DAYS,
  type OpeningDay,
  type OpeningHours,
} from '@kagaz/shared';
import { Dot, Notice, Pill, SegmentedControl } from '@/components/ui';
import { adminApi } from '../../_lib/api';
import { fmtAgo, fmtDateTime, healthTone, humanize, printerTone, rupees } from '../../_lib/format';
import {
  Button,
  Card,
  Empty,
  ErrorNote,
  Facts,
  Input,
  Loading,
  Table,
  Td,
  Toggle,
  useAction,
  useLoad,
} from '../../_components/kit';

// ─── Settings ───

export function SettingsSection({
  shop,
  admin,
  onSaved,
}: {
  shop: AdminShopDetail;
  admin: boolean;
  onSaved: (s: AdminShopDetail) => void;
}) {
  const [name, setName] = useState(shop.name);
  const [phone, setPhone] = useState(shop.contactPhone ?? '');
  const [status, setStatus] = useState(shop.status);
  const [mode, setMode] = useState(shop.approvalMode);
  const [paused, setPaused] = useState(shop.autoPaused);
  const [isDemo, setIsDemo] = useState(shop.isDemo);
  const [limits, setLimits] = useState<Record<keyof AutoLimits, string>>({
    maxPages: String(shop.autoLimits.maxPages ?? 50),
    maxCopies: String(shop.autoLimits.maxCopies ?? 5),
    maxSides: String(shop.autoLimits.maxSides ?? 250),
    maxQueueDepth: String(shop.autoLimits.maxQueueDepth ?? 10),
  });
  const { busy, error, run } = useAction();
  const [saved, setSaved] = useState(false);

  function patch(): AdminShopUpdateRequest {
    const p: AdminShopUpdateRequest = {};
    const contact = phone.trim() || null;
    if (contact !== shop.contactPhone) p.contactPhone = contact;
    if (mode !== shop.approvalMode) p.approvalMode = mode;
    if (paused !== shop.autoPaused) p.autoPaused = paused;
    if (!admin) return p;
    if (name.trim() !== shop.name) p.name = name.trim();
    if (status !== shop.status) p.status = status;
    if (isDemo !== shop.isDemo) p.isDemo = isDemo;
    const nextLimits = Object.fromEntries(
      Object.entries(limits).map(([k, v]) => [k, Number.parseInt(v, 10)]),
    ) as AutoLimits;
    if (JSON.stringify(nextLimits) !== JSON.stringify({ ...shop.autoLimits })) {
      p.autoLimits = nextLimits;
    }
    return p;
  }

  async function save() {
    setSaved(false);
    const body = patch();
    if (Object.keys(body).length === 0) return setSaved(true);
    const res = await run(() => adminApi.updateShop(shop.id, body));
    if (res) {
      onSaved(res);
      setSaved(true);
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card title="Details">
        <div className="space-y-3">
          {admin ? (
            <Input label="Name" value={name} onChange={setName} />
          ) : (
            <Facts items={[['Name', shop.name]]} />
          )}
          <Facts
            items={[
              ['Address', shop.address ?? 'Not set yet'],
              [
                'Map location',
                shop.latitude !== null && shop.longitude !== null ? (
                  <a
                    key="map"
                    className="text-accent"
                    href={`https://www.google.com/maps?q=${shop.latitude},${shop.longitude}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {shop.latitude.toFixed(5)}, {shop.longitude.toFixed(5)}
                  </a>
                ) : (
                  'Not set yet'
                ),
              ],
            ]}
          />
          <p className="text-[12px] text-text-secondary">
            The shop owner sets the location and address in the Kaggaz Shop app.
          </p>
          <Input
            label="Contact phone (E.164)"
            value={phone}
            onChange={setPhone}
            placeholder="+919876543210"
          />
          <Facts
            items={[
              ['Slug', <code key="s">{shop.slug}</code>],
              ['Created', fmtDateTime(shop.createdAt)],
            ]}
          />
          {admin && (
            <div className="flex items-center justify-between pt-1">
              <span className="text-[13px]">Demo shop</span>
              <Toggle checked={isDemo} onChange={setIsDemo} label="Demo shop" />
            </div>
          )}
        </div>
      </Card>

      <Card title="Operations">
        <div className="space-y-4">
          <div>
            <div className="mb-1.5 text-[12px] text-text-secondary">Status</div>
            <SegmentedControl
              label="Shop status"
              value={status}
              onChange={setStatus}
              disabled={!admin}
              options={[
                { value: 'OPEN', label: 'Open' },
                { value: 'CLOSED', label: 'Closed' },
                { value: 'MAINTENANCE', label: 'Maintenance' },
              ]}
            />
          </div>
          <div>
            <div className="mb-1.5 text-[12px] text-text-secondary">Approval mode</div>
            <SegmentedControl
              label="Approval mode"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'MANUAL', label: 'Manual' },
                { value: 'AUTO', label: 'Auto' },
              ]}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-[13px]">Pause auto-accept</div>
              <div className="text-[12px] text-text-secondary">
                New orders wait for the operator.
              </div>
            </div>
            <Toggle checked={paused} onChange={setPaused} label="Pause auto-accept" />
          </div>
          <div>
            <div className="mb-1.5 text-[12px] text-text-secondary">Auto-accept limits</div>
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  ['maxPages', 'Max pages'],
                  ['maxCopies', 'Max copies'],
                  ['maxSides', 'Max printed sides'],
                  ['maxQueueDepth', 'Max queue depth'],
                ] as const
              ).map(([key, label]) =>
                admin ? (
                  <Input
                    key={key}
                    label={label}
                    type="number"
                    min="1"
                    value={limits[key]}
                    onChange={(v) => setLimits((l) => ({ ...l, [key]: v }))}
                  />
                ) : (
                  <Facts key={key} items={[[label, limits[key]]]} />
                ),
              )}
            </div>
          </div>
        </div>
      </Card>

      <div className="flex items-center gap-3 lg:col-span-2">
        <Button variant="primary" busy={busy} onClick={() => void save()}>
          Save changes
        </Button>
        {saved && !error && <span className="text-[13px] text-green">Saved</span>}
        {!admin && (
          <span className="text-[12px] text-text-secondary">
            Name, status and limits are managed by Kaggaz.
          </span>
        )}
      </div>
      <div className="lg:col-span-2">
        <ErrorNote error={error} />
      </div>
    </div>
  );
}

// ─── Opening hours ───

const DAY_LABEL: Record<OpeningDay, string> = {
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
};

export function HoursSection({
  shop,
  onSaved,
}: {
  shop: AdminShopDetail;
  onSaved: (s: AdminShopDetail) => void;
}) {
  const [hours, setHours] = useState<Record<OpeningDay, [string, string][]>>(
    () =>
      Object.fromEntries(OPENING_DAYS.map((d) => [d, shop.openingHours[d] ?? []])) as Record<
        OpeningDay,
        [string, string][]
      >,
  );
  const { busy, error, run } = useAction();
  const [saved, setSaved] = useState(false);

  const setDay = (d: OpeningDay, v: [string, string][]) => {
    setSaved(false);
    setHours((h) => ({ ...h, [d]: v }));
  };

  async function save() {
    const res = await run(() =>
      adminApi.updateShop(shop.id, { openingHours: hours as OpeningHours }),
    );
    if (res) {
      onSaved(res);
      setSaved(true);
    }
  }

  return (
    <Card
      title="Opening hours"
      actions={<span className="text-[12px] text-text-secondary">Asia/Kolkata</span>}
      flush
    >
      <div className="divide-y divide-separator">
        {OPENING_DAYS.map((d) => {
          const intervals = hours[d];
          const open = intervals.length > 0;
          return (
            <div key={d} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              <div className="w-28 text-[13px] font-medium">{DAY_LABEL[d]}</div>
              <Toggle
                checked={open}
                label={`${DAY_LABEL[d]} open`}
                onChange={(v) => setDay(d, v ? [['09:00', '20:00']] : [])}
              />
              {!open && <span className="text-[13px] text-text-secondary">Closed</span>}
              <div className="flex flex-wrap items-center gap-2">
                {intervals.map(([a, b], i) => (
                  <div
                    key={i}
                    className="flex items-center gap-1 rounded-lg bg-selection px-2 py-1"
                  >
                    <input
                      type="time"
                      aria-label={`${DAY_LABEL[d]} opens`}
                      value={a}
                      onChange={(e) =>
                        setDay(
                          d,
                          intervals.map((iv, j) => (j === i ? [e.target.value, iv[1]] : iv)),
                        )
                      }
                      className="bg-transparent text-[13px] tabular-nums outline-none"
                    />
                    <span className="text-text-secondary">–</span>
                    <input
                      type="time"
                      aria-label={`${DAY_LABEL[d]} closes`}
                      value={b}
                      onChange={(e) =>
                        setDay(
                          d,
                          intervals.map((iv, j) => (j === i ? [iv[0], e.target.value] : iv)),
                        )
                      }
                      className="bg-transparent text-[13px] tabular-nums outline-none"
                    />
                    {intervals.length > 1 && (
                      <button
                        type="button"
                        aria-label="Remove interval"
                        className="ml-1 text-text-secondary hover:text-red"
                        onClick={() =>
                          setDay(
                            d,
                            intervals.filter((_, j) => j !== i),
                          )
                        }
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
                {open && intervals.length < 4 && (
                  <button
                    type="button"
                    className="text-[12px] text-accent hover:underline"
                    onClick={() => setDay(d, [...intervals, ['17:00', '20:00']])}
                  >
                    + Add break
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-3 border-t border-separator px-4 py-3">
        <Button variant="primary" busy={busy} onClick={() => void save()}>
          Save hours
        </Button>
        {saved && <span className="text-[13px] text-green">Saved</span>}
      </div>
      <div className="px-4 pb-3">
        <ErrorNote error={error} />
      </div>
    </Card>
  );
}

// ─── Pricing ───

/** "12.50" → 1250 paise with integer math only (never floats for money). */
export function toPaise(input: string): number | null {
  const m = /^(\d{1,6})(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!m) return null;
  return Number.parseInt(m[1]!, 10) * 100 + Number.parseInt((m[2] ?? '0').padEnd(2, '0'), 10);
}

const fromPaise = (p: number | null | undefined) =>
  p === null || p === undefined ? '' : `${Math.floor(p / 100)}.${String(p % 100).padStart(2, '0')}`;

export function PricingSection({ shopId }: { shopId: string }) {
  const { data, error, loading, reload } = useLoad(() => adminApi.pricing(shopId), [shopId]);
  const current = data?.versions.find((v) => v.current);
  const [form, setForm] = useState<Record<string, string> | null>(null);
  const [rule, setRule] = useState<'SAME_AS_SIMPLEX' | 'DISCOUNTED_SIDE_RATE'>('SAME_AS_SIMPLEX');
  const action = useAction();

  const f = form ?? {
    mono: fromPaise(current?.monoRatePaise),
    colour: fromPaise(current?.colourRatePaise),
    monoDuplex: fromPaise(current?.monoDuplexRatePaise),
    colourDuplex: fromPaise(current?.colourDuplexRatePaise),
    minimum: fromPaise(current?.minimumChargePaise),
    effectiveFrom: '',
  };
  const set = (k: string) => (v: string) => setForm({ ...f, [k]: v });

  async function create() {
    const mono = toPaise(f.mono!);
    const colour = toPaise(f.colour!);
    const minimum = toPaise(f.minimum || '0');
    const monoDuplex = rule === 'DISCOUNTED_SIDE_RATE' ? toPaise(f.monoDuplex!) : null;
    const colourDuplex = rule === 'DISCOUNTED_SIDE_RATE' ? toPaise(f.colourDuplex!) : null;
    if (
      mono === null ||
      colour === null ||
      minimum === null ||
      (rule === 'DISCOUNTED_SIDE_RATE' && (monoDuplex === null || colourDuplex === null))
    ) {
      action.setError(new Error('Enter rupee amounts like 2 or 2.50'));
      return;
    }
    const res = await action.run(() =>
      adminApi.createPricing(shopId, {
        monoRatePaise: mono,
        colourRatePaise: colour,
        monoDuplexRatePaise: monoDuplex,
        colourDuplexRatePaise: colourDuplex,
        duplexRule: rule,
        minimumChargePaise: minimum,
        ...(f.effectiveFrom ? { effectiveFrom: new Date(f.effectiveFrom).toISOString() } : {}),
      }),
    );
    if (res) {
      setForm(null);
      await reload();
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[2fr_3fr]">
      <Card title="New pricing version">
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="B/W per side (₹)"
            value={f.mono!}
            onChange={set('mono')}
            inputMode="decimal"
          />
          <Input
            label="Colour per side (₹)"
            value={f.colour!}
            onChange={set('colour')}
            inputMode="decimal"
          />
          <div className="col-span-2">
            <div className="mb-1.5 text-[12px] text-text-secondary">Double-sided</div>
            <SegmentedControl
              label="Duplex rule"
              value={rule}
              onChange={setRule}
              options={[
                { value: 'SAME_AS_SIMPLEX', label: 'Same rate' },
                { value: 'DISCOUNTED_SIDE_RATE', label: 'Discounted' },
              ]}
            />
          </div>
          {rule === 'DISCOUNTED_SIDE_RATE' && (
            <>
              <Input
                label="B/W duplex side (₹)"
                value={f.monoDuplex!}
                onChange={set('monoDuplex')}
                inputMode="decimal"
              />
              <Input
                label="Colour duplex side (₹)"
                value={f.colourDuplex!}
                onChange={set('colourDuplex')}
                inputMode="decimal"
              />
            </>
          )}
          <Input
            label="Minimum charge (₹)"
            value={f.minimum!}
            onChange={set('minimum')}
            inputMode="decimal"
          />
          <Input
            label="Effective from (blank = now)"
            type="datetime-local"
            value={f.effectiveFrom!}
            onChange={set('effectiveFrom')}
          />
        </div>
        <div className="mt-4">
          <Button variant="primary" busy={action.busy} onClick={() => void create()}>
            Create version
          </Button>
        </div>
        <ErrorNote error={action.error} />
        <p className="mt-3 text-[12px] text-text-secondary">
          Paid orders keep the price they were charged; only new quotes use the new version.
        </p>
      </Card>

      <Card title="Versions" flush>
        <ErrorNote error={error} />
        {loading && !data ? (
          <Loading />
        ) : !data || data.versions.length === 0 ? (
          <Empty>No pricing yet — the shop can’t take orders.</Empty>
        ) : (
          <Table head={['Effective from', 'B/W', 'Colour', 'Duplex', 'Minimum', '']}>
            {data.versions.map((v) => (
              <tr key={v.id}>
                <Td>{fmtDateTime(v.effectiveFrom)}</Td>
                <Td className="tabular-nums">{rupees(v.monoRatePaise)}</Td>
                <Td className="tabular-nums">{rupees(v.colourRatePaise)}</Td>
                <Td className="tabular-nums">
                  {v.duplexRule === 'SAME_AS_SIMPLEX'
                    ? 'Same'
                    : `${rupees(v.monoDuplexRatePaise)} / ${rupees(v.colourDuplexRatePaise)}`}
                </Td>
                <Td className="tabular-nums">{rupees(v.minimumChargePaise)}</Td>
                <Td>
                  {v.current ? (
                    <Pill tone="green">Current</Pill>
                  ) : Date.parse(v.effectiveFrom) > Date.now() ? (
                    <Pill tone="accent">Scheduled</Pill>
                  ) : (
                    <span className="text-[12px] text-text-secondary">Past</span>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

// ─── Printers ───

export function PrintersSection({ shopId }: { shopId: string }) {
  const { data, error, loading, reload } = useLoad(() => adminApi.printers(shopId), [shopId]);
  const action = useAction();

  async function update(printerId: string, body: { enabled?: boolean; isDefault?: true }) {
    if (await action.run(() => adminApi.updatePrinter(shopId, printerId, body))) await reload();
  }

  return (
    <Card title="Printers" flush>
      <ErrorNote error={error ?? action.error} />
      {loading && !data ? (
        <Loading />
      ) : !data || data.printers.length === 0 ? (
        <Empty>No printers yet. The shop app registers them after pairing.</Empty>
      ) : (
        <Table head={['Printer', 'Status', 'Capabilities', 'Queue', 'Enabled', 'Default']}>
          {data.printers.map((p) => (
            <tr key={p.id}>
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
                <div className="text-[12px] text-text-secondary">{fmtAgo(p.lastStatusAt)}</div>
              </Td>
              <Td>
                {[
                  p.colourCapable ? 'Colour' : 'B/W',
                  p.duplexCapable ? 'Duplex' : 'Single-sided',
                ].join(' · ')}
                {!p.capabilitiesConfirmed && (
                  <div>
                    <Pill tone="orange">Not confirmed</Pill>
                  </div>
                )}
              </Td>
              <Td className="tabular-nums">{p.queueDepth}</Td>
              <Td>
                <Toggle
                  checked={p.enabled}
                  label={`${p.displayName} enabled`}
                  disabled={action.busy}
                  onChange={(v) => void update(p.id, { enabled: v })}
                />
              </Td>
              <Td>
                {p.isDefault ? (
                  <Pill tone="accent">Default</Pill>
                ) : (
                  <Button
                    disabled={action.busy}
                    onClick={() => void update(p.id, { isDefault: true })}
                  >
                    Make default
                  </Button>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

// ─── Devices + enrollment codes ───

export function DevicesSection({ shopId }: { shopId: string }) {
  const devices = useLoad(() => adminApi.devices(shopId), [shopId]);
  const codes = useLoad(() => adminApi.enrollmentCodes(shopId), [shopId]);
  const action = useAction();
  const [fresh, setFresh] = useState<AdminEnrollmentCodeCreated | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  async function generate() {
    const res = await action.run(() => adminApi.createEnrollmentCode(shopId));
    if (res) {
      setFresh(res);
      await codes.reload();
    }
  }
  async function revoke(deviceId: string) {
    if (await action.run(() => adminApi.revokeDevice(shopId, deviceId))) {
      setConfirming(null);
      await devices.reload();
    }
  }

  return (
    <div className="space-y-5">
      <ErrorNote error={action.error} />
      <Card
        title="Pair a shop PC"
        actions={
          <Button variant="primary" busy={action.busy} onClick={() => void generate()}>
            Generate pairing code
          </Button>
        }
      >
        {fresh ? (
          <div className="flex flex-wrap items-center gap-4">
            <code className="rounded-xl bg-selection px-4 py-2 font-mono text-[26px] font-semibold tracking-[0.2em]">
              {fresh.code}
            </code>
            <div className="text-[13px] text-text-secondary">
              Enter this in the Kaggaz app on the shop PC.
              <br />
              Single use · expires {fmtDateTime(fresh.expiresAt)}. It won’t be shown again.
            </div>
          </div>
        ) : (
          <p className="text-[13px] text-text-secondary">
            Codes are single-use and expire after 30 minutes. Only a hash is stored.
          </p>
        )}
      </Card>

      <Card title="Devices" flush>
        <ErrorNote error={devices.error} />
        {devices.loading && !devices.data ? (
          <Loading />
        ) : !devices.data || devices.data.devices.length === 0 ? (
          <Empty>No paired devices.</Empty>
        ) : (
          <Table head={['Device', 'Health', 'App version', 'Last heartbeat', 'Operator', '']}>
            {devices.data.devices.map((d) => (
              <tr key={d.id} className={d.status === 'REVOKED' ? 'opacity-60' : ''}>
                <Td>
                  <div className="font-medium">{d.name}</div>
                  <div className="text-[12px] text-text-secondary">
                    Paired {fmtDateTime(d.createdAt)}
                  </div>
                </Td>
                <Td>
                  <Pill tone={healthTone(d.health)}>{humanize(d.health)}</Pill>
                </Td>
                <Td mono>{d.appVersion ?? '—'}</Td>
                <Td>
                  {d.status === 'REVOKED'
                    ? `Revoked ${fmtDateTime(d.revokedAt)}`
                    : fmtAgo(d.lastHeartbeatAt)}
                </Td>
                <Td>{d.activeOperator?.name ?? <span className="text-text-secondary">—</span>}</Td>
                <Td>
                  {d.status === 'ACTIVE' &&
                    (confirming === d.id ? (
                      <span className="inline-flex gap-1.5">
                        <Button
                          variant="danger"
                          busy={action.busy}
                          onClick={() => void revoke(d.id)}
                        >
                          Confirm revoke
                        </Button>
                        <Button onClick={() => setConfirming(null)}>Cancel</Button>
                      </span>
                    ) : (
                      <Button variant="danger" onClick={() => setConfirming(d.id)}>
                        Revoke
                      </Button>
                    ))}
                </Td>
              </tr>
            ))}
          </Table>
        )}
        {confirming && (
          <div className="px-4 pb-3">
            <Notice tone="orange">
              Revoking signs the operator out and stops this PC immediately. It must be re-paired
              with a new code.
            </Notice>
          </div>
        )}
      </Card>

      <Card title="Recent pairing codes" flush>
        {!codes.data || codes.data.codes.length === 0 ? (
          <Empty>No codes yet.</Empty>
        ) : (
          <Table head={['Created', 'State', 'Expires', 'Used']}>
            {codes.data.codes.map((c) => (
              <tr key={c.id}>
                <Td>{fmtDateTime(c.createdAt)}</Td>
                <Td>
                  <Pill
                    tone={
                      c.state === 'ACTIVE' ? 'green' : c.state === 'USED' ? 'accent' : 'neutral'
                    }
                  >
                    {humanize(c.state)}
                  </Pill>
                </Td>
                <Td>{fmtDateTime(c.expiresAt)}</Td>
                <Td>{fmtDateTime(c.usedAt)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

/**
 * Shop logins (owners/operators): mobile number + password, used in the Kaggaz Shop app and,
 * for owners, in this dashboard. Adding an existing number again resets its password.
 */
export function MembersSection({
  shop,
  admin,
  onSaved,
}: {
  shop: AdminShopDetail;
  admin: boolean;
  onSaved: (s: AdminShopDetail) => void;
}) {
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'SHOP_OWNER' | 'SHOP_OPERATOR'>('SHOP_OPERATOR');
  const [confirming, setConfirming] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const action = useAction();

  async function add() {
    setSaved(null);
    const res = await action.run(() =>
      adminApi.addMember(shop.id, {
        phone,
        name,
        password,
        role: admin ? role : 'SHOP_OPERATOR',
      }),
    );
    if (res) {
      onSaved(res);
      setSaved(`Saved. They sign in with ${phone.trim()} and the password you set.`);
      setPhone('');
      setName('');
      setPassword('');
    }
  }
  async function remove(userId: string) {
    const res = await action.run(() => adminApi.removeMember(shop.id, userId));
    if (res) {
      onSaved(res);
      setConfirming(null);
    }
  }

  return (
    <div className="space-y-5">
      <ErrorNote error={action.error} />
      <Card title="Add a login">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="Mobile number"
            value={phone}
            onChange={setPhone}
            placeholder="98765 43210"
            inputMode="numeric"
            autoComplete="off"
          />
          <Input
            label="Name"
            value={name}
            onChange={setName}
            placeholder="Raju"
            autoComplete="off"
          />
          <Input
            label="Password (min 8 characters)"
            value={password}
            onChange={setPassword}
            type="password"
            autoComplete="new-password"
          />
          {admin && (
            <div>
              <div className="mb-1 text-[12px] font-medium text-text-secondary">Role</div>
              <SegmentedControl
                label="Role"
                value={role}
                onChange={setRole}
                options={[
                  { value: 'SHOP_OPERATOR', label: 'Operator' },
                  { value: 'SHOP_OWNER', label: 'Owner' },
                ]}
              />
            </div>
          )}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button variant="primary" busy={action.busy} onClick={() => void add()}>
            Save login
          </Button>
          <span className="text-[12px] text-text-secondary">
            They sign in to the Kaggaz Shop app on the shop PC with this mobile number. Adding an
            existing number again resets its password.
          </span>
        </div>
        {saved && <p className="mt-3 text-[13px] text-green">{saved}</p>}
      </Card>

      <Card title="Logins" flush>
        {shop.members.length === 0 ? (
          <Empty>No logins yet. Add the shop owner first.</Empty>
        ) : (
          <Table head={['Name', 'Mobile', 'Role', '']}>
            {shop.members.map((m) => (
              <tr key={m.userId}>
                <Td>{m.name ?? '—'}</Td>
                <Td mono>{m.phone ?? m.email ?? '—'}</Td>
                <Td>{m.role === 'SHOP_OWNER' ? 'Owner' : 'Operator'}</Td>
                <Td>
                  {(admin || m.role === 'SHOP_OPERATOR') &&
                    (confirming === m.userId ? (
                      <span className="inline-flex gap-1.5">
                        <Button
                          variant="danger"
                          busy={action.busy}
                          onClick={() => void remove(m.userId)}
                        >
                          Confirm remove
                        </Button>
                        <Button onClick={() => setConfirming(null)}>Cancel</Button>
                      </span>
                    ) : (
                      <Button variant="danger" onClick={() => setConfirming(m.userId)}>
                        Remove
                      </Button>
                    ))}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}
