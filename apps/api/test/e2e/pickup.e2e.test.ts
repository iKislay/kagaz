import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PickupCrypto } from '../../src/modules/pickup/pickup-crypto.js';
import { type Harness, createHarness } from './harness.js';
import { customerView, pairedShop, printingOrder, readyOrder } from './shop-helpers.js';

/** P4.5 pickup hardening. */
let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});

const WRONG = 'ZZZZ-ZZZZ';

describe('pickup codes (T15)', () => {
  it('T15: correct code collects once; reuse is rejected, audited and counted on the order', async () => {
    const s = await pairedShop(h);
    const { created, code } = await readyOrder(h, s);
    await s.human('pickups/verify', { code }).expect(200);
    const reused = await s.human('pickups/verify', { code }).expect(409);
    expect(reused.body.error.code).toBe('PICKUP_ALREADY_USED');

    const row = await h.prisma.pickupCode.findUniqueOrThrow({
      where: { orderId: created.order.id },
    });
    expect(row).toMatchObject({ failedAttempts: 1, encryptedDisplayValue: null });
    expect(row.consumedAt).not.toBeNull();
    expect((await customerView(h, created)).pickupCode).toBeNull();
    const audit = await h.prisma.auditLog.findFirstOrThrow({
      where: { orderId: created.order.id, action: 'pickup.reused' },
    });
    expect(audit.metadata).toMatchObject({ reason: 'already_used', deviceId: s.device.device.id });
  });

  it('T15: a code for an order that is not ready yet is refused and counted', async () => {
    const s = await pairedShop(h);
    const { created } = await printingOrder(h, s);
    // The code is already on the printed slip, but the operator hasn't marked it ready.
    const row = await h.prisma.pickupCode.findUniqueOrThrow({
      where: { orderId: created.order.id },
    });
    expect(row.expiresAt).toBeNull(); // the 7-day clock starts at READY
    const code = h.app.get(PickupCrypto).decrypt(row.encryptedDisplayValue!);
    const res = await s.human('pickups/verify', { code }).expect(409);
    expect(res.body.error.code).toBe('ORDER_NOT_READY');
    const after = await h.prisma.pickupCode.findUniqueOrThrow({
      where: { orderId: created.order.id },
    });
    expect(after.failedAttempts).toBe(1);
  });

  it('T15: an expired code is refused with 410 PICKUP_CODE_EXPIRED', async () => {
    const s = await pairedShop(h);
    const { created, code } = await readyOrder(h, s);
    await h.prisma.pickupCode.update({
      where: { orderId: created.order.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const res = await s.human('pickups/verify', { code }).expect(410);
    expect(res.body.error.code).toBe('PICKUP_CODE_EXPIRED');
    expect((await customerView(h, created)).status).toBe('READY_FOR_PICKUP');
  });
});

describe('pickup brute force (T16)', () => {
  it('T16: 5 wrong codes in 10 min lock the device for 10 min (429), every failure audited', async () => {
    const s = await pairedShop(h);
    const { created, code } = await readyOrder(h, s);

    for (let i = 0; i < 5; i++) {
      const r = await s.human('pickups/verify', { code: WRONG }).expect(404);
      expect(r.body.error.code).toBe('PICKUP_CODE_INVALID');
    }
    const locked = await s.human('pickups/verify', { code }).expect(429);
    expect(locked.body.error).toMatchObject({ code: 'PICKUP_LOCKED' });
    expect(locked.body.error.details.retryAfterSeconds).toBeGreaterThan(590);
    // Even the right code is refused while locked; the order is untouched.
    expect((await customerView(h, created)).status).toBe('READY_FOR_PICKUP');

    const audits = await h.prisma.auditLog.findMany({
      where: { shopId: s.shop.id, action: { in: ['pickup.failed', 'pickup.locked'] } },
      orderBy: { createdAt: 'asc' },
    });
    expect(audits.map((a) => a.action)).toEqual([
      ...Array<string>(5).fill('pickup.failed'),
      'pickup.locked',
    ]);
    expect(audits[4]!.metadata).toMatchObject({
      failuresInWindow: 5,
      deviceId: s.device.device.id,
    });
    expect((audits[4]!.metadata as { lockedUntil: string | null }).lockedUntil).not.toBeNull();

    // Another device of another shop is not affected.
    const other = await pairedShop(h);
    await other.human('pickups/verify', { code: WRONG }).expect(404);

    // After the lockout ends, the right code works.
    await h.prisma.shopDevice.update({
      where: { id: s.device.device.id },
      data: { pickupLockUntil: new Date(Date.now() - 1000) },
    });
    await s.human('pickups/verify', { code }).expect(200);
  });

  it('T16: failures outside the 10-minute window start a new count', async () => {
    const s = await pairedShop(h);
    for (let i = 0; i < 4; i++) await s.human('pickups/verify', { code: WRONG }).expect(404);
    await h.prisma.shopDevice.update({
      where: { id: s.device.device.id },
      data: { pickupWindowAt: new Date(Date.now() - 11 * 60_000) },
    });
    for (let i = 0; i < 4; i++) await s.human('pickups/verify', { code: WRONG }).expect(404);
    await s.human('pickups/verify', { code: WRONG }).expect(404); // 5th in new window → locks
    await s.human('pickups/verify', { code: WRONG }).expect(429);
  });

  it('T16: concurrent wrong guesses are all counted', async () => {
    const s = await pairedShop(h);
    await Promise.all(Array.from({ length: 5 }, () => s.human('pickups/verify', { code: WRONG })));
    await s.human('pickups/verify', { code: WRONG }).expect(429);
  });
});
