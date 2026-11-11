import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateToken, randomCode, sha256Hex } from '../../src/common/crypto/tokens.js';
import { hashPassword } from '../../src/modules/identity/passwords.js';
import {
  E2E_STAFF_PASSWORD,
  type Harness,
  MONO,
  createHarness,
  createShop,
  createStaff,
  pairDevice,
} from './harness.js';

/** /sudoadmin platform-owner API: tenants, team accounts, plans, subscriptions, admins. */
let h: Harness;
let admin: Record<string, string>;
let adminId: string;

const tag = () => randomCode(6).toLowerCase();

async function login(login: string, password: string): Promise<Record<string, string>> {
  const res = await h.http().post('/api/admin/auth/login').send({ login, password }).expect(200);
  const raw = res.headers['set-cookie'] as unknown as string[] | string;
  const cookie = (Array.isArray(raw) ? raw : [raw]).find((c) => c.startsWith('kgz_admin='))!;
  return { Cookie: cookie.split(';')[0]! };
}

async function createPlan(overrides: Record<string, unknown> = {}) {
  const res = await h
    .http()
    .post('/api/sudo/plans')
    .set(admin)
    .send({
      code: `plan-${tag()}`,
      name: 'Starter',
      pricePaise: 49_900,
      interval: 'MONTHLY',
      trialDays: 14,
      ...overrides,
    })
    .expect(201);
  return res.body as { id: string; code: string; pricePaise: number };
}

beforeAll(async () => {
  h = await createHarness();
  const email = `sudo-${tag()}@e2e.kagaz.local`;
  const user = await h.prisma.user.create({
    data: {
      email,
      name: 'E2E Sudo',
      kind: 'ADMIN',
      passwordHash: await hashPassword('Admin-Pass-123!'),
    },
  });
  adminId = user.id;
  admin = await login(email, 'Admin-Pass-123!');
});
afterAll(async () => {
  await h.close();
});

describe('/api/sudo access', () => {
  it('requires a platform admin: 401 signed out, 403 for a shop owner', async () => {
    await h.http().get('/api/sudo/shops').expect(401);
    const shop = await createShop(h.prisma);
    const owner = await createStaff(h.prisma, shop.id, 'OWNER');
    const ownerCookie = await login(owner.email, E2E_STAFF_PASSWORD);
    const res = await h.http().get('/api/sudo/shops').set(ownerCookie).expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    await h.http().get('/api/sudo/overview').set(admin).expect(200);
  });
});

describe('plans', () => {
  it('create, reject duplicate code, update, delete unused, refuse delete when used', async () => {
    const plan = await createPlan();
    const dup = await h
      .http()
      .post('/api/sudo/plans')
      .set(admin)
      .send({ code: plan.code, name: 'X', pricePaise: 1, interval: 'MONTHLY' })
      .expect(409);
    expect(dup.body.error.code).toBe('PLAN_CODE_TAKEN');
    // Money is integer paise only.
    await h
      .http()
      .post('/api/sudo/plans')
      .set(admin)
      .send({ code: `p-${tag()}`, name: 'X', pricePaise: 499.5, interval: 'MONTHLY' })
      .expect(400);

    const updated = await h
      .http()
      .patch(`/api/sudo/plans/${plan.id}`)
      .set(admin)
      .send({ pricePaise: 59_900, name: 'Starter+' })
      .expect(200);
    expect(updated.body).toMatchObject({
      pricePaise: 59_900,
      name: 'Starter+',
      subscriberCount: 0,
    });

    const unused = await createPlan();
    await h.http().delete(`/api/sudo/plans/${unused.id}`).set(admin).expect(200);

    const shop = await createShop(h.prisma);
    await h
      .http()
      .post(`/api/sudo/shops/${shop.id}/subscriptions`)
      .set(admin)
      .send({ planId: plan.id })
      .expect(201);
    const inUse = await h.http().delete(`/api/sudo/plans/${plan.id}`).set(admin).expect(409);
    expect(inUse.body.error.code).toBe('PLAN_IN_USE');

    // Inactive plans can't be picked for new subscriptions.
    await h
      .http()
      .patch(`/api/sudo/plans/${plan.id}`)
      .set(admin)
      .send({ active: false })
      .expect(200);
    const other = await createShop(h.prisma);
    const inactive = await h
      .http()
      .post(`/api/sudo/shops/${other.id}/subscriptions`)
      .set(admin)
      .send({ planId: plan.id })
      .expect(409);
    expect(inactive.body.error.code).toBe('PLAN_INACTIVE');
  });
});

describe('onboarding', () => {
  it('creates shop + owner (generated password, shown once) + trial subscription', async () => {
    const plan = await createPlan({ trialDays: 14 });
    const slug = `sudo-${tag()}`;
    const ownerEmail = `Owner-${tag()}@E2E.kagaz.local`;
    const res = await h
      .http()
      .post('/api/sudo/shops')
      .set(admin)
      .send({
        slug,
        name: 'Sudo Onboarded Prints',
        address: 'MG Road, Mandya',
        owner: { name: 'Ravi', email: ownerEmail },
        subscription: { planId: plan.id },
      })
      .expect(201);
    const { shop, ownerTemporaryPassword } = res.body;
    expect(ownerTemporaryPassword).toMatch(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);
    expect(shop).toMatchObject({
      slug,
      status: 'CLOSED',
      lifecycle: 'LIVE',
      memberCount: 1,
      owners: [{ name: 'Ravi', login: ownerEmail.toLowerCase() }],
      subscription: { status: 'TRIALING', pricePaise: plan.pricePaise, overdue: false },
    });
    expect(shop.subscription.daysLeft).toBe(14);

    // The owner signs in with the generated password and sees their shop in /admin.
    const ownerCookie = await login(ownerEmail, ownerTemporaryPassword);
    const mine = await h.http().get('/api/admin/shops').set(ownerCookie).expect(200);
    expect(mine.body.shops.map((s: { id: string }) => s.id)).toEqual([shop.id]);

    // The password is never written to the audit log.
    const audits = await h.prisma.auditLog.findMany({ where: { shopId: shop.id } });
    expect(audits.map((a) => a.action)).toEqual(
      expect.arrayContaining(['shop.created', 'sudo.member.added', 'sudo.subscription.created']),
    );
    expect(JSON.stringify(audits)).not.toContain(ownerTemporaryPassword);

    const again = await h
      .http()
      .post('/api/sudo/shops')
      .set(admin)
      .send({ slug, name: 'Dup', address: 'x road' })
      .expect(409);
    expect(again.body.error.code).toBe('SHOP_SLUG_TAKEN');
  });

  it('rolls back the whole onboarding when a step fails', async () => {
    const slug = `sudo-${tag()}`;
    await h
      .http()
      .post('/api/sudo/shops')
      .set(admin)
      .send({
        slug,
        name: 'Rollback Prints',
        address: 'x road',
        subscription: { planId: '00000000-0000-7000-8000-000000000000' },
      })
      .expect(404);
    expect(await h.prisma.shop.findUnique({ where: { slug } })).toBeNull();
  });
});

describe('subscriptions', () => {
  it('payment extends coverage; one open per shop; cancel; delete rules', async () => {
    const monthly = await createPlan({ trialDays: 0, pricePaise: 50_000 });
    const yearly = await createPlan({ interval: 'YEARLY', pricePaise: 500_000, trialDays: 0 });
    const shop = await createShop(h.prisma);
    const base = `/api/sudo/shops/${shop.id}/subscriptions`;

    const start = '2026-10-01T00:00:00.000Z';
    const created = await h
      .http()
      .post(base)
      .set(admin)
      .send({ planId: monthly.id, startsAt: start })
      .expect(201);
    // No trial: ACTIVE, payment due from the start.
    expect(created.body).toMatchObject({
      status: 'ACTIVE',
      overdue: true,
      currentPeriodEnd: start,
    });
    const sub = created.body.id as string;

    const exists = await h.http().post(base).set(admin).send({ planId: monthly.id }).expect(409);
    expect(exists.body.error.code).toBe('SUBSCRIPTION_EXISTS');

    const paid = await h
      .http()
      .post(`${base}/${sub}/payments`)
      .set(admin)
      .send({ amountPaise: 50_000, method: 'UPI', reference: 'UTR123' })
      .expect(201);
    expect(paid.body).toMatchObject({
      amountPaise: 50_000,
      method: 'UPI',
      periodStart: start,
      periodEnd: '2026-11-01T00:00:00.000Z',
      recordedBy: { id: adminId },
    });
    await h
      .http()
      .post(`${base}/${sub}/payments`)
      .set(admin)
      .send({ amountPaise: 50_000, method: 'CASH' })
      .expect(201);
    let detail = await h.http().get(`/api/sudo/shops/${shop.id}`).set(admin).expect(200);
    expect(detail.body.subscription).toMatchObject({
      currentPeriodEnd: '2026-12-01T00:00:00.000Z',
      paymentCount: 2,
    });
    expect(detail.body.payments).toHaveLength(2);

    // Switch plan: interval and price follow the new plan unless a price is agreed.
    const switched = await h
      .http()
      .patch(`${base}/${sub}`)
      .set(admin)
      .send({ planId: yearly.id, pricePaise: 450_000 })
      .expect(200);
    expect(switched.body).toMatchObject({
      interval: 'YEARLY',
      pricePaise: 450_000,
      plan: { id: yearly.id },
    });

    const delWithPayments = await h.http().delete(`${base}/${sub}`).set(admin).expect(409);
    expect(delWithPayments.body.error.code).toBe('SUBSCRIPTION_HAS_PAYMENTS');

    // Cancel at period end keeps it open; cancel now closes it.
    const atEnd = await h
      .http()
      .post(`${base}/${sub}/cancel`)
      .set(admin)
      .send({ atPeriodEnd: true })
      .expect(200);
    expect(atEnd.body).toMatchObject({ status: 'ACTIVE', cancelAtPeriodEnd: true });
    const now = await h
      .http()
      .post(`${base}/${sub}/cancel`)
      .set(admin)
      .send({ atPeriodEnd: false, reason: 'Closed the shop' })
      .expect(200);
    expect(now.body.status).toBe('CANCELLED');
    const closed = await h
      .http()
      .patch(`${base}/${sub}`)
      .set(admin)
      .send({ pricePaise: 1 })
      .expect(409);
    expect(closed.body.error.code).toBe('SUBSCRIPTION_CLOSED');

    // Mistaken payment entries can be deleted (audited).
    await h
      .http()
      .delete(`/api/sudo/shops/${shop.id}/payments/${paid.body.id}`)
      .set(admin)
      .expect(200);
    const audit = await h.prisma.auditLog.findFirstOrThrow({
      where: { shopId: shop.id, action: 'sudo.subscription.payment_deleted' },
    });
    expect(audit.metadata).toMatchObject({ amountPaise: 50_000, method: 'UPI' });

    // After cancelling, a new subscription can start; one without payments can be deleted.
    const fresh = await h.http().post(base).set(admin).send({ planId: monthly.id }).expect(201);
    await h.http().delete(`${base}/${fresh.body.id}`).set(admin).expect(200);
    detail = await h.http().get(`/api/sudo/shops/${shop.id}`).set(admin).expect(200);
    expect(detail.body.subscription).toBeNull();
    expect(detail.body.subscriptionHistory).toHaveLength(1);
  });

  it('a subscription set to cancel at period end closes once the period is over', async () => {
    const plan = await createPlan({ trialDays: 3 });
    const shop = await createShop(h.prisma);
    const base = `/api/sudo/shops/${shop.id}/subscriptions`;
    const created = await h
      .http()
      .post(base)
      .set(admin)
      .send({ planId: plan.id, startsAt: '2026-01-01T00:00:00.000Z' })
      .expect(201);
    await h
      .http()
      .post(`${base}/${created.body.id}/cancel`)
      .set(admin)
      .send({ atPeriodEnd: true })
      .expect(200);
    const detail = await h.http().get(`/api/sudo/shops/${shop.id}`).set(admin).expect(200);
    expect(detail.body.subscription).toBeNull();
    expect(detail.body.subscriptionHistory[0]).toMatchObject({
      status: 'CANCELLED',
      cancelledAt: '2026-01-04T00:00:00.000Z',
    });
  });
});

describe('suspension', () => {
  it('suspended shops are hidden from customers and take no new orders', async () => {
    const shop = await createShop(h.prisma, { status: 'OPEN' });
    const visible = async () =>
      (await h.http().get('/api/shops').expect(200)).body.shops.some(
        (s: { id: string }) => s.id === shop.id,
      );
    expect(await visible()).toBe(true);

    const suspended = await h
      .http()
      .post(`/api/sudo/shops/${shop.id}/suspend`)
      .set(admin)
      .send({ reason: 'Subscription unpaid' })
      .expect(200);
    expect(suspended.body).toMatchObject({
      lifecycle: 'SUSPENDED',
      suspendedReason: 'Subscription unpaid',
    });
    expect(await visible()).toBe(false);
    const blocked = await h
      .http()
      .post('/api/orders')
      .send({ shopId: shop.id, options: MONO })
      .expect(409);
    expect(blocked.body.error).toMatchObject({
      code: 'SHOP_UNAVAILABLE',
      details: { reason: 'SHOP_SUSPENDED' },
    });

    await h.http().post(`/api/sudo/shops/${shop.id}/reactivate`).set(admin).expect(200);
    expect(await visible()).toBe(true);
    await h.http().post('/api/orders').send({ shopId: shop.id, options: MONO }).expect(201);
  });
});

describe('archive + delete', () => {
  it('archive is refused while paid orders are in progress', async () => {
    const shop = await createShop(h.prisma);
    await h.prisma.order.create({
      data: {
        publicRef: `KGZ-${randomCode(6)}`,
        shopId: shop.id,
        options: MONO,
        status: 'QUEUED',
        trackingTokenHash: sha256Hex(generateToken()),
      },
    });
    const res = await h
      .http()
      .post(`/api/sudo/shops/${shop.id}/archive`)
      .set(admin)
      .send({ reason: 'Offboarding' })
      .expect(409);
    expect(res.body.error).toMatchObject({
      code: 'SHOP_HAS_ACTIVE_ORDERS',
      details: { inFlight: 1 },
    });
    const del = await h
      .http()
      .delete(`/api/sudo/shops/${shop.id}`)
      .set(admin)
      .send({ confirmSlug: shop.slug })
      .expect(409);
    expect(del.body.error.code).toBe('SHOP_HAS_ORDERS');
  });

  it('archive revokes devices, cancels the subscription and ends staff access; restore', async () => {
    const shop = await createShop(h.prisma);
    const device = await pairDevice(h, shop.id);
    const owner = await createStaff(h.prisma, shop.id, 'OWNER');
    const ownerCookie = await login(owner.email, E2E_STAFF_PASSWORD);
    const plan = await createPlan();
    await h
      .http()
      .post(`/api/sudo/shops/${shop.id}/subscriptions`)
      .set(admin)
      .send({ planId: plan.id })
      .expect(201);

    const archived = await h
      .http()
      .post(`/api/sudo/shops/${shop.id}/archive`)
      .set(admin)
      .send({ reason: 'Shop closed down' })
      .expect(200);
    expect(archived.body).toMatchObject({
      lifecycle: 'ARCHIVED',
      status: 'CLOSED',
      devicesTotal: 0,
      subscription: null,
    });
    const dev = await h.prisma.shopDevice.findUniqueOrThrow({ where: { id: device.deviceId } });
    expect(dev.status).toBe('REVOKED');
    expect(
      await h.prisma.operatorSession.count({ where: { shopId: shop.id, revokedAt: null } }),
    ).toBe(0);
    // The owner's only shop is archived: their web session no longer works.
    await h.http().get('/api/admin/auth/me').set(ownerCookie).expect(401);
    const adminList = await h.http().get('/api/admin/shops').set(admin).expect(200);
    expect(adminList.body.shops.some((s: { id: string }) => s.id === shop.id)).toBe(false);

    const restored = await h
      .http()
      .post(`/api/sudo/shops/${shop.id}/restore`)
      .set(admin)
      .expect(200);
    expect(restored.body.lifecycle).toBe('SUSPENDED');
    await h.http().get('/api/admin/auth/me').set(ownerCookie).expect(200);
  });

  it('deletes a shop without orders only when the slug is typed back', async () => {
    const shop = await createShop(h.prisma, { printer: true });
    await createStaff(h.prisma, shop.id, 'OWNER');
    const wrong = await h
      .http()
      .delete(`/api/sudo/shops/${shop.id}`)
      .set(admin)
      .send({ confirmSlug: 'nope' })
      .expect(400);
    expect(wrong.body.error.code).toBe('CONFIRMATION_MISMATCH');
    await h
      .http()
      .delete(`/api/sudo/shops/${shop.id}`)
      .set(admin)
      .send({ confirmSlug: shop.slug })
      .expect(200);
    expect(await h.prisma.shop.findUnique({ where: { id: shop.id } })).toBeNull();
    await h.http().get(`/api/sudo/shops/${shop.id}`).set(admin).expect(404);
    const audit = await h.prisma.auditLog.findFirstOrThrow({
      where: { shopId: shop.id, action: 'sudo.shop.deleted' },
    });
    expect(audit.metadata).toMatchObject({ slug: shop.slug, membersRemoved: 1 });
  });
});

describe('team accounts', () => {
  it('add operator, re-add refused, change role, reset password, remove', async () => {
    const shop = await createShop(h.prisma);
    const base = `/api/sudo/shops/${shop.id}/members`;
    const phone = `+9198${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
    const added = await h
      .http()
      .post(base)
      .set(admin)
      .send({ name: 'Meena', phone, role: 'OPERATOR', password: 'Chosen-Pass-99' })
      .expect(201);
    expect(added.body).toMatchObject({
      existingUser: false,
      temporaryPassword: null,
      member: { role: 'OPERATOR', phone, hasPassword: true },
    });
    const userId = added.body.member.userId as string;
    await login(phone, 'Chosen-Pass-99');

    const dup = await h
      .http()
      .post(base)
      .set(admin)
      .send({ name: 'Meena', phone, role: 'OWNER' })
      .expect(409);
    expect(dup.body.error.code).toBe('MEMBER_EXISTS');

    // The same login can join a second shop (keeps its password).
    const other = await createShop(h.prisma);
    const second = await h
      .http()
      .post(`/api/sudo/shops/${other.id}/members`)
      .set(admin)
      .send({ name: 'Meena', phone, role: 'OPERATOR' })
      .expect(201);
    expect(second.body).toMatchObject({ existingUser: true, temporaryPassword: null });

    await h.http().patch(`${base}/${userId}`).set(admin).send({ role: 'OWNER' }).expect(200);
    const reset = await h
      .http()
      .post(`${base}/${userId}/reset-password`)
      .set(admin)
      .send({})
      .expect(200);
    expect(reset.body.temporaryPassword).toMatch(/^.{4}-.{4}-.{4}$/);
    await h
      .http()
      .post('/api/admin/auth/login')
      .send({ login: phone, password: 'Chosen-Pass-99' })
      .expect(401);
    await login(phone, reset.body.temporaryPassword);

    await h.http().delete(`${base}/${userId}`).set(admin).expect(200);
    await h.http().delete(`${base}/${userId}`).set(admin).expect(404);

    // A platform admin can't be shop staff.
    const asAdmin = await h
      .http()
      .post(base)
      .set(admin)
      .send({
        name: 'Me',
        email: (await h.prisma.user.findUniqueOrThrow({ where: { id: adminId } })).email,
        role: 'OWNER',
      })
      .expect(409);
    expect(asAdmin.body.error.code).toBe('ACCOUNT_IS_ADMIN');
  });
});

describe('platform admins', () => {
  it('create (generated password), no self-removal, remove another', async () => {
    const email = `new-admin-${tag()}@e2e.kagaz.local`;
    const created = await h
      .http()
      .post('/api/sudo/admins')
      .set(admin)
      .send({ name: 'Second Admin', email })
      .expect(201);
    const newAdmin = await login(email, created.body.temporaryPassword);
    await h.http().get('/api/sudo/shops').set(newAdmin).expect(200);

    const self = await h.http().delete(`/api/sudo/admins/${adminId}`).set(admin).expect(409);
    expect(self.body.error.code).toBe('CANNOT_REMOVE_SELF');

    const list = await h.http().get('/api/sudo/admins').set(admin).expect(200);
    expect(list.body.admins.find((a: { id: string }) => a.id === adminId).isSelf).toBe(true);

    await h.http().delete(`/api/sudo/admins/${created.body.admin.id}`).set(admin).expect(200);
    await h.http().get('/api/sudo/shops').set(newAdmin).expect(401);
  });
});

describe('overview', () => {
  it('reports MRR from active subscriptions and lists shops needing attention', async () => {
    const plan = await createPlan({ trialDays: 0, pricePaise: 120_000, interval: 'YEARLY' });
    const shop = await createShop(h.prisma);
    await h.prisma.shop.update({ where: { id: shop.id }, data: { isDemo: false } });
    const sub = await h
      .http()
      .post(`/api/sudo/shops/${shop.id}/subscriptions`)
      .set(admin)
      .send({ planId: plan.id })
      .expect(201);
    let ov = await h.http().get('/api/sudo/overview').set(admin).expect(200);
    expect(ov.body.attention).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ shopId: shop.id, kind: 'OVERDUE' }),
        expect.objectContaining({ shopId: shop.id, kind: 'NOT_PAIRED' }),
      ]),
    );
    const before = ov.body.collectedThisMonthPaise as number;
    const mrrBefore = ov.body.mrrPaise as number;
    await h
      .http()
      .post(`/api/sudo/shops/${shop.id}/subscriptions/${sub.body.id}/payments`)
      .set(admin)
      .send({ amountPaise: 120_000, method: 'BANK_TRANSFER' })
      .expect(201);
    ov = await h.http().get('/api/sudo/overview').set(admin).expect(200);
    expect(ov.body.collectedThisMonthPaise).toBe(before + 120_000);
    expect(ov.body.mrrPaise).toBe(mrrBefore); // already ACTIVE: 120000 / 12 counted before
    expect(
      ov.body.attention.some(
        (a: { shopId: string; kind: string }) => a.shopId === shop.id && a.kind === 'OVERDUE',
      ),
    ).toBe(false);
  });
});
