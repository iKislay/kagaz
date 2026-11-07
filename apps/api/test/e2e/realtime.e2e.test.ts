import { type AddressInfo } from 'node:net';
import { SignJWT } from 'jose';
import { type Socket, io } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type CreateOrderResponse,
  type EnrollDeviceResponse,
  type OrderStatusHint,
} from '@kagaz/shared';
import { randomCode, sha256Hex } from '../../src/common/crypto/tokens.js';
import { makePdf } from '../fixtures/pdfs.js';
import { type Harness, createHarness, createOrder, createShop, uploadPdf } from './harness.js';

let h: Harness;
let base = '';
const sockets: Socket[] = [];

beforeAll(async () => {
  h = await createHarness();
  await h.app.listen(0, '127.0.0.1');
  const { port } = h.app.getHttpServer().address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});
afterAll(async () => {
  for (const s of sockets) s.disconnect();
  await h.close();
});

function connect(nsp: string, opts: Parameters<typeof io>[1] = {}): Socket {
  const s = io(`${base}${nsp}`, {
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
    ...opts,
  });
  sockets.push(s);
  return s;
}

/** Resolves on `connect`, rejects with the server's error message on `connect_error`. */
function connected(s: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    s.once('connect', () => resolve());
    s.once('connect_error', (err) => reject(err));
  });
}

function next<T>(s: Socket, event: string, match: (p: T) => boolean, ms = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
    const handler = (p: T) => {
      if (!match(p)) return;
      clearTimeout(timer);
      s.off(event, handler);
      resolve(p);
    };
    s.on(event, handler);
  });
}

async function pairedDevice() {
  const shop = await createShop(h.prisma, { printer: true });
  const code = randomCode(8);
  await h.prisma.enrollmentCode.create({
    data: { shopId: shop.id, codeHash: sha256Hex(code), expiresAt: new Date(Date.now() + 60_000) },
  });
  const enrolled = (
    await h.http().post('/api/devices/enroll').send({ code, name: 'Realtime PC' }).expect(201)
  ).body as EnrollDeviceResponse;
  return { shop, enrolled };
}

async function payableOrder(shopId: string): Promise<CreateOrderResponse> {
  const created = await createOrder(h, shopId);
  expect((await uploadPdf(h, created, await makePdf(2))).status).toBe(200);
  return created;
}

const pay = (c: CreateOrderResponse) =>
  h
    .http()
    .post(`/api/orders/${c.order.id}/pay`)
    .set('x-tracking-token', c.trackingToken)
    .expect(200);

describe('realtime gateway (P2.9)', () => {
  it('pay → the shop socket receives job.created; the customer socket order.updated', async () => {
    const { shop, enrolled } = await pairedDevice();
    const shopSocket = connect('/shop', { auth: { token: enrolled.deviceToken } });
    await connected(shopSocket);

    const order = await payableOrder(shop.id);
    const customer = connect('/customer', {
      auth: { orderId: order.order.id, trackingToken: order.trackingToken },
    });
    await connected(customer);

    const jobCreated = next<OrderStatusHint>(
      shopSocket,
      'job.created',
      (p) => p.orderId === order.order.id,
    );
    const orderUpdated = next<OrderStatusHint>(
      customer,
      'order.updated',
      (p) => p.status === 'PENDING_REVIEW',
    );
    const started = Date.now();
    await pay(order);

    const hint = await jobCreated;
    expect(Date.now() - started).toBeLessThan(3000);
    expect(hint).toEqual({
      orderId: order.order.id,
      status: 'PENDING_REVIEW',
      at: expect.any(String),
    });
    expect((await orderUpdated).orderId).toBe(order.order.id);
  });

  it('another shop never receives the hint (tenant isolation)', async () => {
    const a = await pairedDevice();
    const b = await pairedDevice();
    const other = connect('/shop', { auth: { token: b.enrolled.deviceToken } });
    await connected(other);
    const received: unknown[] = [];
    other.on('job.created', (p) => received.push(p));

    const own = connect('/shop', { auth: { token: a.enrolled.deviceToken } });
    await connected(own);
    const order = await payableOrder(a.shop.id);
    const hint = next<OrderStatusHint>(own, 'job.created', (p) => p.orderId === order.order.id);
    await pay(order);
    await hint;
    await new Promise((r) => setTimeout(r, 200));
    expect(received).toEqual([]);
  });

  it('wrong or missing device token → connection refused', async () => {
    await expect(connected(connect('/shop', { auth: { token: 'x'.repeat(43) } }))).rejects.toThrow(
      'UNAUTHORIZED',
    );
    await expect(connected(connect('/shop'))).rejects.toThrow('UNAUTHORIZED');
  });

  it('revoked device → refused, and a live socket is dropped by the device.revoked event', async () => {
    const { enrolled } = await pairedDevice();
    const live = connect('/shop', { auth: { token: enrolled.deviceToken } });
    await connected(live);
    const revokedHint = next<{ deviceId: string }>(live, 'device.revoked', () => true);
    const dropped = new Promise<void>((r) => live.once('disconnect', () => r()));

    await h.prisma.shopDevice.update({
      where: { id: enrolled.device.id },
      data: { status: 'REVOKED' },
    });
    const { EventEmitter2 } = await import('@nestjs/event-emitter');
    h.app.get(EventEmitter2).emit('device.revoked', {
      deviceId: enrolled.device.id,
      shopId: enrolled.shop.id,
    });
    expect(await revokedHint).toEqual({ deviceId: enrolled.device.id });
    await dropped;

    await expect(
      connected(connect('/shop', { auth: { token: enrolled.deviceToken } })),
    ).rejects.toThrow('DEVICE_REVOKED');
  });

  it('customer: wrong tracking token or unknown order → refused', async () => {
    const shop = await createShop(h.prisma);
    const order = await createOrder(h, shop.id);
    await expect(
      connected(connect('/customer', { auth: { orderId: order.order.id, trackingToken: 'nope' } })),
    ).rejects.toThrow('ORDER_NOT_FOUND');
    await expect(
      connected(connect('/customer', { auth: { orderId: 'not-a-uuid' } })),
    ).rejects.toThrow('ORDER_NOT_FOUND');
  });

  it('admin: session JWT required; receives order.updated', async () => {
    await expect(connected(connect('/admin'))).rejects.toThrow('ADMIN_UNAUTHENTICATED');

    const user = await h.prisma.user.create({
      data: { email: `rt-${randomCode(6).toLowerCase()}@kagaz.local`, kind: 'ADMIN' },
    });
    const jwt = await new SignJWT({ sub: user.id, kind: 'ADMIN', email: user.email })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(process.env.SESSION_JWT_SECRET));
    const admin = connect('/admin', { extraHeaders: { cookie: `kgz_admin=${jwt}` } });
    await connected(admin);

    const shop = await createShop(h.prisma);
    const order = await payableOrder(shop.id);
    const hint = next<OrderStatusHint>(
      admin,
      'order.updated',
      (p) => p.orderId === order.order.id && p.status === 'PENDING_REVIEW',
    );
    await pay(order);
    await hint;
  });

  it('a rolled-back transition emits nothing', async () => {
    const { shop, enrolled } = await pairedDevice();
    const s = connect('/shop', { auth: { token: enrolled.deviceToken } });
    await connected(s);
    const order = await payableOrder(shop.id);
    const received: OrderStatusHint[] = [];
    s.on('job.created', (p: OrderStatusHint) => received.push(p));

    const { OrderStateMachine } = await import('../../src/modules/orders/order-state-machine.js');
    const sm = h.app.get(OrderStateMachine);
    await h.prisma.order.update({
      where: { id: order.order.id },
      data: { status: 'AWAITING_PAYMENT' },
    });
    await expect(
      h.prisma.$transaction(async (tx) => {
        await sm.transition(tx, {
          orderId: order.order.id,
          to: 'PENDING_REVIEW',
          actor: { type: 'SYSTEM', id: null },
        });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    await new Promise((r) => setTimeout(r, 300));
    expect(received).toEqual([]);
  });
});
