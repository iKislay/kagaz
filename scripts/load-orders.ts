/**
 * T18 load generator (P4.7): places N orders across the demo shops through the PUBLIC API —
 * create → signed upload → upload-complete (server quote) → pay with the DEMO provider — with
 * mixed options, then waits for the shop agents (sim-agent / real app) to work them. Orders
 * become READY on their own once printed (ADR-002): there is no pickup step to play.
 *
 *   pnpm load:orders -- [--orders 200] [--api http://localhost:4105/api]
 *        [--shops demo-shop-a,demo-shop-b,demo-shop-c] [--concurrency 8]
 *        [--abandon-rate 0.03] [--double-pay-rate 0.1] [--wait 600]
 *        [--manifest <path>]
 *
 * Writes a run manifest (order ids, shops, outcomes, timings) for verify-run. Tracking tokens
 * are kept in the manifest only for the duration of the run (it lives in the OS temp dir).
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type CreateOrderResponse,
  type OrderStatus,
  type PayResponse,
  type PrintOptions,
  type PublicOrder,
  type ShopSummary,
  type UploadUrlResponse,
} from '@kagaz/shared';
import {
  ApiClient,
  ApiError,
  chance,
  cliArgs,
  defaultApiUrl,
  fmtMs,
  loadRootEnv,
  num,
  percentile,
  pick,
  randInt,
  sleep,
  stateDir,
} from './lib/common.js';
import { type Manifest, type ManifestOrder } from './lib/manifest.js';
import { type SamplePdf, samplePdfs } from './lib/pdfs.js';

loadRootEnv();
const args = cliArgs({
  orders: { type: 'string', default: '200' },
  api: { type: 'string' },
  shops: { type: 'string', default: 'demo-shop-a,demo-shop-b,demo-shop-c' },
  concurrency: { type: 'string', default: '8' },
  'abandon-rate': { type: 'string', default: '0.03' },
  'double-pay-rate': { type: 'string', default: '0.1' },
  wait: { type: 'string', default: '600' },
  manifest: { type: 'string' },
});

const API = (args.api ?? defaultApiUrl()).replace(/\/$/, '');
const TOTAL = num(args.orders, 200);
const CONCURRENCY = Math.max(1, num(args.concurrency, 8));
const ABANDON_RATE = num(args['abandon-rate'], 0.03);
const DOUBLE_PAY_RATE = num(args['double-pay-rate'], 0.1);
const WAIT_MS = num(args.wait, 600) * 1000;
const SETTLED: readonly OrderStatus[] = [
  'READY_FOR_PICKUP',
  'COLLECTED',
  'NEEDS_OPERATOR_CHECK',
  'REJECTED',
  'REFUND_PENDING',
  'REFUNDED',
  'CANCELLED',
];

const client = new ApiClient(API);
const asCustomer = (token: string) => ({ headers: { 'x-tracking-token': token } });

function randomOptions(shop: ShopSummary): PrintOptions {
  const colour = shop.capabilities.colour && chance(0.2);
  const duplex = shop.capabilities.duplex && chance(0.4);
  return { copies: pick([1, 1, 1, 2, 2, 3]), colour, duplex, paperSize: 'A4' };
}

async function placeOne(
  i: number,
  shop: ShopSummary,
  slug: string,
  pdfs: SamplePdf[],
): Promise<ManifestOrder> {
  const pdf = pick(pdfs);
  const options = randomOptions(shop);
  if (pdf.pages >= 3 && chance(0.15)) options.pageRange = `1-${randInt(1, pdf.pages - 1)}`;
  const entry: ManifestOrder = {
    orderId: '',
    publicRef: '',
    shopId: shop.id,
    shopSlug: slug,
    trackingToken: '',
    options,
    pages: pdf.pages,
    amountPaise: null,
    abandoned: chance(ABANDON_RATE),
    doublePay: false,
    paidAt: null,
    readyAt: null,
    collectedAt: null,
    finalStatus: null,
    error: null,
  };
  try {
    const created = await client.call<CreateOrderResponse>('/orders', {
      body: { shopId: shop.id, options },
    });
    entry.orderId = created.order.id;
    entry.publicRef = created.order.publicRef;
    entry.trackingToken = created.trackingToken;
    const tok = asCustomer(created.trackingToken);

    const upload = await client.call<UploadUrlResponse>(`/orders/${entry.orderId}/upload-url`, {
      body: { bytes: pdf.bytes.length },
      ...tok,
    });
    const put = await fetch(upload.uploadUrl, {
      method: upload.method,
      headers: upload.headers,
      body: pdf.bytes,
    });
    if (!put.ok) throw new Error(`storage PUT failed: ${put.status}`);
    const quoted = await client.call<PublicOrder>(`/orders/${entry.orderId}/upload-complete`, {
      body: { fileId: upload.fileId },
      ...tok,
    });
    entry.amountPaise = quoted.amountPaise ?? quoted.quote?.totalPaise ?? null;

    if (entry.abandoned) {
      entry.finalStatus = quoted.status; // customer never pays: must never reach a shop
      return entry;
    }
    // Some customers double-click Pay: both calls must yield ONE payment / ONE paid transition.
    entry.doublePay = chance(DOUBLE_PAY_RATE);
    const pay = () =>
      client.call<PayResponse>(`/orders/${entry.orderId}/pay`, { method: 'POST', ...tok });
    const results = await Promise.all(entry.doublePay ? [pay(), pay()] : [pay()]);
    entry.paidAt = new Date().toISOString();
    entry.finalStatus = results[0]!.order.status;
  } catch (err) {
    entry.error = err instanceof ApiError ? err.code : (err as Error).message;
  }
  if ((i + 1) % 25 === 0) console.log(`  placed ${i + 1}/${TOTAL}`);
  return entry;
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]!);
    }),
  );
}

async function main(): Promise<void> {
  const slugs = args.shops.split(',').map((s) => s.trim());
  const { shops } = await client.call<{ shops: ShopSummary[] }>('/shops');
  const chosen = slugs.map((slug) => {
    const shop = shops.find((s) => s.slug === slug);
    if (!shop) throw new Error(`Shop ${slug} not listed by ${API}/shops (closed or missing?)`);
    return { slug, shop };
  });
  const pdfs = await samplePdfs();
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const manifestPath = args.manifest ?? join(stateDir(API), `load-run-${runId}.json`);
  const manifest: Manifest = {
    runId,
    api: API,
    startedAt: new Date().toISOString(),
    placedAt: null,
    finishedAt: null,
    requested: TOTAL,
    shops: chosen.map((c) => ({ id: c.shop.id, slug: c.slug, name: c.shop.name })),
    orders: [],
    collect: false, // ADR-002: no pickup verification step any more
  };
  const save = () => writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  console.log(
    `Placing ${TOTAL} orders across ${chosen.map((c) => c.slug).join(', ')} ` +
      `(concurrency ${CONCURRENCY}, PDFs: ${pdfs.map((p) => p.name).join(', ')})`,
  );
  const t0 = Date.now();
  const indices = Array.from({ length: TOTAL }, (_, i) => i);
  await pool(indices, CONCURRENCY, async (i) => {
    const { shop, slug } = chosen[i % chosen.length]!; // round-robin: balanced shops
    manifest.orders.push(await placeOne(i, shop, slug, pdfs));
  });
  manifest.placedAt = new Date().toISOString();
  save();
  const failedToPlace = manifest.orders.filter((o) => o.error);
  console.log(
    `Placed ${manifest.orders.length - failedToPlace.length}/${TOTAL} in ${fmtMs(Date.now() - t0)}` +
      (failedToPlace.length ? ` — ${failedToPlace.length} errors` : ''),
  );

  // Wait for the shops to work the paid orders.
  const paid = manifest.orders.filter((o) => o.paidAt && !o.error);
  const deadline = Date.now() + WAIT_MS;
  let lastLine = '';
  while (Date.now() < deadline) {
    await pool(paid, CONCURRENCY, async (o) => {
      if (SETTLED.includes(o.finalStatus!)) return;
      try {
        const view = await client.call<PublicOrder>(
          `/orders/${o.orderId}`,
          asCustomer(o.trackingToken),
        );
        o.finalStatus = view.status;
        if (view.status === 'READY_FOR_PICKUP') o.readyAt ??= new Date().toISOString();
      } catch (err) {
        o.error = err instanceof ApiError ? err.code : (err as Error).message;
      }
    });
    const open = paid.filter((o) => !SETTLED.includes(o.finalStatus!));
    const counts: Record<string, number> = {};
    for (const o of paid) counts[o.finalStatus ?? '?'] = (counts[o.finalStatus ?? '?'] ?? 0) + 1;
    const line = `  ${open.length} in flight · ${JSON.stringify(counts)}`;
    if (line !== lastLine) console.log(line);
    lastLine = line;
    save();
    if (open.length === 0) break;
    await sleep(3000);
  }
  manifest.finishedAt = new Date().toISOString();
  save();

  const ready = paid
    .filter((o) => o.readyAt)
    .map((o) => Date.parse(o.readyAt!) - Date.parse(o.paidAt!));
  console.log(
    `Done in ${fmtMs(Date.now() - t0)}. paid→ready (observed by polling): ` +
      `p50 ${fmtMs(percentile(ready, 50))}, p95 ${fmtMs(percentile(ready, 95))}`,
  );
  console.log(`Manifest: ${manifestPath}`);
  console.log(`Verify:   pnpm verify:run -- --manifest "${manifestPath}"`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
