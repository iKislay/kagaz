import { expect } from 'vitest';
import {
  type CreateOrderResponse,
  type EnrollDeviceResponse,
  type LeaseResponse,
  type PrintOptions,
  type PublicOrder,
  type ShopJob,
} from '@kagaz/shared';
import { randomCode, sha256Hex } from '../../src/common/crypto/tokens.js';
import { makePdf } from '../fixtures/pdfs.js';
import { MONO, type Harness, createOrder, createShop, uploadPdf } from './harness.js';

type Headers = Record<string, string>;

/**
 * A shop with one paired device and one confirmed printer.
 *
 * `human(path, body, headers)` is THE single entry point for operator (human) actions —
 * accept / reject / ready / resolve / pickups/verify. When operator sessions land
 * (contract §4, `X-Operator-Token`), add the header here once.
 */
export async function pairedShop(h: Harness, caps: { colour?: boolean; duplex?: boolean } = {}) {
  const shop = await createShop(h.prisma);
  const device = await enrollDevice(h, shop.id);
  const auth: Headers = { Authorization: `Bearer ${device.deviceToken}` };
  const printers = await h
    .http()
    .put('/api/shop/printers')
    .set(auth)
    .send({
      printers: [
        {
          printerName: `HP LaserJet ${randomCode(4)}`,
          colourCapable: caps.colour ?? false,
          duplexCapable: caps.duplex ?? true,
          capabilitiesConfirmed: true,
          isDefault: true,
        },
      ],
    })
    .expect(200);
  const printerId = printers.body[0].id as string;

  const human = (path: string, body: object = {}, headers: Headers = {}) =>
    h
      .http()
      .post(`/api/shop/${path}`)
      .set({ ...auth, ...headers })
      .send(body);
  const agent = (path: string, body: object = {}, headers: Headers = {}) =>
    h
      .http()
      .post(`/api/shop/${path}`)
      .set({ ...auth, ...headers })
      .send(body);

  return { shop, device, auth, printerId, human, agent };
}
export type PairedShop = Awaited<ReturnType<typeof pairedShop>>;

/** A second device for an existing shop (e.g. two agents racing for one printer). */
export async function enrollDevice(h: Harness, shopId: string): Promise<EnrollDeviceResponse> {
  const code = randomCode(8);
  await h.prisma.enrollmentCode.create({
    data: { shopId, codeHash: sha256Hex(code), expiresAt: new Date(Date.now() + 60_000) },
  });
  return (
    await h
      .http()
      .post('/api/devices/enroll')
      .send({ code, name: 'Counter PC', appVersion: '0.3.0' })
      .expect(201)
  ).body as EnrollDeviceResponse;
}

export async function paidOrder(
  h: Harness,
  shopId: string,
  pages = 1,
  options: PrintOptions = MONO,
): Promise<CreateOrderResponse> {
  const created = await createOrder(h, shopId, options);
  expect((await uploadPdf(h, created, await makePdf(pages))).status).toBe(200);
  await h
    .http()
    .post(`/api/orders/${created.order.id}/pay`)
    .set('x-tracking-token', created.trackingToken)
    .expect(200);
  return created;
}

export async function customerView(h: Harness, c: CreateOrderResponse): Promise<PublicOrder> {
  return (await h.http().get(`/api/orders/${c.order.id}`).set('x-tracking-token', c.trackingToken))
    .body as PublicOrder;
}

/** paid → accepted (QUEUED, attempt 1 READY). */
export async function acceptedOrder(h: Harness, s: PairedShop, pages = 1) {
  const created = await paidOrder(h, s.shop.id, pages);
  const job = (await s.human(`jobs/${created.order.id}/accept`).expect(200)).body as ShopJob;
  return { created, job, printJobId: job.printJob!.id };
}

/** paid → accepted → leased → SUBMITTED (order PRINTING). */
export async function printingOrder(h: Harness, s: PairedShop) {
  const { created, printJobId } = await acceptedOrder(h, s);
  const lease = (await s.agent(`print-jobs/${printJobId}/lease`).expect(200)).body as LeaseResponse;
  await s
    .agent(`print-jobs/${printJobId}/status`, { status: 'SUBMITTED', spoolerJobId: 7 })
    .expect(200);
  return { created, printJobId, lease };
}

/** paid → … → FAILED report → NEEDS_OPERATOR_CHECK. */
export async function needsCheckOrder(h: Harness, s: PairedShop) {
  const { created, printJobId } = await printingOrder(h, s);
  const res = await s
    .agent(`print-jobs/${printJobId}/status`, { status: 'UNCERTAIN', reason: 'PC restarted' })
    .expect(200);
  expect(res.body.status).toBe('NEEDS_OPERATOR_CHECK');
  return { created, printJobId };
}

/** Mark ready via the operator path and return the customer's pickup code. */
export async function readyOrder(h: Harness, s: PairedShop) {
  const { created, printJobId } = await printingOrder(h, s);
  await s.human(`jobs/${created.order.id}/ready`, { confirmed: true }).expect(200);
  const code = (await customerView(h, created)).pickupCode!;
  return { created, printJobId, code };
}
