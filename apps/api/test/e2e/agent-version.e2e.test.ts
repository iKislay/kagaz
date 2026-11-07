import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, createHarness } from './harness.js';
import { pairedShop } from './shop-helpers.js';

/** P4.4 / contract §1: MIN_AGENT_VERSION → 426 AGENT_UPGRADE_REQUIRED on shop endpoints. */
let h: Harness;
const previous = process.env.MIN_AGENT_VERSION;
beforeAll(async () => {
  process.env.MIN_AGENT_VERSION = '0.3.0'; // read when the app's config is built
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
  if (previous === undefined) delete process.env.MIN_AGENT_VERSION;
  else process.env.MIN_AGENT_VERSION = previous;
});

describe('agent upgrade gate (P4.4)', () => {
  it('old agents get 426 on shop endpoints but the heartbeat still answers 200', async () => {
    const s = await pairedShop(h); // enrolled as 0.3.0
    const old = { ...s.auth, 'X-Agent-Version': '0.2.9' };

    const blocked = await h.http().get('/api/shop/jobs').set(old).expect(426);
    expect(blocked.body.error).toMatchObject({
      code: 'AGENT_UPGRADE_REQUIRED',
      details: { minAgentVersion: '0.3.0', appVersion: '0.2.9' },
    });
    await h.http().post('/api/shop/pickups/verify').set(old).send({ code: 'ZZZZZZZZ' }).expect(426);

    const hb = await h
      .http()
      .post('/api/shop/heartbeat')
      .set(old)
      .send({ appVersion: '0.2.9' })
      .expect(200);
    expect(hb.body).toMatchObject({ minAgentVersion: '0.3.0', upgradeRequired: true });

    // Without the header, the last heartbeat's version (0.2.9) applies.
    await h.http().get('/api/shop/jobs').set(s.auth).expect(426);

    // Current agents pass.
    await h
      .http()
      .get('/api/shop/jobs')
      .set({ ...s.auth, 'X-Agent-Version': '0.3.0' })
      .expect(200);
    const hb2 = await h
      .http()
      .post('/api/shop/heartbeat')
      .set(s.auth)
      .send({ appVersion: '0.4.1' });
    expect(hb2.body.upgradeRequired).toBe(false);
    await h.http().get('/api/shop/jobs').set(s.auth).expect(200);
  });
});
