import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CreateOrderResponse } from '@kagaz/shared';
import { OperatorSessionService } from '../../src/modules/identity/operator-session.service.js';
import { makePdf } from '../fixtures/pdfs.js';
import {
  E2E_STAFF_PASSWORD,
  type Harness,
  createHarness,
  createOrder,
  createShop,
  createStaff,
  pairDevice,
  uploadPdf,
} from './harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});

async function paidOrder(shopId: string): Promise<CreateOrderResponse> {
  const created = await createOrder(h, shopId);
  expect((await uploadPdf(h, created, await makePdf(1))).status).toBe(200);
  await h
    .http()
    .post(`/api/orders/${created.order.id}/pay`)
    .set('x-tracking-token', created.trackingToken)
    .expect(200);
  return created;
}

async function shopWithPrinter() {
  const shop = await createShop(h.prisma, { printer: true });
  const paired = await pairDevice(h, shop.id);
  return { shop, paired };
}

describe('operator sessions (P2.3, contract §4)', () => {
  it('an operator from Shop A cannot sign in on a Shop B device', async () => {
    const a = await shopWithPrinter();
    const b = await shopWithPrinter();
    const opA = await createStaff(h.prisma, a.shop.id, 'OPERATOR');

    const res = await h
      .http()
      .post('/api/shop/operator/login')
      .set(b.paired.auth)
      .send({ login: opA.email, password: E2E_STAFF_PASSWORD })
      .expect(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');

    // Same error as a wrong password: no enumeration of other shops' staff.
    const wrong = await h
      .http()
      .post('/api/shop/operator/login')
      .set(a.paired.auth)
      .send({ login: opA.email, password: 'not-the-password' })
      .expect(401);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');

    const ok = await h
      .http()
      .post('/api/shop/operator/login')
      .set(a.paired.auth)
      .send({ login: opA.email.toUpperCase(), password: E2E_STAFF_PASSWORD })
      .expect(200);
    expect(ok.body.operator).toMatchObject({ id: opA.userId, role: 'SHOP_OPERATOR' });
    expect(Date.parse(ok.body.expiresAt) - Date.now()).toBeGreaterThan(89 * 86_400_000);

    const failed = await h.prisma.auditLog.findFirst({
      where: { shopId: b.shop.id, action: 'operator.login_failed' },
    });
    expect(failed?.metadata).toMatchObject({ reason: 'not_shop_member' });
  });

  it('human actions need an operator; agent calls need only the device token', async () => {
    const { shop, paired } = await shopWithPrinter();
    const order = await paidOrder(shop.id);

    await h.http().get('/api/shop/jobs').set(paired.auth).expect(200);
    for (const [path, body] of [
      [`/api/shop/jobs/${order.order.id}/accept`, {}],
      [`/api/shop/jobs/${order.order.id}/reject`, { reasonCode: 'OTHER' }],
      // Security review H3: reprint / mark-failed resolution is a human action too.
      [`/api/shop/jobs/${order.order.id}/resolve`, { action: 'REPRINT', confirm: true }],
    ] as const) {
      const res = await h.http().post(path).set(paired.auth).send(body).expect(401);
      expect(res.body.error.code).toBe('OPERATOR_LOGIN_REQUIRED');
    }
    const mode = await h
      .http()
      .patch('/api/shop/mode')
      .set(paired.auth)
      .send({ approvalMode: 'AUTO' })
      .expect(401);
    expect(mode.body.error.code).toBe('OPERATOR_LOGIN_REQUIRED');
    const put = await h
      .http()
      .put('/api/shop/printers')
      .set(paired.auth)
      .send({
        printers: [
          {
            printerName: 'X',
            colourCapable: false,
            duplexCapable: false,
            capabilitiesConfirmed: true,
          },
        ],
      })
      .expect(401);
    expect(put.body.error.code).toBe('OPERATOR_LOGIN_REQUIRED');
    await h
      .http()
      .post(`/api/shop/jobs/${order.order.id}/accept`)
      .set({ ...paired.auth, 'X-Operator-Token': 'garbage' })
      .send({})
      .expect(401);

    // With the operator: accepted, and the audit row names the operator + device.
    await h
      .http()
      .post(`/api/shop/jobs/${order.order.id}/accept`)
      .set(paired.opAuth)
      .send({})
      .expect(200);
    const audit = await h.prisma.auditLog.findFirstOrThrow({
      where: { orderId: order.order.id, action: 'order.accepted' },
    });
    expect(audit).toMatchObject({ actorType: 'STAFF', actorId: paired.operatorId });
    expect(audit.metadata).toMatchObject({ deviceId: paired.deviceId });
    const event = await h.prisma.orderEvent.findFirstOrThrow({
      where: { orderId: order.order.id, toStatus: 'QUEUED' },
    });
    expect(event).toMatchObject({ actorType: 'STAFF', actorId: paired.operatorId });
  });

  it('an operator token is bound to its device and dies on logout', async () => {
    const shop = await createShop(h.prisma, { printer: true });
    const one = await pairDevice(h, shop.id);
    const two = await pairDevice(h, shop.id, { deviceName: 'Back office PC' });
    const order = await paidOrder(shop.id);

    // Device two presenting device one's operator token.
    const crossed = await h
      .http()
      .post(`/api/shop/jobs/${order.order.id}/reject`)
      .set({ ...two.auth, 'X-Operator-Token': one.operatorToken })
      .send({ reasonCode: 'OTHER' })
      .expect(401);
    expect(crossed.body.error.code).toBe('OPERATOR_LOGIN_REQUIRED');

    await h.http().post('/api/shop/operator/logout').set(one.opAuth).expect(200);
    const after = await h
      .http()
      .post(`/api/shop/jobs/${order.order.id}/reject`)
      .set(one.opAuth)
      .send({ reasonCode: 'OTHER' })
      .expect(401);
    expect(after.body.error.code).toBe('OPERATOR_LOGIN_REQUIRED');
    expect(
      await h.prisma.auditLog.count({
        where: { actorId: one.operatorId, action: 'operator.logout' },
      }),
    ).toBe(1);
  });

  it('operator sessions slide on use (staff stay signed in) but revocation still ends them', async () => {
    const shop = await createShop(h.prisma, { printer: true });
    const paired = await pairDevice(h, shop.id);
    const device = { deviceId: paired.deviceId, shopId: shop.id, name: 'E2E PC' };
    const sessions = h.app.get(OperatorSessionService);
    const where = { deviceId: paired.deviceId, userId: paired.operatorId };

    // Nearly expired session (last renewed long ago) is pushed forward on use.
    await h.prisma.operatorSession.updateMany({
      where,
      data: { expiresAt: new Date(Date.now() + 3_600_000) },
    });
    await sessions.verify(device, paired.operatorToken);
    const renewed = await h.prisma.operatorSession.findFirstOrThrow({ where });
    expect(renewed.expiresAt.getTime() - Date.now()).toBeGreaterThan(89 * 86_400_000);

    await h.prisma.operatorSession.updateMany({ where, data: { revokedAt: new Date() } });
    await expect(sessions.verify(device, paired.operatorToken)).rejects.toMatchObject({
      code: 'OPERATOR_LOGIN_REQUIRED',
    });
  });

  it('a removed shop membership ends the operator session', async () => {
    const shop = await createShop(h.prisma, { printer: true });
    const paired = await pairDevice(h, shop.id);
    await h.prisma.shopUser.deleteMany({ where: { userId: paired.operatorId } });
    const res = await h
      .http()
      .post('/api/shop/jobs/00000000-0000-4000-8000-000000000000/reject')
      .set(paired.opAuth)
      .send({ reasonCode: 'OTHER' })
      .expect(401);
    expect(res.body.error.code).toBe('OPERATOR_LOGIN_REQUIRED');
  });
});

describe('device tokens (contract §4)', () => {
  it('unknown token → 401 UNAUTHORIZED; rotate-token kills the old token at once', async () => {
    const shop = await createShop(h.prisma);
    const paired = await pairDevice(h, shop.id);

    const unknown = await h
      .http()
      .get('/api/shop/jobs')
      .set('Authorization', 'Bearer abcdefghijklmnopqrstuvwxyz012345')
      .expect(401);
    expect(unknown.body.error.code).toBe('UNAUTHORIZED');

    const rotated = await h.http().post('/api/devices/rotate-token').set(paired.auth).expect(200);
    const fresh = rotated.body.deviceToken as string;
    expect(fresh).not.toBe(paired.deviceToken);
    await h.http().get('/api/shop/jobs').set(paired.auth).expect(401);
    await h.http().get('/api/shop/jobs').set('Authorization', `Bearer ${fresh}`).expect(200);
    // The operator session is bound to the device, not the token: it survives rotation.
    await h
      .http()
      .post('/api/shop/jobs/00000000-0000-4000-8000-000000000000/reject')
      .set({ Authorization: `Bearer ${fresh}`, 'X-Operator-Token': paired.operatorToken })
      .send({ reasonCode: 'OTHER' })
      .expect(404);
  });
});
