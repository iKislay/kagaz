import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SHOP_AGENT_PREFIX } from '../../src/modules/files/downloads.controller.js';
import { StorageService } from '../../src/modules/files/storage.service.js';
import { type Harness, createHarness } from './harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});

describe('shop app downloads', () => {
  it('redirects an uploaded file to a short-lived signed URL', async () => {
    await h.app
      .get(StorageService)
      .put(`${SHOP_AGENT_PREFIX}releases.win.json`, Buffer.from('{}'), 'application/json');
    const res = await h
      .http()
      .get('/api/downloads/shop-agent/releases.win.json?arch=x64')
      .expect(302);
    expect(res.headers.location).toContain('releases.win.json');
    expect(res.headers.location).toContain('X-Amz-Signature');
  });

  it('404s for files that are not uploaded or not allow-listed', async () => {
    await h.http().get('/api/downloads/shop-agent/KagazShop-9.9.9-full.nupkg').expect(404);
    await h.http().get('/api/downloads/shop-agent/..%2F..%2Fsecret.pdf').expect(404);
    await h.http().get('/api/downloads/shop-agent/orders.pdf').expect(404);
  });
});
