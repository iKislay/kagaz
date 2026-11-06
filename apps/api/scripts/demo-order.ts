/**
 * Places a paid DEMO order through the real API — the same calls the website makes:
 * create order → signed upload → upload-complete → pay (DemoMockProvider).
 * Useful for testing the shop app before/without the website, and for demo rehearsals.
 *
 *   pnpm --filter @kagaz/api demo:order -- [--shop demo-shop-a] [--pages 3] [--copies 1]
 *                                          [--duplex] [--colour] [--api http://localhost:4000/api]
 *
 * The API must be running (pnpm --filter @kagaz/api dev) with seeded shops (db:seed).
 */
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : 'true';
}

const api = (arg('api', 'http://localhost:4000/api') ?? '').replace(/\/$/, '');
const shopSlug = arg('shop', 'demo-shop-a')!;
const pages = Number(arg('pages', '3'));
const copies = Number(arg('copies', '1'));
const duplex = arg('duplex') === 'true';
const colour = arg('colour') === 'true';

async function call<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const res = await fetch(`${api}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'x-tracking-token': token } : {}),
      ...init.headers,
    },
  });
  const body = (await res.json().catch(() => null)) as T & {
    error?: { code: string; message: string };
  };
  if (!res.ok) {
    throw new Error(
      `${init.method ?? 'GET'} ${path} → ${res.status} ${body?.error?.code}: ${body?.error?.message}`,
    );
  }
  return body;
}

async function samplePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  for (let i = 1; i <= pages; i++) {
    const page = doc.addPage([595.28, 841.89]);
    page.drawText(`Kagaz demo document — page ${i} of ${pages}`, {
      x: 60,
      y: 760,
      size: 20,
      font,
      color: rgb(0.1, 0.1, 0.1),
    });
  }
  return doc.save();
}

async function main() {
  const { shops } = await call<{ shops: Array<{ id: string; slug: string; name: string }> }>(
    '/shops',
  );
  const shop = shops.find((s) => s.slug === shopSlug);
  if (!shop)
    throw new Error(`Shop "${shopSlug}" not found. Known: ${shops.map((s) => s.slug).join(', ')}`);

  const { order, trackingToken } = await call<{
    order: { id: string; publicRef: string };
    trackingToken: string;
  }>('/orders', {
    method: 'POST',
    body: JSON.stringify({ shopId: shop.id, options: { copies, colour, duplex, paperSize: 'A4' } }),
  });

  const pdf = await samplePdf();
  const upload = await call<{ fileId: string; uploadUrl: string; headers: Record<string, string> }>(
    `/orders/${order.id}/upload-url`,
    { method: 'POST', body: JSON.stringify({ bytes: pdf.length }) },
    trackingToken,
  );
  const put = await fetch(upload.uploadUrl, { method: 'PUT', headers: upload.headers, body: pdf });
  if (!put.ok) throw new Error(`Storage upload failed: ${put.status}`);

  const quoted = await call<{ amountPaise: number }>(
    `/orders/${order.id}/upload-complete`,
    { method: 'POST', body: JSON.stringify({ fileId: upload.fileId }) },
    trackingToken,
  );
  const paid = await call<{ order: { status: string } }>(
    `/orders/${order.id}/pay`,
    { method: 'POST' },
    trackingToken,
  );

  console.log(`Order ${order.publicRef} at ${shop.name}`);
  console.log(
    `  ${pages} page(s) × ${copies}, ${colour ? 'colour' : 'B/W'}, ${duplex ? 'double' : 'single'}-sided`,
  );
  console.log(`  ₹${(quoted.amountPaise / 100).toFixed(2)} — DEMO PAYMENT, NO MONEY CHARGED`);
  console.log(`  status: ${paid.order.status}`);
  console.log(`  order id: ${order.id}`);
  console.log(`  tracking token: ${trackingToken}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
