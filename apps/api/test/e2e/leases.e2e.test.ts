import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type HeartbeatResponse, type ShopJob } from '@kagaz/shared';
import { DeviceHealthService } from '../../src/modules/devices/device-health.service.js';
import { PrintLeaseService } from '../../src/modules/printing/print-leases.service.js';
import { type Harness, createHarness } from './harness.js';
import {
  acceptedOrder,
  customerView,
  enrollDevice,
  pairedShop,
  paidOrder,
  printingOrder,
} from './shop-helpers.js';

/** P2.7 leases + sweeper, P2.10 status reports + printer health, P4.4 heartbeat, P4.6 pack. */
let h: Harness;
let leases: PrintLeaseService;
beforeAll(async () => {
  h = await createHarness();
  leases = h.app.get(PrintLeaseService);
});
afterAll(async () => {
  await h.close();
});

const past = () => new Date(Date.now() - 5_000);

/** Make a job's lease (and its printer's) look expired, as if the agent died. */
async function expireLease(printJobId: string) {
  const job = await h.prisma.printJob.update({
    where: { id: printJobId },
    data: { leaseUntil: past() },
  });
  await h.prisma.printer.updateMany({
    where: { id: job.printerId, activeJobId: job.id },
    data: { leaseUntil: past() },
  });
}

describe('printer lease (P2.7, Appendix A.2)', () => {
  it('two agents racing for the same job/printer: exactly one wins (P4.6 duplicate lease)', async () => {
    const s = await pairedShop(h);
    const second = await enrollDevice(h, s.shop.id);
    const { created, printJobId } = await acceptedOrder(h, s);

    const results = await Promise.all([
      s.agent(`print-jobs/${printJobId}/lease`),
      h
        .http()
        .post(`/api/shop/print-jobs/${printJobId}/lease`)
        .set('Authorization', `Bearer ${second.deviceToken}`),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
    const loser = results.find((r) => r.status === 409)!;
    expect(['PRINTER_BUSY', 'JOB_NOT_LEASABLE']).toContain(loser.body.error.code);

    const printer = await h.prisma.printer.findUniqueOrThrow({ where: { id: s.printerId } });
    expect(printer.activeJobId).toBe(printJobId);
    const events = await h.prisma.orderEvent.count({
      where: { orderId: created.order.id, toStatus: 'PRINTING' },
    });
    expect(events).toBe(1);
  });

  it('many concurrent leases of one job by one device: one lease, one PRINTING event', async () => {
    const s = await pairedShop(h);
    const { created, printJobId } = await acceptedOrder(h, s);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => s.agent(`print-jobs/${printJobId}/lease`)),
    );
    expect(results.filter((r) => r.status === 200).length).toBeGreaterThanOrEqual(1);
    for (const r of results) expect([200, 409]).toContain(r.status);
    expect(
      await h.prisma.orderEvent.count({
        where: { orderId: created.order.id, toStatus: 'PRINTING' },
      }),
    ).toBe(1);
    const job = await h.prisma.printJob.findUniqueOrThrow({ where: { id: printJobId } });
    expect(job.status).toBe('LEASED');
  });

  it('lease failure codes: JOB_NOT_LEASABLE, NOT_NEXT_IN_QUEUE, PRINTER_BUSY', async () => {
    const s = await pairedShop(h);
    const a = await acceptedOrder(h, s);
    const b = await acceptedOrder(h, s);
    expect((await s.agent(`print-jobs/${b.printJobId}/lease`).expect(409)).body.error.code).toBe(
      'NOT_NEXT_IN_QUEUE',
    );
    await s.agent(`print-jobs/${a.printJobId}/lease`).expect(200);
    expect((await s.agent(`print-jobs/${b.printJobId}/lease`).expect(409)).body.error.code).toBe(
      'PRINTER_BUSY',
    );
    await s.agent(`print-jobs/${a.printJobId}/status`, { status: 'SPOOLER_COMPLETE' }).expect(200);
    expect((await s.agent(`print-jobs/${a.printJobId}/lease`).expect(409)).body.error.code).toBe(
      'JOB_NOT_LEASABLE',
    );
    await s.agent(`print-jobs/${b.printJobId}/lease`).expect(200);
  });

  it('expired lease → sweeper: job UNCERTAIN, order NEEDS_OPERATOR_CHECK, printer freed (T13/T14 server side)', async () => {
    const s = await pairedShop(h);
    const { created, printJobId } = await printingOrder(h, s);
    expect(await leases.sweep()).toBe(0); // still within TTL

    await expireLease(printJobId);
    expect(await leases.sweep()).toBe(1);
    expect(await leases.sweep()).toBe(0); // idempotent

    const job = await h.prisma.printJob.findUniqueOrThrow({ where: { id: printJobId } });
    expect(job).toMatchObject({ status: 'UNCERTAIN', leaseUntil: null });
    const printer = await h.prisma.printer.findUniqueOrThrow({ where: { id: s.printerId } });
    expect(printer).toMatchObject({ activeJobId: null, leaseUntil: null });
    const view = await customerView(h, created);
    expect(view.status).toBe('NEEDS_OPERATOR_CHECK');
    expect(view.pickupNumber).toBe(1); // ADR-002: kept from payment, whatever happens next
    const event = await h.prisma.orderEvent.findFirstOrThrow({
      where: { orderId: created.order.id, toStatus: 'NEEDS_OPERATOR_CHECK' },
    });
    expect(event).toMatchObject({ actorType: 'SYSTEM', fromStatus: 'PRINTING' });
    // Never auto-requeued: still exactly one attempt.
    expect(await h.prisma.printJob.count({ where: { orderId: created.order.id } })).toBe(1);
    // A late report from the agent can't resurrect it.
    await s.agent(`print-jobs/${printJobId}/status`, { status: 'SPOOLER_COMPLETE' }).expect(409);
  });

  it('heartbeat activePrintJobIds renew the lease, so the sweeper leaves it alone', async () => {
    const s = await pairedShop(h);
    const { printJobId } = await printingOrder(h, s);
    // Nearly expired…
    await h.prisma.printJob.update({
      where: { id: printJobId },
      data: { leaseUntil: new Date(Date.now() + 1_000) },
    });
    await s
      .agent('heartbeat', { appVersion: '0.3.0', activePrintJobIds: [printJobId] })
      .expect(200);
    const job = await h.prisma.printJob.findUniqueOrThrow({ where: { id: printJobId } });
    expect(job.leaseUntil!.getTime()).toBeGreaterThan(Date.now() + 50_000);
    const printer = await h.prisma.printer.findUniqueOrThrow({ where: { id: s.printerId } });
    expect(printer.leaseUntil!.getTime()).toBeGreaterThan(Date.now() + 50_000);
    expect(await leases.sweep()).toBe(0);
  });

  it('heartbeat cannot renew another device’s or another shop’s job', async () => {
    const s = await pairedShop(h);
    const other = await pairedShop(h);
    const { printJobId } = await printingOrder(h, s);
    await h.prisma.printJob.update({ where: { id: printJobId }, data: { leaseUntil: past() } });
    await other.agent('heartbeat', { activePrintJobIds: [printJobId] }).expect(200);
    const job = await h.prisma.printJob.findUniqueOrThrow({ where: { id: printJobId } });
    expect(job.leaseUntil!.getTime()).toBeLessThan(Date.now());
  });
});

describe('status reports (P2.10)', () => {
  it('UNCERTAIN → order NEEDS_OPERATOR_CHECK, lease cleared, never READY', async () => {
    const s = await pairedShop(h);
    const { created, printJobId } = await printingOrder(h, s);
    const res = await s
      .agent(`print-jobs/${printJobId}/status`, {
        status: 'UNCERTAIN',
        reason: 'Spooler job vanished',
      })
      .expect(200);
    expect(res.body).toMatchObject({
      status: 'NEEDS_OPERATOR_CHECK',
      printJob: { status: 'UNCERTAIN', error: 'Spooler job vanished' },
    });
    const printer = await h.prisma.printer.findUniqueOrThrow({ where: { id: s.printerId } });
    expect(printer.activeJobId).toBeNull();
    expect((await customerView(h, created)).status).toBe('NEEDS_OPERATOR_CHECK');
    // Only an operator resolve can move it on (ADR-002: no Mark Ready endpoint).
    await s.human(`jobs/${created.order.id}/ready`, { confirmed: true }).expect(404);
  });

  it('a report for a job this device does not hold → 404', async () => {
    const s = await pairedShop(h);
    const second = await enrollDevice(h, s.shop.id);
    const { printJobId } = await printingOrder(h, s);
    const res = await h
      .http()
      .post(`/api/shop/print-jobs/${printJobId}/status`)
      .set('Authorization', `Bearer ${second.deviceToken}`)
      .send({ status: 'SPOOLER_COMPLETE' })
      .expect(404);
    expect(res.body.error.code).toBe('PRINT_JOB_NOT_FOUND');
  });

  it('duplicate status reports (sequential and concurrent) apply once (P4.6)', async () => {
    const s = await pairedShop(h);
    const { created, printJobId } = await printingOrder(h, s);
    await s.agent(`print-jobs/${printJobId}/status`, { status: 'SUBMITTED' }).expect(200);
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        s.agent(`print-jobs/${printJobId}/status`, { status: 'FAILED', error: 'Paper out' }),
      ),
    );
    for (const r of results) expect([200, 409]).toContain(r.status);
    expect(results.some((r) => r.status === 200)).toBe(true);
    expect(
      await h.prisma.orderEvent.count({
        where: { orderId: created.order.id, toStatus: 'NEEDS_OPERATOR_CHECK' },
      }),
    ).toBe(1);
  });

  it('status reports renew the lease', async () => {
    const s = await pairedShop(h);
    const { printJobId } = await acceptedOrder(h, s);
    await s.agent(`print-jobs/${printJobId}/lease`).expect(200);
    await h.prisma.printJob.update({
      where: { id: printJobId },
      data: { leaseUntil: new Date(Date.now() + 1_000) },
    });
    await s.agent(`print-jobs/${printJobId}/status`, { status: 'SUBMITTED' }).expect(200);
    const job = await h.prisma.printJob.findUniqueOrThrow({ where: { id: printJobId } });
    expect(job.leaseUntil!.getTime()).toBeGreaterThan(Date.now() + 50_000);
  });
});

describe('duplicate accept (P4.6)', () => {
  it('concurrent accepts of one order: one QUEUED transition, one job, one packet, one number', async () => {
    const s = await pairedShop(h);
    const created = await paidOrder(h, s.shop.id);
    const results = await Promise.all(
      Array.from({ length: 3 }, () => s.human(`jobs/${created.order.id}/accept`)),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    for (const r of results.filter((x) => x.status !== 200)) {
      expect(r.status).toBe(409);
      expect(['INVALID_TRANSITION', 'CONCURRENT_MODIFICATION']).toContain(r.body.error.code);
    }
    const id = created.order.id;
    expect(await h.prisma.printJob.count({ where: { orderId: id } })).toBe(1);
    expect(await h.prisma.fileAsset.count({ where: { orderId: id, kind: 'PACKET' } })).toBe(1);
    expect((await h.prisma.order.findUniqueOrThrow({ where: { id } })).pickupNumber).toBe(1);
    expect(await h.prisma.orderEvent.count({ where: { orderId: id, toStatus: 'QUEUED' } })).toBe(1);
  });
});

describe('heartbeat + device health (P4.4, contract §1)', () => {
  it('stores health fields and printer status; answers the contract shape', async () => {
    const s = await pairedShop(h);
    const res = await s
      .agent('heartbeat', {
        appVersion: '0.3.1',
        os: 'Windows 11 10.0.26300',
        uptimeSeconds: 1234,
        queueDepth: 2,
        activePrintJobIds: [],
        printers: [{ printerId: s.printerId, status: 'PAPER_OUT', lastError: 'Tray 1 empty' }],
      })
      .expect(200);
    const body = res.body as HeartbeatResponse;
    expect(body).toMatchObject({
      leaseTtlSeconds: 60,
      minAgentVersion: null,
      upgradeRequired: false,
      shop: { status: 'OPEN', approvalMode: 'MANUAL', autoPaused: false },
    });
    expect(Date.parse(body.serverTime)).not.toBeNaN();

    const device = await h.prisma.shopDevice.findUniqueOrThrow({
      where: { id: s.device.device.id },
    });
    expect(device).toMatchObject({
      appVersion: '0.3.1',
      os: 'Windows 11 10.0.26300',
      uptimeSeconds: 1234,
      queueDepth: 2,
    });
    const printer = await h.prisma.printer.findUniqueOrThrow({ where: { id: s.printerId } });
    expect(printer).toMatchObject({ status: 'PAPER_OUT', lastError: 'Tray 1 empty' });

    const health = await h.app.get(DeviceHealthService).list(s.shop.id);
    expect(health).toEqual([
      expect.objectContaining({
        deviceId: s.device.device.id,
        connectivity: 'ONLINE',
        online: true,
        queueDepth: 2,
        printers: [
          expect.objectContaining({ printerId: s.printerId, status: 'PAPER_OUT', queueDepth: 0 }),
        ],
      }),
    ]);
    expect(await h.app.get(DeviceHealthService).isShopOnline(s.shop.id)).toBe(true);

    // Legacy path still works and returns the same shape.
    const legacy = await h.http().post('/api/devices/heartbeat').set(s.auth).send({}).expect(200);
    expect(legacy.body.leaseTtlSeconds).toBe(60);
  });

  it('a device without a recent heartbeat is offline', async () => {
    const s = await pairedShop(h);
    await h.prisma.shopDevice.update({
      where: { id: s.device.device.id },
      data: { lastHeartbeatAt: new Date(Date.now() - 10 * 60_000) },
    });
    const health = h.app.get(DeviceHealthService);
    expect(await health.isShopOnline(s.shop.id)).toBe(false);
    expect((await health.list(s.shop.id))[0]!.connectivity).toBe('OFFLINE');
  });

  it('heartbeat can only touch this shop’s printers', async () => {
    const s = await pairedShop(h);
    const other = await pairedShop(h);
    await other
      .agent('heartbeat', { printers: [{ printerId: s.printerId, status: 'ERROR' }] })
      .expect(200);
    const printer = await h.prisma.printer.findUniqueOrThrow({ where: { id: s.printerId } });
    expect(printer.status).not.toBe('ERROR');
  });

  it('job list still renders after printing (sanity)', async () => {
    const s = await pairedShop(h);
    const { created } = await printingOrder(h, s);
    const list = (await h.http().get('/api/shop/jobs').set(s.auth).expect(200)).body
      .jobs as ShopJob[];
    expect(list.find((j) => j.orderId === created.order.id)?.status).toBe('PRINTING');
  });
});
