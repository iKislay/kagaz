/**
 * Pilot smoke test (ADR-003, P6.8) — proves a deployed pilot works up to the point where a human
 * pays with a real UPI app. Uses only the public HTTP API, exactly like the shop app and website.
 *
 *   pnpm --filter @kagaz/api pilot:smoke -- --api https://api.<domain>/api --shop <slug> \
 *     --login <owner phone/email> --password <owner password> [--code <PC pairing code>] \
 *     [--upi name@bank --payee "Shop name"]
 *
 * 1. pairs a "Smoke test" device with --code (or reuses KAGAZ_DEVICE_TOKEN), signs the operator in
 * 2. reads (and with --upi saves) the shop's payment setup; shows phone readiness
 * 3. places a ₹ order with a 1-page PDF and starts the UPI checkout
 * 4. prints the checkout URL — open it on a phone and pay to finish the end-to-end test.
 * Revoke the "Smoke test" device afterwards in admin → Devices.
 */
import { PDFDocument, StandardFonts } from 'pdf-lib';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}
const api = (arg('api') ?? 'http://localhost:4000/api').replace(/\/$/, '');
const shopSlug = arg('shop');
const login = arg('login');
const password = arg('password');
const code = arg('code');
const upiId = arg('upi');
const payeeName = arg('payee');
if (!shopSlug || !login || !password || (!code && !process.env.KAGAZ_DEVICE_TOKEN)) {
  console.error(
    'usage: pilot:smoke -- --api <url> --shop <slug> --login <owner> --password <pw> --code <pairing code> [--upi x@bank --payee "Name"]',
  );
  process.exit(2);
}

async function call<T>(
  path: string,
  init: RequestInit & { auth?: Record<string, string> } = {},
): Promise<T> {
  const res = await fetch(`${api}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.auth, ...init.headers },
  });
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as T & {
    error?: { code: string; message: string };
  };
  if (!res.ok)
    throw new Error(
      `${init.method ?? 'GET'} ${path} → ${res.status} ${body?.error?.code}: ${body?.error?.message}`,
    );
  return body;
}

const step = (n: number, text: string) => console.log(`\n[${n}] ${text}`);

async function main() {
  step(1, `API ${api}`);
  const health = await call<{ status: string; db: string; storage: string }>('/health');
  const config = await call<{ appEnv: string; paymentMode: string }>('/config');
  console.log(
    `    health ${health.status} (db ${health.db}, storage ${health.storage}); ${config.appEnv}, payments ${config.paymentMode}`,
  );
  if (config.paymentMode !== 'LIVE')
    console.log('    ! payments are DEMO — this is not the YouPI pilot configuration');

  step(2, 'Shop app: pair + operator sign-in');
  let deviceToken = process.env.KAGAZ_DEVICE_TOKEN;
  if (!deviceToken) {
    const enrolled = await call<{ deviceToken: string; shop: { name: string } }>(
      '/devices/enroll',
      {
        method: 'POST',
        body: JSON.stringify({ code, name: 'Smoke test' }),
      },
    );
    deviceToken = enrolled.deviceToken;
    console.log(
      `    paired "Smoke test" to ${enrolled.shop.name} (revoke it later in admin → Devices)`,
    );
  }
  const device = { Authorization: `Bearer ${deviceToken}` };
  const op = await call<{ operatorToken: string }>('/shop/operator/login', {
    method: 'POST',
    auth: device,
    body: JSON.stringify({ login, password }),
  });
  const auth = { ...device, 'X-Operator-Token': op.operatorToken };
  console.log('    operator signed in');

  step(3, 'Payment setup');
  type Setup = {
    readiness: string;
    upiId: string | null;
    phones: { name: string; online: boolean }[];
    appDownloadUrl: string | null;
  };
  let setup = await call<Setup>('/shop/payments/setup', { auth });
  if (upiId && payeeName) {
    setup = await call<Setup>('/shop/payments/setup', {
      method: 'PUT',
      auth,
      body: JSON.stringify({ upiId, payeeName }),
    });
    console.log(`    saved UPI ID ${setup.upiId}`);
  }
  console.log(
    `    readiness ${setup.readiness}; UPI ID ${setup.upiId ?? '—'}; phones: ${setup.phones.map((p) => `${p.name} ${p.online ? 'online' : 'offline'}`).join(', ') || 'none'}`,
  );
  console.log(`    phone app download: ${setup.appDownloadUrl ?? '—'}`);
  if (setup.upiId) {
    const pairing = await call<{ qrText: string; expiresAt: string }>('/shop/payments/pairing', {
      method: 'POST',
      auth,
    });
    const payload = JSON.parse(pairing.qrText) as { serverUrl?: string; merchantId?: string };
    console.log(
      `    pairing code OK → phone will talk to ${payload.serverUrl} (expires ${pairing.expiresAt})`,
    );
  }

  step(4, 'Customer: order + UPI checkout');
  const { shops } = await call<{
    shops: { id: string; slug: string; name: string; acceptingOrders: boolean }[];
  }>('/shops');
  const shop = shops.find((s) => s.slug === shopSlug);
  if (!shop) throw new Error(`shop ${shopSlug} not listed (status/opening hours?)`);
  if (!shop.acceptingOrders)
    console.log('    ! shop is not accepting orders right now (closed / outside hours)');
  const { order, trackingToken } = await call<{
    order: { id: string; publicRef: string };
    trackingToken: string;
  }>('/orders', {
    method: 'POST',
    body: JSON.stringify({
      shopId: shop.id,
      options: { copies: 1, colour: false, duplex: false, paperSize: 'A4' },
    }),
  });
  const tok = { 'x-tracking-token': trackingToken };
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  doc
    .addPage([595.28, 841.89])
    .drawText(`Kagaz pilot smoke test — ${order.publicRef}`, { x: 60, y: 760, size: 20, font });
  const pdf = await doc.save();
  const upload = await call<{ fileId: string; uploadUrl: string; headers: Record<string, string> }>(
    `/orders/${order.id}/upload-url`,
    { method: 'POST', auth: tok, body: JSON.stringify({ bytes: pdf.length }) },
  );
  const put = await fetch(upload.uploadUrl, { method: 'PUT', headers: upload.headers, body: pdf });
  if (!put.ok)
    throw new Error(`file upload to storage failed: ${put.status} (check files.<domain> route)`);
  const quoted = await call<{ amountPaise: number }>(`/orders/${order.id}/upload-complete`, {
    method: 'POST',
    auth: tok,
    body: JSON.stringify({ fileId: upload.fileId }),
  });
  const pay = await call<{ mode: string; checkoutUrl: string | null }>(`/orders/${order.id}/pay`, {
    method: 'POST',
    auth: tok,
  });
  console.log(
    `    order ${order.publicRef}: ₹${(quoted.amountPaise / 100).toFixed(2)}, mode ${pay.mode}`,
  );
  if (pay.checkoutUrl) {
    const page = await fetch(pay.checkoutUrl);
    console.log(`    checkout page ${page.status}: ${pay.checkoutUrl}`);
  }

  step(5, 'Finish by hand');
  console.log(
    `    Open the checkout URL above on a phone, pay ₹${(quoted.amountPaise / 100).toFixed(2)} to the shop's UPI ID,`,
  );
  console.log(
    `    then watch: GET ${api}/orders/${order.id} (header x-tracking-token: ${trackingToken})`,
  );
  console.log(
    '    It should reach PENDING_REVIEW (manual mode) or QUEUED (auto) within ~30 s and print at the shop.',
  );
  console.log(
    `\nKAGAZ_SMOKE_ORDER_ID=${order.id}\nKAGAZ_SMOKE_TRACKING_TOKEN=${trackingToken}\nKAGAZ_SMOKE_DEVICE_TOKEN=${deviceToken}`,
  );
}

main().catch((err: unknown) => {
  console.error(`\nFAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
