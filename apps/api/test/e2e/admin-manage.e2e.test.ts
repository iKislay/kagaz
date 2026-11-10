import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AdminReconciliation } from '@kagaz/shared';
import { generateToken, randomCode, sha256Hex } from '../../src/common/crypto/tokens.js';
import { hashPassword } from '../../src/modules/identity/passwords.js';
import { PrinterUptimeSampler } from '../../src/modules/admin/health.service.js';
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
let admin: Record<string, string>;

async function login(login: string, password: string): Promise<Record<string, string>> {
  const res = await h.http().post('/api/admin/auth/login').send({ login, password }).expect(200);
  const raw = res.headers['set-cookie'] as unknown as string[] | string;
  const cookie = (Array.isArray(raw) ? raw : [raw]).find((c) => c.startsWith('kgz_admin='))!;
  return { Cookie: cookie.split(';')[0]! };
}

beforeAll(async () => {
  h = await createHarness();
  const email = `admin-${randomCode(6).toLowerCase()}@e2e.kagaz.local`;
  await h.prisma.user.create({
    data: {
      email,
      name: 'E2E Admin',
      kind: 'ADMIN',
      passwordHash: await hashPassword('Admin-Pass-123!'),
    },
  });
  admin = await login(email, 'Admin-Pass-123!');
});
afterAll(async () => {
  await h.close();
});

describe('device enrollment + revocation (P2.4)', () => {
  it('admin code → enroll once → revoke → 401 DEVICE_REVOKED for device and operator', async () => {
    const shop = await createShop(h.prisma);
    const created = await h
      .http()
      .post(`/api/admin/shops/${shop.id}/enrollment-codes`)
      .set(admin)
      .expect(201);
    expect(created.body.code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    const ttl = Date.parse(created.body.expiresAt) - Date.now();
    expect(ttl).toBeGreaterThan(29 * 60_000);
    expect(ttl).toBeLessThanOrEqual(30 * 60_000);
    // Stored hashed only; the audit row doesn't carry the code either.
    const row = await h.prisma.enrollmentCode.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(row.codeHash).not.toContain(created.body.code.replace('-', ''));
    const audit = await h.prisma.auditLog.findFirstOrThrow({
      where: { shopId: shop.id, action: 'enrollment_code.created' },
    });
    expect(JSON.stringify(audit.metadata)).not.toContain(created.body.code.replace('-', ''));

    const enrolled = await h
      .http()
      .post('/api/devices/enroll')
      .send({ code: created.body.code, name: 'Front desk' })
      .expect(201);
    await h
      .http()
      .post('/api/devices/enroll')
      .send({ code: created.body.code, name: 'Again' })
      .expect(400);
    const codes = await h
      .http()
      .get(`/api/admin/shops/${shop.id}/enrollment-codes`)
      .set(admin)
      .expect(200);
    expect(codes.body.codes[0]).toMatchObject({ id: created.body.id, state: 'USED' });

    const auth = { Authorization: `Bearer ${enrolled.body.deviceToken}` };
    const staff = await createStaff(h.prisma, shop.id);
    const op = await h
      .http()
      .post('/api/shop/operator/login')
      .set(auth)
      .send({ login: staff.email, password: E2E_STAFF_PASSWORD })
      .expect(200);

    const list = await h.http().get(`/api/admin/shops/${shop.id}/devices`).set(admin).expect(200);
    expect(list.body.devices).toEqual([
      expect.objectContaining({
        id: enrolled.body.device.id,
        status: 'ACTIVE',
        health: 'ONLINE',
        activeOperator: { id: staff.userId, name: staff.name },
      }),
    ]);

    const revoked = await h
      .http()
      .patch(`/api/admin/shops/${shop.id}/devices/${enrolled.body.device.id}`)
      .set(admin)
      .send({ status: 'REVOKED' })
      .expect(200);
    expect(revoked.body).toMatchObject({
      status: 'REVOKED',
      health: 'REVOKED',
      activeOperator: null,
    });

    const denied = await h.http().get('/api/shop/jobs').set(auth).expect(401);
    expect(denied.body.error.code).toBe('DEVICE_REVOKED');
    const heartbeat = await h.http().post('/api/devices/heartbeat').set(auth).send({}).expect(401);
    expect(heartbeat.body.error.code).toBe('DEVICE_REVOKED');
    await h
      .http()
      .post('/api/shop/pickups/verify')
      .set({ ...auth, 'X-Operator-Token': op.body.operatorToken })
      .send({ code: 'ABCD-EFGH' })
      .expect(401);
    expect(
      await h.prisma.operatorSession.count({
        where: { deviceId: enrolled.body.device.id, revokedAt: null },
      }),
    ).toBe(0);
    expect(
      await h.prisma.auditLog.count({
        where: { shopId: shop.id, action: 'device.revoked', actorType: 'ADMIN' },
      }),
    ).toBe(1);

    // Another shop's device id under this shop's path is a 404.
    const other = await createShop(h.prisma);
    const otherDevice = await pairDevice(h, other.id);
    await h
      .http()
      .patch(`/api/admin/shops/${shop.id}/devices/${otherDevice.deviceId}`)
      .set(admin)
      .send({ status: 'REVOKED' })
      .expect(404);
  });
});

describe('roles + shop scope (P2.3 / P4.3)', () => {
  it('owners see and edit only their own shop, and only owner fields', async () => {
    const mine = await createShop(h.prisma);
    const theirs = await createShop(h.prisma);
    const owner = await createStaff(h.prisma, mine.id, 'OWNER');
    const session = await login(owner.email, E2E_STAFF_PASSWORD);

    const me = await h.http().get('/api/admin/auth/me').set(session).expect(200);
    expect(me.body).toMatchObject({
      role: 'SHOP_OWNER',
      shops: [{ id: mine.id, role: 'SHOP_OWNER' }],
    });

    const list = await h.http().get('/api/admin/shops').set(session).expect(200);
    expect(list.body.shops.map((s: { id: string }) => s.id)).toEqual([mine.id]);
    await h.http().get(`/api/admin/shops/${theirs.id}`).set(session).expect(404);
    await h
      .http()
      .patch(`/api/admin/shops/${theirs.id}`)
      .set(session)
      .send({ autoPaused: true })
      .expect(404);
    await h.http().get(`/api/admin/shops/${theirs.id}/pricing`).set(session).expect(404);

    const hours = {
      mon: [
        ['09:00', '13:00'],
        ['14:00', '20:00'],
      ],
      sun: [],
    };
    const updated = await h
      .http()
      .patch(`/api/admin/shops/${mine.id}`)
      .set(session)
      .send({ openingHours: hours, approvalMode: 'AUTO', autoPaused: true })
      .expect(200);
    expect(updated.body).toMatchObject({ approvalMode: 'AUTO', autoPaused: true });
    expect(updated.body.openingHours.mon).toEqual(hours.mon);
    expect(updated.body.openingHours.tue).toEqual([]);

    const forbidden = await h
      .http()
      .patch(`/api/admin/shops/${mine.id}`)
      .set(session)
      .send({ status: 'MAINTENANCE' })
      .expect(403);
    expect(forbidden.body.error.code).toBe('FORBIDDEN_FIELD');

    // Admin-only areas.
    await h.http().get('/api/admin/health').set(session).expect(403);
    await h.http().get('/api/admin/orders').set(session).expect(403);
    await h.http().post(`/api/admin/shops/${mine.id}/enrollment-codes`).set(session).expect(403);

    const audit = await h.prisma.auditLog.findMany({ where: { shopId: mine.id } });
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(['shop.updated', 'SHOP_MODE_CHANGED']),
    );
    expect(audit.find((a) => a.action === 'shop.updated')).toMatchObject({
      actorType: 'STAFF',
      actorId: owner.userId,
    });

    // Operators have no web role.
    const operator = await createStaff(h.prisma, mine.id, 'OPERATOR');
    const opSession = await login(operator.email, E2E_STAFF_PASSWORD);
    await h.http().get('/api/admin/shops').set(opSession).expect(403);
  });
});

describe('shop settings, printers, pricing (P4.3)', () => {
  it('admin edits every setting; each change is audited', async () => {
    const created = await h
      .http()
      .post('/api/admin/shops')
      .set(admin)
      .send({
        slug: `e2e-new-${randomCode(4).toLowerCase()}`,
        name: 'New Shop',
        address: 'Road 1, Mandya',
      })
      .expect(201);
    const id = created.body.id as string;
    expect(created.body).toMatchObject({ status: 'CLOSED', approvalMode: 'MANUAL' });

    const res = await h
      .http()
      .patch(`/api/admin/shops/${id}`)
      .set(admin)
      .send({
        name: 'New Shop — Renamed',
        contactPhone: '+919876543210',
        status: 'OPEN',
        autoLimits: { maxPages: 20, maxCopies: 3, maxSides: 60, maxQueueDepth: 4 },
        isDemo: true,
      })
      .expect(200);
    expect(res.body).toMatchObject({
      name: 'New Shop — Renamed',
      status: 'OPEN',
      autoLimits: { maxPages: 20, maxQueueDepth: 4 },
    });
    await h.http().patch(`/api/admin/shops/${id}`).set(admin).send({ status: 'NOPE' }).expect(400);
    await h
      .http()
      .patch(`/api/admin/shops/${id}`)
      .set(admin)
      .send({ openingHours: { mon: [['20:00', '09:00']] } })
      .expect(400);
    const updatedAudit = await h.prisma.auditLog.findFirstOrThrow({
      where: { shopId: id, action: 'shop.updated' },
    });
    expect(updatedAudit.metadata).toMatchObject({
      changes: { status: { from: 'CLOSED', to: 'OPEN' } },
    });

    // Printers: two registered by the shop app; admin disables one and moves the default.
    const paired = await pairDevice(h, id);
    const reg = await h
      .http()
      .put('/api/shop/printers')
      .set(paired.opAuth)
      .send({
        printers: [
          {
            printerName: 'P1',
            colourCapable: false,
            duplexCapable: true,
            capabilitiesConfirmed: true,
            isDefault: true,
          },
          {
            printerName: 'P2',
            colourCapable: true,
            duplexCapable: false,
            capabilitiesConfirmed: true,
          },
        ],
      })
      .expect(200);
    const [p1, p2] = reg.body as { id: string; printerName: string }[];
    const moved = await h
      .http()
      .patch(`/api/admin/shops/${id}/printers/${p2!.id}`)
      .set(admin)
      .send({ isDefault: true, displayName: 'Colour printer' })
      .expect(200);
    expect(moved.body).toMatchObject({
      isDefault: true,
      displayName: 'Colour printer',
      queueDepth: 0,
    });
    const disabled = await h
      .http()
      .patch(`/api/admin/shops/${id}/printers/${p1!.id}`)
      .set(admin)
      .send({ enabled: false })
      .expect(200);
    expect(disabled.body).toMatchObject({ enabled: false, isDefault: false });
    expect(
      await h.prisma.auditLog.count({ where: { shopId: id, action: 'printer.updated' } }),
    ).toBe(2);

    // Pricing versions: past start refused; a new version becomes current.
    await h
      .http()
      .post(`/api/admin/shops/${id}/pricing`)
      .set(admin)
      .send({
        monoRatePaise: 100,
        colourRatePaise: 500,
        duplexRule: 'SAME_AS_SIMPLEX',
        minimumChargePaise: 0,
        effectiveFrom: new Date(Date.now() - 3_600_000).toISOString(),
      })
      .expect(422); // past effectiveFrom is a business-rule error (P2.5)
    await h
      .http()
      .post(`/api/admin/shops/${id}/pricing`)
      .set(admin)
      .send({
        monoRatePaise: 100,
        colourRatePaise: 500,
        duplexRule: 'DISCOUNTED_SIDE_RATE',
        minimumChargePaise: 0,
      })
      .expect(400);
    const v = await h
      .http()
      .post(`/api/admin/shops/${id}/pricing`)
      .set(admin)
      .send({
        monoRatePaise: 150,
        colourRatePaise: 900,
        monoDuplexRatePaise: 120,
        colourDuplexRatePaise: 800,
        duplexRule: 'DISCOUNTED_SIDE_RATE',
        minimumChargePaise: 300,
      })
      .expect(201);
    expect(v.body).toMatchObject({ current: true, monoRatePaise: 150 });
    const versions = await h.http().get(`/api/admin/shops/${id}/pricing`).set(admin).expect(200);
    expect(versions.body.versions).toHaveLength(1);
    expect(
      await h.prisma.auditLog.count({ where: { shopId: id, action: 'pricing.version_created' } }),
    ).toBe(1);
  });
});

describe('health (P4.4) and overview (P4.8)', () => {
  it('reports device ONLINE/STALE/OFFLINE and printer queue depth; samples uptime', async () => {
    const shop = await createShop(h.prisma, { printer: true });
    const paired = await pairDevice(h, shop.id);
    const printer = await h.prisma.printer.findFirstOrThrow({ where: { shopId: shop.id } });
    await h.prisma.printer.update({ where: { id: printer.id }, data: { status: 'READY' } });

    const healthOf = async () =>
      (await h.http().get('/api/admin/health').set(admin).expect(200)).body.shops.find(
        (s: { shopId: string }) => s.shopId === shop.id,
      );
    expect(await healthOf()).toMatchObject({
      online: true,
      devices: [{ id: paired.deviceId, health: 'ONLINE', versionDrift: false }],
      printers: [{ id: printer.id, status: 'READY', queueDepth: 0 }],
    });

    await h.app.get(PrinterUptimeSampler).sampleOnce();
    await h.prisma.shopDevice.update({
      where: { id: paired.deviceId },
      data: { lastHeartbeatAt: new Date(Date.now() - 120_000) },
    });
    expect((await healthOf()).devices[0].health).toBe('STALE');
    await h.app.get(PrinterUptimeSampler).sampleOnce();
    await h.prisma.shopDevice.update({
      where: { id: paired.deviceId },
      data: { lastHeartbeatAt: new Date(Date.now() - 600_000) },
    });
    expect(await healthOf()).toMatchObject({ online: false, devices: [{ health: 'OFFLINE' }] });

    const overview = await h
      .http()
      .get(`/api/admin/overview?days=7&shopId=${shop.id}`)
      .set(admin)
      .expect(200);
    expect(overview.body.printerUptime).toEqual([
      expect.objectContaining({ printerId: printer.id, observedSamples: 2, uptimeRatio: 0.5 }),
    ]);
    expect(overview.body.byDay).toHaveLength(7);
  });

  it('overview counts orders and turnaround; audit shows the operator name', async () => {
    const shop = await createShop(h.prisma, { printer: true });
    const paired = await pairDevice(h, shop.id);
    const created = await createOrder(h, shop.id);
    expect((await uploadPdf(h, created, await makePdf(1))).status).toBe(200);
    await h
      .http()
      .post(`/api/orders/${created.order.id}/pay`)
      .set('x-tracking-token', created.trackingToken)
      .expect(200);
    await h
      .http()
      .post(`/api/shop/jobs/${created.order.id}/accept`)
      .set(paired.opAuth)
      .send({})
      .expect(200);

    const audit = await h
      .http()
      .get(`/api/admin/audit?orderId=${created.order.id}&actorType=STAFF`)
      .set(admin)
      .expect(200);
    expect(audit.body.items[0]).toMatchObject({
      action: 'order.accepted',
      actorName: paired.operatorName,
    });
    const detail = await h
      .http()
      .get(`/api/admin/orders/${created.order.id}`)
      .set(admin)
      .expect(200);
    expect(detail.body.events.at(-1)).toMatchObject({
      toStatus: 'QUEUED',
      actorName: paired.operatorName,
    });

    // Turnaround fixtures: paid → ready 10 min, ready → collected 30 min.
    const t0 = Date.now() - 3_600_000;
    await h.prisma.order.update({
      where: { id: created.order.id },
      data: {
        paidAt: new Date(t0),
        readyAt: new Date(t0 + 600_000),
        collectedAt: new Date(t0 + 2_400_000),
      },
    });
    const overview = await h
      .http()
      .get(`/api/admin/overview?shopId=${shop.id}`)
      .set(admin)
      .expect(200);
    expect(overview.body.totals).toMatchObject({ orders: 1, paidOrders: 1 });
    expect(overview.body.byShop[0].byStatus).toEqual({ QUEUED: 1 });
    expect(overview.body.turnaround).toMatchObject({
      paidToReadyMedianSeconds: 600,
      readyToCollectedMedianSeconds: 1800,
    });
  });
});

describe('reconciliation (P3.7, T20)', () => {
  let n = 0;
  async function fixture(
    shopId: string,
    o: { status: string; rejectionCode?: string; paidHoursAgo?: number },
    payment?: { status: string; refund?: { status: string; completed?: boolean } },
  ) {
    n += 1;
    const paidAt =
      o.paidHoursAgo === undefined ? null : new Date(Date.now() - o.paidHoursAgo * 3_600_000);
    const order = await h.prisma.order.create({
      data: {
        publicRef: `KGZ-R${randomCode(5)}`,
        shopId,
        options: { copies: 1, colour: false, duplex: false, paperSize: 'A4' },
        amountPaise: 500,
        status: o.status as 'COLLECTED',
        rejectionCode: o.rejectionCode ?? null,
        trackingTokenHash: sha256Hex(generateToken()),
        paidAt,
      },
    });
    if (payment) {
      const p = await h.prisma.payment.create({
        data: {
          orderId: order.id,
          provider: 'demo',
          providerOrderId: `demo-recon-${n}-${randomCode(6)}`,
          amountPaise: 500,
          status: payment.status as 'PAID',
          isSimulated: true,
          verifiedAt: paidAt ?? new Date(),
        },
      });
      if (payment.refund) {
        await h.prisma.refund.create({
          data: {
            paymentId: p.id,
            amountPaise: 500,
            status: payment.refund.status as 'SUCCEEDED',
            idempotencyKey: `recon-${n}-${randomCode(6)}`,
            isSimulated: true,
            completedAt: payment.refund.completed ? new Date() : null,
          },
        });
      }
    }
    return order;
  }

  const report = async (query: string) =>
    (await h.http().get(`/api/admin/reconciliation?${query}`).set(admin).expect(200))
      .body as AdminReconciliation;

  it('clean data shows zero mismatches and correct totals', async () => {
    const shop = await createShop(h.prisma);
    await fixture(shop.id, { status: 'COLLECTED', paidHoursAgo: 1 }, { status: 'PAID' });
    await fixture(
      shop.id,
      { status: 'REFUNDED', rejectionCode: 'OTHER', paidHoursAgo: 1 },
      { status: 'REFUNDED', refund: { status: 'SUCCEEDED', completed: true } },
    );
    await fixture(shop.id, { status: 'PENDING_REVIEW', paidHoursAgo: 0.5 }, { status: 'PAID' });
    const r = await report(`shopId=${shop.id}`);
    expect(r.mismatches).toEqual([]);
    expect(r.totals).toEqual({
      paidPaise: 1500,
      refundedPaise: 500,
      netPaise: 1000,
      mismatches: 0,
    });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({
      paidCount: 3,
      refundCount: 1,
      simulatedPaidPaise: 1500,
      ordersByStatus: { COLLECTED: 1, REFUNDED: 1, PENDING_REVIEW: 1 },
    });
  });

  it('seeded inconsistent fixtures are flagged', async () => {
    const shop = await createShop(h.prisma);
    const stuck = await fixture(shop.id, { status: 'QUEUED', paidHoursAgo: 5 }, { status: 'PAID' });
    const noRefund = await fixture(
      shop.id,
      { status: 'REJECTED', rejectionCode: 'OTHER', paidHoursAgo: 1 },
      { status: 'PAID' },
    );
    const strayRefund = await fixture(
      shop.id,
      { status: 'COLLECTED', paidHoursAgo: 1 },
      { status: 'PAID', refund: { status: 'PENDING' } },
    );
    const halfRefunded = await fixture(
      shop.id,
      { status: 'REFUND_PENDING', rejectionCode: 'OTHER', paidHoursAgo: 1 },
      { status: 'REFUNDED', refund: { status: 'SUCCEEDED', completed: true } },
    );
    await h.prisma.webhookEvent.create({
      data: {
        provider: 'demo',
        providerEventId: `evt-${randomCode(8)}`,
        signatureValid: true,
        rawPayloadHash: sha256Hex('x'),
        receivedAt: new Date(Date.now() - 3_600_000),
      },
    });

    const r = await report(`shopId=${shop.id}&stuckHours=2`);
    expect(r.mismatches.map((m) => [m.type, m.orderId]).sort()).toEqual(
      [
        ['PAID_NO_PROGRESS', stuck.id],
        ['REJECTED_WITHOUT_REFUND', noRefund.id],
        ['REFUND_WITHOUT_REJECTION', strayRefund.id],
        ['REFUND_STATUS_MISMATCH', halfRefunded.id],
      ].sort(),
    );
    expect((await report('stuckHours=2')).mismatches.map((m) => m.type)).toContain(
      'WEBHOOK_UNPROCESSED',
    );
    // A higher threshold clears the stuck flag.
    expect(
      (await report(`shopId=${shop.id}&stuckHours=6`)).mismatches.map((m) => m.type),
    ).not.toContain('PAID_NO_PROGRESS');
    await h.http().get('/api/admin/reconciliation?from=2026-13-01').set(admin).expect(400);
  });
});
