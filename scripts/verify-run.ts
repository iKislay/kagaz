/**
 * T18 post-run verifier (P4.7). Reads a load-orders manifest and checks the database directly:
 * no lost orders, no duplicate (order, attempt) print jobs, no cross-tenant jobs/actions,
 * payments == paid transitions, consistent event chains, READY only by a human/device action,
 * one-time pickup, refund records for rejected paid orders. Writes a markdown report.
 *
 *   pnpm verify:run -- --manifest <path> [--out docs/testing/T18-load-run.md]
 *
 * Exit code 1 when any check fails.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type AgentState, readAgentState } from './lib/agent-state.js';
import { REPO_ROOT, cliArgs, fmtMs, loadRootEnv, percentile } from './lib/common.js';
import { dbName, openDb } from './lib/db.js';
import { type Manifest } from './lib/manifest.js';

loadRootEnv();
const args = cliArgs({
  manifest: { type: 'string' },
  out: { type: 'string' },
});
if (!args.manifest) {
  console.error('Usage: pnpm verify:run -- --manifest <path> [--out <report.md>]');
  process.exit(2);
}

const PAID_TO = new Set(['PENDING_REVIEW', 'QUEUED']);
const SETTLED = new Set([
  'READY_FOR_PICKUP',
  'COLLECTED',
  'NEEDS_OPERATOR_CHECK',
  'REJECTED',
  'REFUND_PENDING',
  'REFUNDED',
]);
/** Payment states that mean money was captured (a refund keeps it counted as paid once). */
const CAPTURED = new Set(['PAID', 'REFUND_PENDING', 'REFUNDED']);
const ACTIVE_JOB = new Set(['PREPARING', 'READY', 'LEASED', 'SUBMITTED']);

interface Check {
  name: string;
  pass: boolean;
  detail: string;
  violations: string[];
}

async function main(): Promise<void> {
  const manifest = JSON.parse(readFileSync(args.manifest!, 'utf8')) as Manifest;
  const db = openDb();
  const checks: Check[] = [];
  const check = (name: string, violations: string[], detail: string) =>
    checks.push({ name, pass: violations.length === 0, detail, violations });

  const placed = manifest.orders.filter((o) => o.orderId);
  const ids = placed.map((o) => o.orderId);
  const orders = await db.order.findMany({
    where: { id: { in: ids } },
    include: {
      payments: true,
      events: { orderBy: { id: 'asc' } },
      printJobs: { include: { printer: { select: { shopId: true } } } },
    },
  });
  const byId = new Map(orders.map((o) => [o.id, o]));
  const devices = new Map(
    (await db.shopDevice.findMany({ select: { id: true, shopId: true } })).map((d) => [
      d.id,
      d.shopId,
    ]),
  );
  const refunds = await db.refund.findMany({
    where: { payment: { orderId: { in: ids } } },
    select: { payment: { select: { orderId: true } }, status: true },
  });
  const refundedOrders = new Set(refunds.map((r) => r.payment.orderId));
  const audits = await db.auditLog.findMany({
    where: { orderId: { in: ids } },
    select: { orderId: true, shopId: true, actorType: true, actorId: true, action: true },
  });

  // 1. No lost orders.
  const lost: string[] = [];
  const notPlaced = manifest.orders.filter((o) => !o.orderId);
  for (const o of notPlaced) lost.push(`order #? (${o.shopSlug}) never created: ${o.error}`);
  for (const m of placed) {
    const o = byId.get(m.orderId);
    if (!o) {
      lost.push(`${m.publicRef}: missing from the database`);
      continue;
    }
    const paidPayments = o.payments.filter((p) => CAPTURED.has(p.status)).length;
    if (m.abandoned) {
      if (o.status !== 'AWAITING_PAYMENT' || paidPayments || o.printJobs.length)
        lost.push(`${m.publicRef}: abandoned (unpaid) order is ${o.status} with jobs/payments`);
    } else if (m.paidAt) {
      if (paidPayments !== 1) lost.push(`${m.publicRef}: ${paidPayments} captured payments`);
      if (!SETTLED.has(o.status) && o.status !== 'CANCELLED')
        lost.push(`${m.publicRef}: still ${o.status} after the run (stuck)`);
    } else {
      lost.push(`${m.publicRef}: placement failed (${m.error}) — status ${o.status}`);
    }
  }
  check(
    'No lost orders',
    lost,
    `${placed.length}/${manifest.requested} created; every paid order has exactly one captured (PAID or later refunded) payment and reached a settled state; unpaid orders never reached a shop.`,
  );

  // 2. No duplicate print jobs.
  const dupes: string[] = [];
  for (const o of orders) {
    const attempts = new Map<number, number>();
    for (const j of o.printJobs) attempts.set(j.attempt, (attempts.get(j.attempt) ?? 0) + 1);
    for (const [a, n] of attempts) if (n > 1) dupes.push(`${o.publicRef}: attempt ${a} ×${n}`);
    const active = o.printJobs.filter((j) => ACTIVE_JOB.has(j.status));
    if (active.length > 1) dupes.push(`${o.publicRef}: ${active.length} active attempts`);
    const sorted = [...o.printJobs].sort((a, b) => a.attempt - b.attempt);
    for (const [i, j] of sorted.entries()) {
      if (j.attempt !== i + 1) dupes.push(`${o.publicRef}: attempt numbering gap at ${j.attempt}`);
      if (i < sorted.length - 1 && !['SUPERSEDED', 'FAILED', 'UNCERTAIN'].includes(j.status))
        dupes.push(`${o.publicRef}: attempt ${j.attempt} is ${j.status} but a newer one exists`);
    }
  }
  const totalJobs = orders.reduce((n, o) => n + o.printJobs.length, 0);
  check(
    'No duplicate (order, attempt) print jobs',
    dupes,
    `${totalJobs} print-job attempts; ≤ 1 active attempt per order; retries only after a failed/superseded attempt.`,
  );

  // 3. Tenant isolation.
  const cross: string[] = [];
  for (const o of orders) {
    for (const j of o.printJobs) {
      if (j.printer.shopId !== o.shopId)
        cross.push(`${o.publicRef}: job on another shop's printer`);
      if (j.leasedByDeviceId && devices.get(j.leasedByDeviceId) !== o.shopId)
        cross.push(`${o.publicRef}: job leased by another shop's device`);
    }
    for (const e of o.events) {
      if (e.actorType === 'DEVICE' && e.actorId && devices.get(e.actorId) !== o.shopId)
        cross.push(`${o.publicRef}: ${e.toStatus} by a device of another shop`);
    }
  }
  for (const a of audits) {
    const o = byId.get(a.orderId!);
    if (o && a.shopId && a.shopId !== o.shopId)
      cross.push(`${o.publicRef}: audit ${a.action} in another shop`);
    if (o && a.actorType === 'DEVICE' && a.actorId && devices.get(a.actorId) !== o.shopId)
      cross.push(`${o.publicRef}: audit ${a.action} by another shop's device`);
  }
  check(
    'No cross-tenant jobs or actions',
    cross,
    'Printer, leasing device and acting devices (order events + audit log) all belong to the order’s shop.',
  );

  // 4. Payments == paid transitions.
  const payMismatch: string[] = [];
  let paidPayments = 0;
  let paidTransitions = 0;
  for (const o of orders) {
    const p = o.payments.filter((x) => CAPTURED.has(x.status)).length;
    const t = o.events.filter(
      (e) => e.fromStatus === 'AWAITING_PAYMENT' && PAID_TO.has(e.toStatus),
    ).length;
    paidPayments += p;
    paidTransitions += t;
    if (p !== t)
      payMismatch.push(`${o.publicRef}: ${p} captured payments vs ${t} paid transitions`);
    if (o.payments.some((x) => !x.isSimulated))
      payMismatch.push(`${o.publicRef}: non-simulated payment in a demo run`);
  }
  check(
    'Payments == paid transitions',
    payMismatch,
    `${paidPayments} captured payments (PAID or refunded), ${paidTransitions} AWAITING_PAYMENT → paid transitions (incl. ${placed.filter((m) => m.doublePay).length} double-clicked Pay).`,
  );

  // 5. Event chains.
  const chain: string[] = [];
  for (const o of orders) {
    let prev: string | null = null;
    for (const [i, e] of o.events.entries()) {
      if (i === 0 ? e.fromStatus !== null : e.fromStatus !== prev)
        chain.push(`${o.publicRef}: event ${i} from ${e.fromStatus} after ${prev}`);
      prev = e.toStatus;
    }
    if (prev !== o.status) chain.push(`${o.publicRef}: last event ${prev} ≠ status ${o.status}`);
  }
  check(
    'Order event chains are complete',
    chain,
    'Every status change has an OrderEvent; each event starts where the previous ended and the last matches the order.',
  );

  // 6. ADR-002: READY only from a finished print (SYSTEM) or an operator's CONFIRM_PRINTED;
  //    every paid order has one pickup number, unique per shop and business date; refunds.
  const rules: string[] = [];
  const numbers = new Map<string, string>();
  for (const o of orders) {
    for (const e of o.events.filter((x) => x.toStatus === 'READY_FOR_PICKUP')) {
      const ok =
        (e.fromStatus === 'PRINTING' && e.actorType === 'SYSTEM') ||
        (e.fromStatus === 'NEEDS_OPERATOR_CHECK' && e.actorType !== 'SYSTEM');
      if (!ok) rules.push(`${o.publicRef}: READY from ${e.fromStatus} by ${e.actorType}`);
    }
    if (o.paidAt && (o.pickupNumber === null || o.pickupDate === null))
      rules.push(`${o.publicRef}: paid without a pickup number`);
    if (o.pickupNumber !== null && o.pickupDate) {
      const key = `${o.shopId}|${o.pickupDate.toISOString().slice(0, 10)}|${o.pickupNumber}`;
      const other = numbers.get(key);
      if (other) rules.push(`${o.publicRef}: pickup number #${o.pickupNumber} also on ${other}`);
      numbers.set(key, o.publicRef);
    }
    const wasPaid = o.payments.some((p) => CAPTURED.has(p.status));
    if (
      ['REJECTED', 'REFUND_PENDING', 'REFUNDED'].includes(o.status) &&
      wasPaid &&
      !refundedOrders.has(o.id)
    )
      rules.push(`${o.publicRef}: ${o.status} paid order without a refund record`);
  }
  check(
    'Business rules (ADR-002 auto-ready, pickup numbers, refunds)',
    rules,
    'READY_FOR_PICKUP comes only from PRINTING (SYSTEM, print finished) or from NEEDS_OPERATOR_CHECK (operator); every paid order has a pickup number unique per shop and day; rejected paid orders have a refund.',
  );

  // ─── Report ───
  const statuses = [...new Set(orders.map((o) => o.status))].sort();
  const table = [
    `| Shop | ${statuses.join(' | ')} | Total |`,
    `| --- | ${statuses.map(() => '---:').join(' | ')} | ---: |`,
    ...manifest.shops.map((s) => {
      const mine = orders.filter((o) => o.shopId === s.id);
      return `| ${s.slug} | ${statuses.map((st) => mine.filter((o) => o.status === st).length).join(' | ')} | ${mine.length} |`;
    }),
    `| **All** | ${statuses.map((st) => orders.filter((o) => o.status === st).length).join(' | ')} | ${orders.length} |`,
  ];

  const at = (o: (typeof orders)[number], to: string) =>
    o.events.find((e) => e.toStatus === to)?.createdAt.getTime();
  const paidToReady: number[] = [];
  const readyToCollected: number[] = [];
  for (const o of orders) {
    const paid = o.events.find((e) => e.fromStatus === 'AWAITING_PAYMENT')?.createdAt.getTime();
    const ready = at(o, 'READY_FOR_PICKUP');
    const collected = at(o, 'COLLECTED');
    if (paid && ready) paidToReady.push(ready - paid);
    if (ready && collected) readyToCollected.push(collected - ready);
  }
  const placeMs =
    Date.parse(manifest.placedAt ?? manifest.startedAt) - Date.parse(manifest.startedAt);
  const totalMs =
    Date.parse(manifest.finishedAt ?? manifest.startedAt) - Date.parse(manifest.startedAt);

  const agents = manifest.shops
    .map((s) => readAgentState(manifest.api, s.slug))
    .filter((a): a is AgentState => a !== null);
  const agentRows = agents.map((a) => {
    const st = a.stats;
    return `| ${a.shopSlug} | ${st.accepted} | ${st.rejected} | ${st.leased} | ${st.printed} | ${st.printFailed} | ${st.ready} | ${st.hints['job.created'] ?? 0} | ${st.hints['job.updated'] ?? 0} | ${st.heartbeats} | ${
      Object.entries(st.errors)
        .map(([k, v]) => `${k}×${v}`)
        .join(', ') || '—'
    } |`;
  });

  const passed = checks.every((c) => c.pass);
  const md = [
    `# T18 — load run (${manifest.requested} orders, 3 shops)`,
    '',
    `**Result: ${passed ? 'PASS' : 'FAIL'}** — generated by \`scripts/verify-run.ts\` on ${new Date().toISOString()}.`,
    '',
    '## Setup',
    '',
    `- API: \`${manifest.api}\` (database \`${dbName()}\`), DEMO payments (mock provider, no money moved).`,
    `- Run \`${manifest.runId}\`: ${placed.length} orders created through the public API (create → signed upload → upload-complete → pay), round-robin over ${manifest.shops.map((s) => `\`${s.slug}\``).join(', ')}; mixed copies/colour/duplex/page ranges; ${placed.filter((m) => m.abandoned).length} abandoned before payment; ${placed.filter((m) => m.doublePay).length} with a concurrent double "Pay".`,
    `- Shops worked by \`scripts/sim-agent.ts\` (real device API: pairing, heartbeat, socket hints, accept/reject, lease, download + SHA-256 check, SUBMITTED → SPOOLER_COMPLETE → READY automatically (ADR-002); randomized delays, rejections and print failures — nothing physically printed).`,
    `- Placement took ${fmtMs(placeMs)}; the whole run ${fmtMs(totalMs)}.`,
    '',
    '## Checks',
    '',
    '| Check | Result | What was verified |',
    '| --- | --- | --- |',
    ...checks.map(
      (c) =>
        `| ${c.name} | ${c.pass ? 'PASS' : `**FAIL** (${c.violations.length})`} | ${c.detail} |`,
    ),
    '',
    ...checks
      .filter((c) => !c.pass)
      .flatMap((c) => [
        `### ${c.name} — violations`,
        '',
        ...c.violations.slice(0, 50).map((v) => `- ${v}`),
        '',
      ]),
    '## Orders per shop and final state',
    '',
    ...table,
    '',
    '## Timings (from order events)',
    '',
    `- Paid → READY_FOR_PICKUP: p50 ${fmtMs(percentile(paidToReady, 50))}, p95 ${fmtMs(percentile(paidToReady, 95))}, max ${fmtMs(Math.max(0, ...paidToReady))} (n=${paidToReady.length}).`,
    `- READY → COLLECTED: p50 ${fmtMs(percentile(readyToCollected, 50))}, p95 ${fmtMs(percentile(readyToCollected, 95))} (n=${readyToCollected.length}).`,
    '',
    ...(agentRows.length
      ? [
          '## Simulated agents',
          '',
          '| Shop | Accepted | Rejected | Leased | Printed | Print failed | Ready | `job.created` hints | `job.updated` hints | Heartbeats | API errors (handled) |',
          '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
          ...agentRows,
          '',
          `Realtime: paid → \`job.created\` hint received by the agent: p50 ${fmtMs(
            percentile(
              agents.flatMap((a) => a.stats.hintLatencyMs ?? []),
              50,
            ),
          )}, p95 ${fmtMs(
            percentile(
              agents.flatMap((a) => a.stats.hintLatencyMs ?? []),
              95,
            ),
          )}, max ${fmtMs(Math.max(0, ...agents.flatMap((a) => a.stats.hintLatencyMs ?? [])))} (P2.9 target < 3 s). Agents also safety-poll every 5 s.`,
          '',
        ]
      : []),
    '## Reproduce',
    '',
    '```bash',
    'pnpm sim:agent -- --shop demo-shop-a --api <api> --exit-when-idle 60   # one per shop',
    `pnpm load:orders -- --orders ${manifest.requested} --api <api>`,
    'pnpm verify:run -- --manifest <manifest printed by load:orders> --out docs/testing/T18-load-run.md',
    '```',
    '',
  ].join('\n');

  if (args.out) {
    const out = resolve(REPO_ROOT, args.out);
    writeFileSync(out, md);
    console.log(`Report written to ${out}`);
  } else {
    console.log(md);
  }
  for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}`);
  await db.$disconnect();
  process.exit(passed ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
