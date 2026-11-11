/**
 * Helpers for the payments / business-rules e2e suites. Human shop actions go through
 * `shopAction()` so the operator header (X-Operator-Token, identity workstream) can be added
 * in ONE place at integration time.
 */
import { signStaffToken } from '../../src/modules/identity/staff-session.js';
import type request from 'supertest';
import {
  type CreateOrderResponse,
  type EnrollDeviceResponse,
  type PrintOptions,
} from '@kagaz/shared';
import { randomCode, sha256Hex } from '../../src/common/crypto/tokens.js';
import { makePdf } from '../fixtures/pdfs.js';
import {
  MONO,
  operatorHeader,
  type Harness,
  createOrder,
  createShop,
  type ShopOptions,
  uploadPdf,
} from './harness.js';

/** Admin session cookie minted directly (the admin login flow is tested elsewhere). */
export async function adminCookie(h: Harness): Promise<string> {
  const admin = await h.prisma.user.create({
    data: { email: `admin-${randomCode(8).toLowerCase()}@e2e.local`, kind: 'ADMIN' },
  });
  const token = await signStaffToken(process.env.SESSION_JWT_SECRET!, admin.id);
  return `kgz_admin=${token}`;
}

export interface PairedShop {
  shop: Awaited<ReturnType<typeof createShop>>;
  auth: Record<string, string>;
  deviceId: string;
  printerId: string;
}

/** A shop with a paired device and one confirmed printer (status READY, fresh heartbeat). */
export async function pairedShop(
  h: Harness,
  opts: ShopOptions & { colour?: boolean; duplex?: boolean } = {},
): Promise<PairedShop> {
  const shop = await createShop(h.prisma, { ...opts, printer: false });
  const code = randomCode(8);
  await h.prisma.enrollmentCode.create({
    data: { shopId: shop.id, codeHash: sha256Hex(code), expiresAt: new Date(Date.now() + 60_000) },
  });
  const enrolled = (
    await h.http().post('/api/devices/enroll').send({ code, name: 'Counter PC' }).expect(201)
  ).body as EnrollDeviceResponse;
  const deviceAuth = { Authorization: `Bearer ${enrolled.deviceToken}` };
  // Operator signed in on the device: human actions (accept, mode, printers) need it (contract §4).
  const auth = { ...deviceAuth, ...(await operatorHeader(h, shop.id, deviceAuth)) };
  const printers = await h
    .http()
    .put('/api/shop/printers')
    .set(auth)
    .send({
      printers: [
        {
          printerName: `HP LaserJet ${randomCode(4)}`,
          colourCapable: opts.colour ?? false,
          duplexCapable: opts.duplex ?? false,
          capabilitiesConfirmed: true,
          isDefault: true,
        },
      ],
    })
    .expect(200);
  const printerId = printers.body[0].id as string;
  await heartbeat(h, auth, printerId, 'READY');
  return { shop, auth, deviceId: enrolled.device.id, printerId };
}

export function heartbeat(
  h: Harness,
  auth: Record<string, string>,
  printerId: string,
  status: 'READY' | 'OFFLINE' | 'PAPER_OUT' | 'ERROR' | 'UNKNOWN',
) {
  return h
    .http()
    .post('/api/devices/heartbeat')
    .set(auth)
    .send({ printers: [{ printerId, status }] })
    .expect(200);
}

/** Human (operator) shop action — the single place to add X-Operator-Token later. */
export function shopAction(
  h: Harness,
  auth: Record<string, string>,
  method: 'post' | 'patch',
  path: string,
  body: object = {},
): request.Test {
  return h.http()[method](path).set(auth).send(body);
}

/** Order with a validated PDF, ready to pay. */
export async function payableOrder(
  h: Harness,
  shopId: string,
  pages = 3,
  options: PrintOptions = MONO,
): Promise<CreateOrderResponse> {
  const created = await createOrder(h, shopId, options);
  const res = await uploadPdf(h, created, await makePdf(pages));
  if (res.status !== 200) throw new Error(`upload failed: ${JSON.stringify(res.body)}`);
  return created;
}

export function pay(h: Harness, created: CreateOrderResponse, query = '') {
  return h
    .http()
    .post(`/api/orders/${created.order.id}/pay${query}`)
    .set('x-tracking-token', created.trackingToken);
}

export function view(h: Harness, created: CreateOrderResponse) {
  return h
    .http()
    .get(`/api/orders/${created.order.id}`)
    .set('x-tracking-token', created.trackingToken);
}

/** Poll until `check` passes (for asynchronous simulated webhooks). */
export async function eventually<T>(fn: () => Promise<T>, check: (v: T) => boolean, ms = 8000) {
  const until = Date.now() + ms;
  let last: T;
  do {
    last = await fn();
    if (check(last)) return last;
    await new Promise((r) => setTimeout(r, 50));
  } while (Date.now() < until);
  return last;
}

/** Set-Cookie header → "name=value" for a cookie. */
export function cookieFrom(res: request.Response, name: string): string | null {
  const raw = res.headers['set-cookie'] as unknown as string[] | string | undefined;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const hit = list.find((c) => c.startsWith(`${name}=`));
  return hit ? hit.split(';')[0]! : null;
}
