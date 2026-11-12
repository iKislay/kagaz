import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomCode } from '../../src/common/crypto/tokens.js';
import { istDay, istMidnight, periodTotal } from '../../src/modules/billing/billing-math.js';
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

// ADR-004 enforcement on for this file only (other suites run with it off and create orders freely).
const previous = process.env.BILLING_ENFORCED;
let h: Harness;
let admin: Record<string, string>;

async function login(login: string, password: string) {
  const res = await h.http().post('/api/admin/auth/login').send({ login, password }).expect(200);
  const raw = res.headers['set-cookie'] as unknown as string[] | string;
  const cookie = (Array.isArray(raw) ? raw : [raw]).find((c) => c.startsWith('kgz_admin='))!;
  return { Cookie: cookie.split(';')[0]! };
}

beforeAll(async () => {
  process.env.BILLING_ENFORCED = 'true';
  h = await createHarness();
  const email = `admin-${randomCode(6).toLowerCase()}@e2e.kaggaz.local`;
  await h.prisma.user.create({
    data: { email, kind: 'ADMIN', passwordHash: await hashPassword('Admin-Pass-123!') },
  });
  admin = await login(email, 'Admin-Pass-123!');
});
afterAll(async () => {
  await h.close();
  if (previous === undefined) delete process.env.BILLING_ENFORCED;
  else process.env.BILLING_ENFORCED = previous;
});

const newOrder = (shopId: string) => h.http().post('/api/orders').send({ shopId, options: MONO });
const printer = (name: string) => ({
  printerName: name,
  colourCapable: false,
  duplexCapable: false,
  capabilitiesConfirmed: true,
});

describe('subscriptions (ADR-004)', () => {
  it('plan, ledger, balance, order + printer-seat enforcement, cancel', async () => {
    const shop = await createShop(h.prisma);
    const device = await pairDevice(h, shop.id);
    const billing = `/api/admin/shops/${shop.id}/billing`;

    // No plan: no new orders, no printers.
    expect((await h.http().get(billing).set(admin).expect(200)).body.summary.status).toBe('NONE');
    expect((await newOrder(shop.id).expect(409)).body.error.code).toBe('SUBSCRIPTION_INACTIVE');
    const noSeats = await h
      .http()
      .put('/api/shop/printers')
      .set(device.opAuth)
      .send({ printers: [printer('Counter Laser')] })
      .expect(409);
    expect(noSeats.body.error.code).toBe('PRINTER_LIMIT_REACHED');

    // 1 printer × ₹499 × 3 months.
    const today = istDay(new Date());
    const created = await h
      .http()
      .post(`/api/admin/shops/${shop.id}/subscriptions`)
      .set(admin)
      .send({ printerSeats: 1, pricePerPrinterPaise: 49_900, startDate: today, months: 3 })
      .expect(200);
    expect(created.body.summary).toMatchObject({ status: 'ACTIVE', printerSeats: 1 });
    const sub = created.body.subscriptions[0];
    expect(sub).toMatchObject({ totalPaise: 149_700, paidPaise: 0, balancePaise: 149_700 });

    // Overlapping second plan is refused.
    const overlap = await h
      .http()
      .post(`/api/admin/shops/${shop.id}/subscriptions`)
      .set(admin)
      .send({ printerSeats: 2, pricePerPrinterPaise: 49_900, startDate: today, months: 1 })
      .expect(409);
    expect(overlap.body.error.code).toBe('SUBSCRIPTION_OVERLAP');

    // Ledger: a payment and a correction.
    const pay = (amountPaise: number, reference?: string) =>
      h
        .http()
        .post(`/api/admin/shops/${shop.id}/subscriptions/${sub.id}/payments`)
        .set(admin)
        .send({ amountPaise, method: 'UPI', reference, receivedDate: today })
        .expect(200);
    await pay(100_000, 'UTR123');
    const corrected = await pay(-10_000);
    expect(corrected.body.subscriptions[0]).toMatchObject({
      paidPaise: 90_000,
      balancePaise: 59_700,
    });
    expect(corrected.body.subscriptions[0].payments).toHaveLength(2);

    // Within seats: one printer OK, two refused (whole change rolls back).
    await h
      .http()
      .put('/api/shop/printers')
      .set(device.opAuth)
      .send({ printers: [printer('Counter Laser')] })
      .expect(200);
    const over = await h
      .http()
      .put('/api/shop/printers')
      .set(device.opAuth)
      .send({ printers: [printer('Counter Laser'), printer('Back Inkjet')] })
      .expect(409);
    expect(over.body.error.message).toContain('covers 1 printer');
    expect(await h.prisma.printer.count({ where: { shopId: shop.id, enabled: true } })).toBe(1);

    // Orders allowed; the agent sees its plan in the heartbeat.
    await newOrder(shop.id).expect(201);
    const hb = await h.http().post('/api/shop/heartbeat').set(device.auth).send({}).expect(200);
    expect(hb.body.subscription).toMatchObject({ status: 'ACTIVE', printerSeats: 1 });

    const overview = await h.http().get('/api/admin/billing').set(admin).expect(200);
    expect(overview.body.shops.find((s: { shopId: string }) => s.shopId === shop.id)).toMatchObject(
      { status: 'ACTIVE', printerSeats: 1, connectedPrinters: 1, balanceDuePaise: 59_700 },
    );

    // Cancel: back to no plan, new orders refused again.
    const cancelled = await h
      .http()
      .post(`/api/admin/shops/${shop.id}/subscriptions/${sub.id}/cancel`)
      .set(admin)
      .send({ reason: 'Shop closed down' })
      .expect(200);
    expect(cancelled.body.summary.status).toBe('NONE');
    await newOrder(shop.id).expect(409);
  });

  it('change plan mid-period and extend: totals, shop balance, overlap rejection, history + audit', async () => {
    const shop = await createShop(h.prisma);
    const base = `/api/admin/shops/${shop.id}/subscriptions`;
    const DAY = 86_400_000;
    const start = istDay(new Date(Date.now() - 10 * DAY));
    const today = istDay(new Date());

    // 1 printer × ₹600 × 2 months, fully paid.
    const created = await h
      .http()
      .post(base)
      .set(admin)
      .send({ printerSeats: 1, pricePerPrinterPaise: 60_000, startDate: start, months: 2 })
      .expect(200);
    const sub = created.body.subscriptions[0];
    expect(sub.totalPaise).toBe(120_000);
    await h
      .http()
      .post(`${base}/${sub.id}/payments`)
      .set(admin)
      .send({ amountPaise: 120_000, method: 'CASH', receivedDate: start })
      .expect(200);

    // Same terms → refused; date outside the period → refused.
    await h
      .http()
      .post(`${base}/${sub.id}/change-plan`)
      .set(admin)
      .send({ printerSeats: 1, pricePerPrinterPaise: 60_000, effectiveDate: today, reason: 'noop' })
      .expect(409);
    await h
      .http()
      .post(`${base}/${sub.id}/change-plan`)
      .set(admin)
      .send({ printerSeats: 2, pricePerPrinterPaise: 60_000, effectiveDate: start, reason: 'x?!' })
      .expect(409);

    // A second printer from today: the old period ends today, a successor covers the rest.
    const changed = await h
      .http()
      .post(`${base}/${sub.id}/change-plan`)
      .set(admin)
      .send({
        printerSeats: 2,
        pricePerPrinterPaise: 60_000,
        effectiveDate: today,
        reason: 'Added a printer',
      })
      .expect(200);
    const end = new Date(sub.periodEnd);
    const old = changed.body.subscriptions.find((s: { id: string }) => s.id === sub.id);
    const next = changed.body.subscriptions.find((s: { id: string }) => s.id !== sub.id);
    expect(old).toMatchObject({
      periodEnd: istMidnight(today).toISOString(),
      totalPaise: periodTotal(1, 60_000, istMidnight(start), istMidnight(today)),
      paidPaise: 120_000,
    });
    expect(old.changes[0]).toMatchObject({
      kind: 'CHANGE_PLAN',
      reason: 'Added a printer',
      before: { printerSeats: 1, totalPaise: 120_000 },
      after: { successorId: next.id },
    });
    expect(next).toMatchObject({
      printerSeats: 2,
      periodStart: istMidnight(today).toISOString(),
      periodEnd: sub.periodEnd,
      totalPaise: periodTotal(2, 60_000, istMidnight(today), end),
      paidPaise: 0,
    });
    // The prepaid credit on the old period offsets the new one.
    expect(changed.body.balancePaise).toBe(old.totalPaise - 120_000 + next.totalPaise);
    expect(changed.body.summary).toMatchObject({ status: 'ACTIVE', printerSeats: 2 });

    // Extending the old period would overlap the successor.
    const overlap = await h
      .http()
      .post(`${base}/${sub.id}/end-date`)
      .set(admin)
      .send({ endDate: istDay(new Date(Date.now() + 5 * DAY)), reason: 'Mistake' })
      .expect(409);
    expect(overlap.body.error.code).toBe('SUBSCRIPTION_OVERLAP');

    // Extend the successor by a month: total recomputed, revision kept.
    const newEnd = istDay(new Date(end.getTime() + 31 * DAY));
    const extended = await h
      .http()
      .post(`${base}/${next.id}/end-date`)
      .set(admin)
      .send({ endDate: newEnd, reason: 'Free month for referral' })
      .expect(200);
    const after = extended.body.subscriptions.find((s: { id: string }) => s.id === next.id);
    expect(after).toMatchObject({
      periodEnd: istMidnight(newEnd).toISOString(),
      totalPaise: periodTotal(2, 60_000, istMidnight(today), istMidnight(newEnd)),
    });
    expect(after.changes[0]).toMatchObject({
      kind: 'EXTEND',
      reason: 'Free month for referral',
      before: { periodEnd: sub.periodEnd, totalPaise: next.totalPaise },
    });

    const actions = (
      await h.prisma.auditLog.findMany({ where: { shopId: shop.id }, select: { action: true } })
    ).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'subscription.created',
        'subscription.payment_recorded',
        'subscription.plan_changed',
        'subscription.end_date_changed',
      ]),
    );
  });

  it('billing is for Kaggaz admins only', async () => {
    const shop = await createShop(h.prisma);
    const owner = await createStaff(h.prisma, shop.id, 'OWNER');
    // Shop owners can't sign in to /superadmin at all, so they never get a session.
    await h
      .http()
      .post('/api/admin/auth/login')
      .send({ login: owner.email, password: E2E_STAFF_PASSWORD })
      .expect(403);
    await h.http().get(`/api/admin/shops/${shop.id}/billing`).expect(401);
    await h.http().get('/api/admin/billing').expect(401);
    await h
      .http()
      .post(`/api/admin/shops/${shop.id}/subscriptions`)
      .send({ printerSeats: 1, pricePerPrinterPaise: 1, startDate: '2026-11-12', months: 1 })
      .expect(401);
  });
});
